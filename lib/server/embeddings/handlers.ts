import "server-only";

import { getUser } from "@/lib/server/auth/session";
import { checkOrigin, readInput, RequestError } from "@/lib/server/http/request";
import { embeddingsEnabled, queueBillEmbeddings } from "@/lib/server/embeddings/service";
import { listEmbeddingBills, readEmbeddingDocument } from "@/lib/server/embeddings/store";

const headers = { "Cache-Control": "no-store" };
const validId = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

export async function handleIndexEmbeddings(request: Request) {
  try {
    checkOrigin(request);
    const user = await getUser();
    if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
    if (!embeddingsEnabled()) throw new RequestError("Enable EMBEDDINGS_ENABLED=1 on the server first.", 503);
    const input = await readInput(request);
    if (input.billId !== undefined) {
      if (!validId(input.billId)) throw new RequestError("A valid billId is required.", 400);
      const source = await readEmbeddingDocument(input.billId, user.id);
      if (!source) throw new RequestError("Bill not found.", 404);
      if (!source.document) throw new RequestError("Original OCR is unavailable for this bill.", 409);
      return Response.json(await queueBillEmbeddings(input.billId, user.id), { status: 202, headers });
    }
    const offset = input.offset ?? 0;
    if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
      throw new RequestError("Use an integer offset from 0 to 1000000.", 400);
    }
    const page = await listEmbeddingBills(user.id, offset);
    const results = [];
    for (const billId of page.billIds) {
      const source = await readEmbeddingDocument(billId, user.id);
      results.push(source?.document ? await queueBillEmbeddings(billId, user.id) : { billId, queued: false, reason: "OCR unavailable" });
    }
    return Response.json({ results, nextOffset: page.nextOffset }, { status: 202, headers });
  } catch (error) {
    if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Unable to queue embeddings. Check Neo4j and Inngest, then retry." }, { status: 503, headers });
  }
}

export async function handleEmbeddingStatus(request: Request) {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
    const billId = new URL(request.url).searchParams.get("billId");
    if (!validId(billId)) throw new RequestError("A valid billId is required.", 400);
    const source = await readEmbeddingDocument(billId, user.id);
    if (!source) throw new RequestError("Bill not found.", 404);
    return Response.json({ billId, status: source.status || "not_indexed", profile: source.profile,
      chunkCount: source.chunkCount, hasOcr: !!source.document }, { headers });
  } catch (error) {
    if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Unable to read embedding status." }, { status: 503, headers });
  }
}
