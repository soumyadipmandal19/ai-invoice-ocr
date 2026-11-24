import "server-only";

import { randomUUID } from "node:crypto";
import { inngest } from "@/lib/inngest/client";
import { chunkDocument } from "@/lib/server/embeddings/chunks";
import { embedTexts } from "@/lib/server/embeddings/local";
import { ensureBillEmbeddingGroup, failEmbedding, markEmbeddingQueued, readEmbeddingDocument, saveDocumentEmbeddings } from "@/lib/server/embeddings/store";

export const embeddingsEnabled = () => process.env.EMBEDDINGS_ENABLED === "1";

export async function queueBillEmbeddings(billId: string, ownerUserId: string) {
  const requestId = randomUUID();
  if (!await markEmbeddingQueued(billId, ownerUserId, requestId)) return { billId, queued: false };
  try {
    await inngest.send({ id: requestId, name: "document/embedding.requested", data: { billId, ownerUserId, requestId } });
  } catch {
    await failEmbedding(billId, ownerUserId, requestId);
    throw new Error("Unable to queue local embeddings. Check the Inngest connection.");
  }
  return { billId, queued: true };
}

export async function indexBillEmbeddings(billId: string, ownerUserId: string, requestId: string) {
  if (!await ensureBillEmbeddingGroup(billId, ownerUserId)) return { billId, status: "skipped" };
  const source = await readEmbeddingDocument(billId, ownerUserId);
  if (!source || source.requestId !== requestId || source.status !== "queued") return { billId, status: "skipped" };
  if (!source.document) throw new Error("Original OCR is unavailable for this bill.");
  const { chunks, fingerprint } = chunkDocument(billId, source.document);
  const vectors = chunks.length ? await embedTexts(chunks.map((chunk) => chunk.text)) : [];
  const saved = await saveDocumentEmbeddings(billId, ownerUserId, requestId, fingerprint,
    chunks.map((chunk, index) => ({ ...chunk, embeddingId: billId, billId, ownerUserId, embedding: vectors[index] })));
  // Do not put OCR or vectors into Inngest step outputs.
  return { billId, status: saved ? "ready" : "skipped", chunkCount: saved ? chunks.length : 0 };
}
