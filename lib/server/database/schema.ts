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
