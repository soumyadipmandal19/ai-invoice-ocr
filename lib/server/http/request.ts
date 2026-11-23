import "server-only";

export class RequestError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
const MAX_BODY = 8192;

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.AUTH_ORIGIN || new URL(request.url).origin;
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== expected)) {
    throw new RequestError("Cross-origin authentication requests are not allowed.", 403);
  }
}

export async function readInput(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new RequestError("Send an application/json request body.", 415);
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY) throw new RequestError("Request body is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("A JSON request body is required.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new RequestError("Request body is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
    return input as Record<string, unknown>;
  } catch {
    throw new RequestError("Send a valid JSON object.", 400);
  }
}

