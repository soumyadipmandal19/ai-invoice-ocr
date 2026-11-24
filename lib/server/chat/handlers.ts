import "server-only";

import { getUser } from "@/lib/server/auth/session";
import { checkOrigin, readInput, RequestError } from "@/lib/server/http/request";
import { answerDocumentQuestion } from "@/lib/server/chat/service";
import { ChatModelError } from "@/lib/server/chat/answer";
import type { ChatHistoryMessage } from "@/types/chat";

const headers = { "Cache-Control": "no-store" };
const activeUsers = new Set<string>();
const requests = new Map<string, { count: number; expires: number }>();

export async function handleChat(request: Request) {
  try {
    checkOrigin(request);
    const user = await getUser();
    if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
    const input = await readInput(request);
    const billId = input.billId ?? null;
    const contextBillId = input.contextBillId ?? null;
    if (contextBillId !== null && (typeof contextBillId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(contextBillId))) {
      throw new RequestError("Invalid conversation context. Start a new chat and retry.", 400);
    }
    if (billId !== null && (typeof billId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(billId))) {
      throw new RequestError("Select a valid document or all documents.", 400);
    }
    if (typeof input.question !== "string" || !input.question.trim() || Array.from(input.question).length > 1000) {
      throw new RequestError("Enter a question between 1 and 1,000 characters.", 400);
    }
    const history = input.history ?? [];
    if (!Array.isArray(history) || history.length > 6 || !history.every((message) => message && typeof message === "object"
      && ["user", "assistant"].includes(message.role) && typeof message.content === "string" && message.content.trim()
      && Array.from(message.content).length <= 1000)
      || history.reduce((size, message) => size + Array.from(message.content).length, 0) > 4000) {
      throw new RequestError("Send at most six user/assistant history messages of up to 1,000 characters each, totaling at most 4,000 characters.", 400);
    }
    const now = Date.now();
    for (const [owner, entry] of requests) if (entry.expires <= now) requests.delete(owner);
    const entry = requests.get(user.id) || { count: 0, expires: now + 60_000 };
    if (activeUsers.has(user.id) || activeUsers.size >= 2 || entry.count >= 10 || (!requests.has(user.id) && requests.size >= 10_000)) {
      throw new RequestError("The assistant is busy or you've reached the request limit. Please try again shortly.", 429);
    }
    entry.count++; requests.set(user.id, entry); activeUsers.add(user.id);
    try {
      const result = await answerDocumentQuestion(user.id, input.question.trim(), history as ChatHistoryMessage[], request.signal, billId, contextBillId);
      return Response.json(result, { headers });
    } finally { activeUsers.delete(user.id); }
  } catch (error) {
    if (error instanceof RequestError || error instanceof ChatModelError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Unable to answer right now. Please retry when the local embedding worker and database are available." }, { status: 503, headers });
  }
}

