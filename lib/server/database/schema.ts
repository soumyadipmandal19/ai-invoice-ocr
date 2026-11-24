import "server-only";

import { getNeo4jDriver } from "@/lib/server/database/neo4j";
import type { AuthUser } from "@/types/auth/user";
import type { BillRecord, BillItemRecord } from "@/types/bills/models";

// Persisted node shapes. Public API responses use the smaller AuthUser type.
// TypeScript types describe the application model; they do not enforce Neo4j property types.
export type UserNode = AuthUser & {
  salt: string;
  passwordHash: string;
  createdAt: number;
  deletedBillIds?: string[]; // Prevent late workflow/API retries from recreating deleted bills.
};

export type SessionNode = {
  tokenHash: string;
  expiresAt: number;
};

// Persistent bill graph: (User)-[:UPLOADED]->(Bill)-[:HAS_ITEM]->(BillItem).
// Bill also links to OCRExtraction via HAS_OCR and LLMResult via HAS_LLM_RESULT.
// Null properties in these application models are omitted by Neo4j on storage.
export type BillNode = BillRecord & {
  jobId: string;
  documentType: string;
  orderId: string | null;
  shippingMethod: string | null;
  workbookJson: string;
  classificationJson: string;
  normalizationWarnings: string[];
  // Legacy fields: read/migrated for older records. New writes use DocumentEmbeddings.
  embeddingStatus?: "queued" | "ready" | "failed";
  embeddingProfile?: string;
  embeddingRequestId?: string;
  embeddingQueuedAt?: number;
  embeddingFingerprint?: string;
  embeddingChunkCount?: number;
  embeddedAt?: string;
};
export type BillItemNode = BillItemRecord & { currency: string | null };

export type OCRExtractionNode = {
  extractionId: string;
  billId: string;
  sourceFile: string;
  pageCount: number;
  dataJson: string;
  createdAt: string;
};

export type LLMResultNode = {
  resultId: string;
  billId: string;
  model: string;
  dataJson: string;
  workbookJson: string;
  createdAt: string;
};

export type DocumentChunkNode = {
  chunkId: string;
  embeddingId: string;
  billId: string;
  ownerUserId: string;
  page: number;
  position: number;
  text: string;
  textHash: string;
  embedding: number[];
};

// (Bill)-[:HAS_EMBEDDINGS]->(DocumentEmbeddings)-[:HAS_CHUNK]->(DocumentChunk).
// One group per bill in this version; its embeddingId equals the billId.
export type DocumentEmbeddingsNode = {
  embeddingId: string;
  billId: string;
  ownerUserId: string;
  model: string;
  dimensions: number;
  profile?: string;
  status: "not_indexed" | "queued" | "ready" | "failed";
  requestId?: string;
  queuedAt?: number;
  fingerprint?: string;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  embeddedAt?: string;
};

// Graph: (Session)-[:BELONGS_TO]->(User).
// Keep database constraints and indexes here as the graph grows.
const schemaStatements = [
  "CREATE CONSTRAINT paper_upload_key IF NOT EXISTS FOR (u:DocumentUpload) REQUIRE u.uploadKey IS UNIQUE",
  "CREATE CONSTRAINT paper_user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE",
  "CREATE CONSTRAINT paper_user_email IF NOT EXISTS FOR (u:User) REQUIRE u.email IS UNIQUE",
  "CREATE CONSTRAINT paper_session_token IF NOT EXISTS FOR (s:Session) REQUIRE s.tokenHash IS UNIQUE",
  "CREATE CONSTRAINT paper_bill_id IF NOT EXISTS FOR (b:Bill) REQUIRE b.billId IS UNIQUE",
  "CREATE CONSTRAINT paper_bill_item_id IF NOT EXISTS FOR (i:BillItem) REQUIRE i.itemId IS UNIQUE",
  "CREATE CONSTRAINT paper_ocr_extraction_id IF NOT EXISTS FOR (o:OCRExtraction) REQUIRE o.extractionId IS UNIQUE",
  "CREATE CONSTRAINT paper_llm_result_id IF NOT EXISTS FOR (l:LLMResult) REQUIRE l.resultId IS UNIQUE",
  "CREATE CONSTRAINT paper_chunk_id IF NOT EXISTS FOR (c:DocumentChunk) REQUIRE c.chunkId IS UNIQUE",
  "CREATE CONSTRAINT paper_document_embeddings_id IF NOT EXISTS FOR (e:DocumentEmbeddings) REQUIRE e.embeddingId IS UNIQUE",
] as const;

let initialization: Promise<void> | undefined;

export async function ensureDatabaseSchema() {
  // Share initialization across concurrent callers; allow retry after a failure.
  initialization ??= (async () => {
    for (const query of schemaStatements) {
      await getNeo4jDriver().executeQuery(query, {}, {
        database: process.env.NEO4J_DATABASE || "neo4j",
      });
    }
  })().catch((error) => {
    initialization = undefined;
    throw error;
  });
  await initialization;
}

let embeddingInitialization: Promise<void> | undefined;

/** Kept separate so an unsupported vector index cannot prevent authentication or OCR. */
export async function ensureEmbeddingIndex() {
  embeddingInitialization ??= (async () => {
    await ensureDatabaseSchema();
    await getNeo4jDriver().executeQuery(
      `CREATE VECTOR INDEX paper_nomic_chunks IF NOT EXISTS
       FOR (c:DocumentChunk) ON (c.embedding)
       OPTIONS {indexConfig: {\`vector.dimensions\`: 768, \`vector.similarity_function\`: 'cosine'}}`,
      {}, { database: process.env.NEO4J_DATABASE || "neo4j" });
  })().catch((error) => { embeddingInitialization = undefined; throw error; });
  await embeddingInitialization;
}
