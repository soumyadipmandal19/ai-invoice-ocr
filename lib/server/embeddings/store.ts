import "server-only";

import { int } from "neo4j-driver";
import { getNeo4jDriver } from "@/lib/server/database/neo4j";
import { ensureDatabaseSchema, ensureEmbeddingIndex, type DocumentChunkNode } from "@/lib/server/database/schema";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EMBEDDING_PROFILE } from "@/lib/server/embeddings/chunks";
import { isExtractionResult } from "@/types/extraction/result";

const config = () => ({ database: process.env.NEO4J_DATABASE || "neo4j" });

export async function readEmbeddingDocument(billId: string, ownerUserId: string) {
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill {billId: $billId})
     OPTIONAL MATCH (b)-[:HAS_OCR]->(o:OCRExtraction)
     OPTIONAL MATCH (b)-[:HAS_EMBEDDINGS]->(e:DocumentEmbeddings {embeddingId: $billId})
     RETURN o.dataJson AS data, coalesce(e.status, b.embeddingStatus) AS status,
       coalesce(e.profile, b.embeddingProfile) AS profile,
       coalesce(e.fingerprint, b.embeddingFingerprint) AS fingerprint,
       coalesce(e.requestId, b.embeddingRequestId) AS requestId,
       coalesce(e.chunkCount, b.embeddingChunkCount) AS chunkCount`, { billId, ownerUserId }, config());
  if (!records.length) return null;
  const row = records[0];
  const raw = row.get("data");
  const document: unknown = typeof raw === "string" ? JSON.parse(raw) : null;
  const count = row.get("chunkCount");
  return { document: isExtractionResult(document) ? document : null, status: row.get("status") as string | null,
    profile: row.get("profile") as string | null, fingerprint: row.get("fingerprint") as string | null,
    requestId: row.get("requestId") as string | null,
    chunkCount: typeof count === "number" ? count : count?.toNumber() ?? 0 };
}

export async function listEmbeddingBills(ownerUserId: string, offset: number) {
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill)
     RETURN b.billId AS billId ORDER BY b.createdAt, b.billId SKIP $offset LIMIT 11`,
    { ownerUserId, offset: int(offset) }, config());
  return { billIds: records.slice(0, 10).map((row) => row.get("billId") as string),
    nextOffset: records.length > 10 ? offset + 10 : null };
}

/** Lazily move legacy Bill metadata/direct chunk links into the grouping node. */
export async function ensureBillEmbeddingGroup(billId: string, ownerUserId: string) {
  await ensureDatabaseSchema();
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (u:User {id: $ownerUserId}) SET u.id = u.id
     WITH u MATCH (u)-[:UPLOADED]->(b:Bill {billId: $billId})
     MERGE (e:DocumentEmbeddings {embeddingId: $billId})
     ON CREATE SET e.billId = $billId, e.ownerUserId = $ownerUserId,
       e.model = $model, e.dimensions = $dimensions, e.createdAt = $updatedAt,
       e.updatedAt = $updatedAt, e.status = coalesce(b.embeddingStatus, 'not_indexed'),
       e.profile = b.embeddingProfile, e.requestId = b.embeddingRequestId,
       e.queuedAt = b.embeddingQueuedAt, e.fingerprint = b.embeddingFingerprint,
       e.chunkCount = coalesce(b.embeddingChunkCount, 0), e.embeddedAt = b.embeddedAt
     WITH b, e WHERE e.ownerUserId = $ownerUserId AND e.billId = $billId
     MERGE (b)-[:HAS_EMBEDDINGS]->(e)
     WITH b, e
     OPTIONAL MATCH (b)-[link:HAS_CHUNK]->(legacy:DocumentChunk)
     WITH b, e, collect(link) AS links, collect(legacy) AS legacyChunks
     FOREACH (chunk IN legacyChunks |
       MERGE (e)-[:HAS_CHUNK]->(chunk) SET chunk.embeddingId = e.embeddingId
       REMOVE chunk.model, chunk.dimensions, chunk.profile)
     FOREACH (link IN links | DELETE link)
     REMOVE b.embeddingStatus, b.embeddingProfile, b.embeddingRequestId,
       b.embeddingQueuedAt, b.embeddingFingerprint, b.embeddingChunkCount, b.embeddedAt
     RETURN b.billId AS billId`, { billId, ownerUserId, model: EMBEDDING_MODEL,
      dimensions: int(EMBEDDING_DIMENSIONS), updatedAt: new Date().toISOString() }, config());
  return records.length > 0;
}

export async function markEmbeddingQueued(billId: string, ownerUserId: string, requestId: string) {
  if (!await ensureBillEmbeddingGroup(billId, ownerUserId)) return false;
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (u:User {id: $ownerUserId}) SET u.id = u.id
     WITH u MATCH (u)-[:UPLOADED]->(b:Bill {billId: $billId})
     MATCH (b)-[:HAS_EMBEDDINGS]->(e:DocumentEmbeddings {embeddingId: $billId})
     WHERE coalesce(e.profile, '') <> $profile
       OR NOT coalesce(e.status IN ['queued', 'ready'], false)
       OR (e.status = 'queued' AND coalesce(e.queuedAt, 0) < $staleBefore)
     SET e.status = 'queued', e.profile = $profile, e.model = $model, e.dimensions = $dimensions,
       e.requestId = $requestId, e.queuedAt = $now, e.updatedAt = $updatedAt
     RETURN b.billId AS billId`, { billId, ownerUserId, requestId, profile: EMBEDDING_PROFILE,
      model: EMBEDDING_MODEL, dimensions: int(EMBEDDING_DIMENSIONS), updatedAt: new Date().toISOString(),
      now: Date.now(), staleBefore: Date.now() - 15 * 60_000 }, config());
  return records.length > 0;
}

export async function failEmbedding(billId: string, ownerUserId: string, requestId: string) {
  if (!await ensureBillEmbeddingGroup(billId, ownerUserId)) return;
  await getNeo4jDriver().executeQuery(
    `MATCH (u:User {id: $ownerUserId}) SET u.id = u.id
     WITH u MATCH (u)-[:UPLOADED]->(b:Bill {billId: $billId})
     MATCH (b)-[:HAS_EMBEDDINGS]->(e:DocumentEmbeddings {embeddingId: $billId})
     WHERE e.requestId = $requestId AND e.status = 'queued'
     SET e.status = 'failed', e.updatedAt = $updatedAt`,
    { billId, ownerUserId, requestId, updatedAt: new Date().toISOString() }, config());
}

export async function saveDocumentEmbeddings(billId: string, ownerUserId: string, requestId: string,
  fingerprint: string, chunks: DocumentChunkNode[]) {
  await ensureEmbeddingIndex();
  // Use the same owner lock as bill/account deletion. A late worker cannot recreate deleted data.
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (u:User {id: $ownerUserId}) SET u.id = u.id
     WITH u MATCH (u)-[:UPLOADED]->(b:Bill {billId: $billId})
     MATCH (b)-[:HAS_EMBEDDINGS]->(e:DocumentEmbeddings {embeddingId: $billId})
     WHERE e.requestId = $requestId AND e.status = 'queued'
     OPTIONAL MATCH (e)-[:HAS_CHUNK]->(old:DocumentChunk)
     WITH b, e, collect(old) AS previous
     FOREACH (chunk IN previous | DETACH DELETE chunk)
     FOREACH (properties IN $chunks |
       CREATE (chunk:DocumentChunk) SET chunk = properties
       CREATE (e)-[:HAS_CHUNK]->(chunk))
     SET e.status = 'ready', e.fingerprint = $fingerprint,
       e.chunkCount = $chunkCount, e.profile = $profile,
       e.embeddedAt = $embeddedAt, e.updatedAt = $embeddedAt
     RETURN b.billId AS billId`,
    { billId, ownerUserId, requestId, fingerprint, chunks, chunkCount: int(chunks.length),
      profile: EMBEDDING_PROFILE, embeddedAt: new Date().toISOString() }, config());
  return records.length > 0;
}
