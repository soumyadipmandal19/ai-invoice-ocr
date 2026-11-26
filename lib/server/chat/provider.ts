import "server-only";

import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ChatModelError } from "@/lib/server/chat/errors";

// Briefly suppress repeated calls after a confirmed account-wide daily limit.
// Recheck within a minute so adding credits can restore service before reset.
const dailyLimits = new Map<string, { expires: number; error: ChatModelError }>();
const MAX_WAIT_MS = 8000;

function retrySeconds(value: string | null, now: number) {
  if (!value) return null;
  const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : null;
}

/** Shared bounded retry policy for planning, relevance selection and answers. */
async function requestChatCompletion(options: RequestInit): Promise<Response> {
  const headers = new Headers(options.headers);
  const key = createHash("sha256").update(headers.get("authorization") || "").digest("hex");
  const model = typeof options.body === "string" ? JSON.parse(options.body).model : "";
  const freeModel = typeof model === "string" && (model.endsWith(":free") || model === "openrouter/free");
  const now = Date.now();
  for (const [cachedKey, value] of dailyLimits) if (value.expires <= now) dailyLimits.delete(cachedKey);
  const blocked = freeModel ? dailyLimits.get(key) : null;
  if (blocked) throw blocked.error;
  for (let attempt = 0; attempt < 3; attempt++) {
    options.signal?.throwIfAborted();
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", options);
    if (response.status !== 429 && ![502, 503, 504].includes(response.status)) return response;
    let retryAfter = retrySeconds(response.headers.get("retry-after"), Date.now());
    if (response.status === 429) {
      // Inspect only documented limit fields. Never expose raw provider bodies.
      const body = await response.clone().json().catch(() => null);
      const metadata = body?.error?.metadata;
      if (metadata?.limit_source === "openrouter_free_tier_daily"
        || (typeof body?.error?.message === "string" && body.error.message.includes("free-models-per-day"))) {
        const reset = Number(metadata?.headers?.["X-RateLimit-Reset"] ?? response.headers.get("x-ratelimit-reset"));
        const resetAt = Number.isFinite(reset) && reset > Date.now() && reset < Date.now() + 48 * 60 * 60_000
          ? new Date(reset).toISOString() : undefined;
        const remaining = resetAt ? Math.max(1, Math.ceil((reset - Date.now()) / 1000)) : 3600;
        const resetText = resetAt ? ` It resets at ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(resetAt))} UTC.` : "";
        const error = new ChatModelError(`The chat provider's daily free-model quota is exhausted.${resetText} Increase your OpenRouter quota to continue sooner.`, 429,
          { code: "provider_daily_quota", retryAfterSeconds: remaining, ...(resetAt ? { resetAt } : {}) });
        await response.body?.cancel();
        if (dailyLimits.size >= 32) dailyLimits.delete(dailyLimits.keys().next().value!);
        dailyLimits.set(key, { expires: Math.min(Date.now() + 60_000, resetAt ? reset : Infinity), error });
        throw error;
      }
      retryAfter ??= retrySeconds(metadata?.headers?.["Retry-After"] || null, Date.now());
    }
    const waitMs = retryAfter === null ? 1000 * 2 ** attempt : retryAfter * 1000;
    if (attempt === 2 || waitMs > MAX_WAIT_MS) {
      if (response.status !== 429) return response;
      await response.body?.cancel();
      const seconds = Math.max(1, retryAfter ?? 30);
      throw new ChatModelError(`The chat provider is temporarily rate-limiting requests. Please retry in ${seconds} seconds.`, 429,
        { code: "provider_rate_limit", retryAfterSeconds: seconds });
    }
    await response.body?.cancel();
    if (waitMs) await delay(waitMs, undefined, { signal: options.signal ?? undefined });
  }
  throw new ChatModelError("The chat provider is temporarily unavailable. Please retry.");
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatRequest = {
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  jsonMode?: boolean;
  repairJson?: boolean;
  signal?: AbortSignal;
};
export type ChatCompletion = { text: string; model: string; finishReason: string | null };
export interface ChatClient {
  /** Opaque configuration identity for isolating application caches. */
  readonly cacheIdentity: string;
  complete(request: ChatRequest): Promise<ChatCompletion>;
}

function configuration() {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  const model = (process.env.OPENROUTER_CHAT_MODEL || process.env.OPENROUTER_MODEL)?.trim();
  if (!key || !model) throw new ChatModelError("The document assistant is not configured. Check the server's OpenRouter settings.");
  return { key, model };
}

class OpenRouterChatClient implements ChatClient {
  get cacheIdentity() {
    const { key, model } = configuration();
    return createHash("sha256").update(JSON.stringify({ key, model })).digest("hex");
  }

  async complete(request: ChatRequest): Promise<ChatCompletion> {
    const { key, model } = configuration();
    const signal = request.signal ?? AbortSignal.timeout(60_000);
    const optionalFeatures = request.jsonMode || request.repairJson;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await requestChatCompletion({
        method: "POST", signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_APP_URL?.trim() || "http://localhost:3000",
          "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME?.trim() || "Paper to Text" },
        body: JSON.stringify({ model, max_tokens: request.maxTokens, temperature: request.temperature ?? 0,
          reasoning: { enabled: false }, messages: request.messages,
          ...(attempt === 0 && request.jsonMode ? { response_format: { type: "json_object" } } : {}),
          ...(attempt === 0 && request.repairJson ? { plugins: [{ id: "response-healing" }] } : {}),
        }),
      });
      // Provider compatibility is a transport concern, independent of plan or
      // citation validation. Retry once without optional JSON features.
      if (response.status === 400 && attempt === 0 && optionalFeatures) { await response.body?.cancel(); continue; }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ChatModelError("The chat model is unavailable. Check the server key, model availability, and provider credits.");
      }
      let data;
      try { data = await response.json(); } catch {
        throw new ChatModelError("The chat model returned an unreadable response. Please retry.", 502);
      }
      if (data?.error) throw new ChatModelError("The chat model is temporarily unavailable.");
      const choice = data?.choices?.[0];
      if (choice?.finish_reason === "length") throw new ChatModelError("The model reply was cut short. Try a more specific question.", 502);
      const content = choice?.message?.content;
      const text = typeof content === "string" ? content : Array.isArray(content)
        ? content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("") : "";
      if (!text.trim()) throw new ChatModelError("The chat model returned an empty response. Please retry.", 502);
      return { text, model, finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null };
    }
    throw new ChatModelError("The chat model is temporarily unavailable.");
  }
}

export const chatClient: ChatClient = new OpenRouterChatClient();
