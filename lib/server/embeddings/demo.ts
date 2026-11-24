import "server-only";

import { getUser } from "@/lib/server/auth/session";
import { checkOrigin, readInput, RequestError } from "@/lib/server/http/request";
import { embedTexts } from "@/lib/server/embeddings/local";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@/lib/server/embeddings/chunks";

const headers = { "Cache-Control": "no-store" };
let active = false;

/** Direct, in-memory inference: no job queue, document store, or file writes. */
export async function handleEmbeddingDemo(request: Request) {
  try {
    checkOrigin(request);
    if (!await getUser()) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
    const input = await readInput(request);
    if (typeof input.text !== "string" || !input.text.trim() || Array.from(input.text).length > 1000) {
      throw new RequestError("Enter text between 1 and 1,000 characters.", 400);
    }
    if (active) throw new RequestError("The embedding demo is busy. Try again shortly.", 429);
    active = true;
    try {
      const [vector] = await embedTexts([input.text.trim()]);
      return Response.json({ model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS,
        inferenceMode: "local", vector }, { headers });
    } finally { active = false; }
  } catch (error) {
    if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Unable to generate a local embedding. Check the Python environment and downloaded model." }, { status: 503, headers });
  }
}
