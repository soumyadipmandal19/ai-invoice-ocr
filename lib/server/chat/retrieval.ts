import "server-only";

import { int } from "neo4j-driver";
import { getNeo4jDriver } from "@/lib/server/database/neo4j";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EMBEDDING_PROFILE } from "@/lib/server/embeddings/chunks";
import type { ChatIndexing, ChatSource } from "@/types/chat";

const config = () => ({ database: process.env.NEO4J_DATABASE || "neo4j", routing: "READ" as const,
  transactionConfig: { timeout: 10_000 } });
const number = (value: number | { toNumber(): number } | null) => typeof value === "number" ? value : value?.toNumber() ?? 0;

export async function readChatIndexing(ownerUserId: string, billId: string | null = null, billIds: string[] | null = null): Promise<ChatIndexing> {
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill)
     WHERE ($billId IS NULL OR b.billId = $billId)
       AND ($billIds IS NULL OR b.billId IN $billIds)
     OPTIONAL MATCH (b)-[:HAS_EMBEDDINGS]->(e:DocumentEmbeddings)
     RETURN count(DISTINCT b) AS totalBills,
       count(DISTINCT CASE WHEN e.status = 'ready' AND e.profile = $profile
         AND e.model = $model AND e.dimensions = $dimensions AND e.chunkCount > 0
         THEN b END) AS readyBills`,
    { ownerUserId, billId, billIds, profile: EMBEDDING_PROFILE, model: EMBEDDING_MODEL, dimensions: int(EMBEDDING_DIMENSIONS) }, config());
  return { totalBills: number(records[0]?.get("totalBills")), readyBills: number(records[0]?.get("readyBills")) };
}

export async function retrieveChatSources(ownerUserId: string, vector: number[], billId: string | null = null, billIds: string[] | null = null): Promise<ChatSource[]> {
  if (vector.length !== EMBEDDING_DIMENSIONS || vector.some((n) => !Number.isFinite(n)) || !vector.some((n) => n !== 0)) {
    throw new Error("Invalid question embedding.");
  }
  const configured = process.env.CHAT_MIN_SIMILARITY;
  const minimum = !configured?.trim() ? 0.75 : Number(configured);
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 1) throw new Error("Invalid chat similarity configuration.");
  // Exact search over the authenticated owner's graph. Filtering a global ANN top-k
  // afterward could omit this user's best matches. A larger dataset needs filtered ANN.
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill)
       -[:HAS_EMBEDDINGS]->(e:DocumentEmbeddings)-[:HAS_CHUNK]->(c:DocumentChunk)
     WHERE ($billId IS NULL OR b.billId = $billId)
       AND ($billIds IS NULL OR b.billId IN $billIds)
       AND e.status = 'ready' AND e.profile = $profile AND e.model = $model
       AND e.dimensions = $dimensions AND c.ownerUserId = $ownerUserId
       AND c.billId = b.billId AND c.embeddingId = e.embeddingId
       AND size(c.embedding) = $dimensions AND c.text IS NOT NULL
     WITH b, c, vector.similarity.cosine(c.embedding, $vector) AS score
     WHERE score >= $minimum
     RETURN b.billId AS billId, b.billNumber AS billNumber, b.sourceFile AS fileName, c.chunkId AS chunkId,
       c.page AS page, c.text AS text, score
     ORDER BY score DESC, chunkId ASC LIMIT $limit`,
    { ownerUserId, billId, billIds, vector, profile: EMBEDDING_PROFILE, model: EMBEDDING_MODEL,
      dimensions: int(EMBEDDING_DIMENSIONS), minimum, limit: int(6) }, config());
  return records.map((row, index) => ({ id: `S${index + 1}`, billId: row.get("billId"), billNumber: row.get("billNumber"),
    chunkId: row.get("chunkId"), fileName: row.get("fileName") || "Saved bill", page: number(row.get("page")),
    text: Array.from(String(row.get("text"))).slice(0, 1000).join(""), score: number(row.get("score")) }));
}

/** Exhaustive scoped summaries must inspect every chunk, never a semantic top-k. */
export async function readSummarySources(ownerUserId: string, billId: string | null, billIds: string[] | null = null): Promise<ChatSource[] | null> {
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill)
       -[:HAS_EMBEDDINGS]->(e:DocumentEmbeddings)-[:HAS_CHUNK]->(c:DocumentChunk)
     WHERE ($billId IS NULL OR b.billId = $billId)
       AND ($billIds IS NULL OR b.billId IN $billIds)
       AND e.status = 'ready' AND e.profile = $profile AND e.model = $model
       AND e.dimensions = $dimensions AND c.ownerUserId = $ownerUserId
       AND c.billId = b.billId AND c.embeddingId = e.embeddingId AND c.text IS NOT NULL
     RETURN b.billId AS billId, b.billNumber AS billNumber, b.sourceFile AS fileName, c.chunkId AS chunkId,
       c.page AS page, c.text AS text ORDER BY billId, page, c.position LIMIT 41`,
    { ownerUserId, billId, billIds, profile: EMBEDDING_PROFILE, model: EMBEDDING_MODEL, dimensions: int(EMBEDDING_DIMENSIONS) }, config());
  if (records.length > 40 || records.reduce((size, row) => size + Array.from(String(row.get("text"))).length, 0) > 40_000) return null;
  return records.map((row, index) => ({ id: `S${index + 1}`, billId: row.get("billId"), billNumber: row.get("billNumber"), chunkId: row.get("chunkId"),
    fileName: row.get("fileName") || "Saved bill", page: number(row.get("page")), text: String(row.get("text")), score: 1 }));
}
