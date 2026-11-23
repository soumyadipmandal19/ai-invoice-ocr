import "server-only";

import { getNeo4jDriver } from "@/lib/server/database/neo4j";
import { ensureDatabaseSchema, type BillNode, type BillItemNode, type OCRExtractionNode, type LLMResultNode } from "@/lib/server/database/schema";
import type { WorkflowArtifacts } from "@/types/workflow/artifacts";
import type { SavedBillPage } from "@/types/bills/responses";
import { int } from "neo4j-driver";

export class BillOwnerMissingError extends Error {}
export type BillSaveResult = { billId: string; itemCount: number; status: "saved" };

export async function storeBill(bill: BillNode, items: BillItemNode[], artifacts: WorkflowArtifacts, uploadKey?: string): Promise<BillSaveResult> {
  await ensureDatabaseSchema();
  const ocr: OCRExtractionNode = {
    extractionId: bill.billId, billId: bill.billId, sourceFile: bill.sourceFile,
    pageCount: artifacts.ocr.pageCount, dataJson: JSON.stringify(artifacts.ocr), createdAt: bill.createdAt,
  };
  const llm: LLMResultNode = {
    resultId: bill.billId, billId: bill.billId, model: artifacts.organization.model,
    dataJson: JSON.stringify({ classification: JSON.parse(bill.classificationJson), organization: artifacts.organization, mappingResults: artifacts.mappingResults }),
    workbookJson: bill.workbookJson, createdAt: bill.createdAt,
  };
  // Lock the owner before graph writes, in the same order as account deletion.
  // A delayed job must neither recreate its owner nor leave orphaned bill data.
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (u:User {id: $ownerUserId})
     SET u.id = u.id
     WITH u WHERE NOT ($billId IN coalesce(u.deletedBillIds, []))
       AND ($uploadKey IS NULL OR EXISTS {
         MATCH (u)-[:HAS_UPLOAD]->(:DocumentUpload {uploadKey: $uploadKey, jobId: $billId})
       })
     MERGE (b:Bill {billId: $billId})
     ON CREATE SET b += $bill, b.itemCount = $itemCount
     WITH u, b WHERE b.ownerUserId = u.id
     MERGE (u)-[:UPLOADED]->(b)
     MERGE (ocr:OCRExtraction {extractionId: $billId})
     ON CREATE SET ocr += $ocr
     MERGE (b)-[:HAS_OCR]->(ocr)
     MERGE (llm:LLMResult {resultId: $billId})
     ON CREATE SET llm += $llm
     MERGE (b)-[:HAS_LLM_RESULT]->(llm)
     FOREACH (properties IN $items |
       MERGE (item:BillItem {itemId: properties.itemId})
       ON CREATE SET item += properties
       MERGE (b)-[:HAS_ITEM]->(item))
     RETURN b.billId AS billId, b.itemCount AS itemCount`,
    { ownerUserId: bill.ownerUserId, billId: bill.billId, bill, items, ocr, llm, itemCount: items.length, uploadKey: uploadKey || null },
    { database: process.env.NEO4J_DATABASE || "neo4j" },
  );
  if (!records.length) throw new BillOwnerMissingError("The bill was deleted or its upload owner is unavailable.");
  const count = records[0].get("itemCount");
  return { billId: records[0].get("billId"), itemCount: typeof count === "number" ? count : count.toNumber(), status: "saved" };
}

export async function deleteOwnedBill(billId: string, ownerUserId: string): Promise<boolean> {
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (u:User {id: $ownerUserId})
     SET u.id = u.id
     WITH u
     OPTIONAL MATCH (u)-[:UPLOADED]->(b:Bill {billId: $billId})
     WITH u, b WHERE b IS NOT NULL OR $billId IN coalesce(u.deletedBillIds, [])
     OPTIONAL MATCH (u)-[:HAS_UPLOAD]->(upload:DocumentUpload {jobId: $billId})
     WITH u, b, collect(upload) AS uploads
     OPTIONAL MATCH (b)-[:HAS_ITEM]->(item:BillItem)
     OPTIONAL MATCH (b)-[:HAS_OCR]->(ocr:OCRExtraction)
     OPTIONAL MATCH (b)-[:HAS_LLM_RESULT]->(llm:LLMResult)
     WITH u, b, uploads, collect(DISTINCT item) AS items, collect(DISTINCT ocr) AS ocrSnapshots,
       collect(DISTINCT llm) AS llmSnapshots
     SET u.deletedBillIds = CASE WHEN $billId IN coalesce(u.deletedBillIds, [])
       THEN u.deletedBillIds ELSE coalesce(u.deletedBillIds, []) + [$billId] END
     FOREACH (child IN items | DETACH DELETE child)
     FOREACH (child IN ocrSnapshots | DETACH DELETE child)
     FOREACH (child IN llmSnapshots | DETACH DELETE child)
     FOREACH (upload IN uploads | DETACH DELETE upload)
     FOREACH (bill IN CASE WHEN b IS NULL THEN [] ELSE [b] END | DETACH DELETE bill)
     RETURN true AS deletedBill`,
    { ownerUserId, billId }, { database: process.env.NEO4J_DATABASE || "neo4j" },
  );
  return records[0]?.get("deletedBill") === true;
}

export async function readBillOutputs(billId: string, ownerUserId: string) {
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill {billId: $billId})
     OPTIONAL MATCH (b)-[:HAS_OCR]->(ocr:OCRExtraction)
     OPTIONAL MATCH (b)-[:HAS_LLM_RESULT]->(llm:LLMResult)
     RETURN b.billId AS billId, b.sourceFile AS sourceFile, b.createdAt AS createdAt,
       ocr.dataJson AS ocrJson, llm.dataJson AS llmJson,
       coalesce(llm.workbookJson, b.workbookJson) AS workbookJson`,
    { ownerUserId, billId }, { database: process.env.NEO4J_DATABASE || "neo4j", routing: "READ" },
  );
  if (!records.length) return null;
  const record = records[0];
  const parse = (key: string) => {
    const value = record.get(key);
    return typeof value === "string" ? JSON.parse(value) : null;
  };
  return { billId: record.get("billId"), sourceFile: record.get("sourceFile"), createdAt: record.get("createdAt"), ocr: parse("ocrJson"), llm: parse("llmJson"), workbook: parse("workbookJson") };
}

export async function listUserBills(ownerUserId: string, offset = 0, limit = 25): Promise<SavedBillPage> {
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill)
     WITH DISTINCT b ORDER BY b.createdAt ASC, b.billId ASC
     SKIP $offset LIMIT $fetchLimit
     OPTIONAL MATCH (b)-[:HAS_OCR]->(ocr:OCRExtraction)
     OPTIONAL MATCH (b)-[:HAS_LLM_RESULT]->(llm:LLMResult)
     RETURN b.billId AS billId, b.sourceFile AS sourceFile, b.createdAt AS createdAt,
       b.classificationJson AS classificationJson, ocr.dataJson AS ocrJson,
       coalesce(llm.workbookJson, b.workbookJson) AS workbookJson
     ORDER BY createdAt ASC, billId ASC`,
    { ownerUserId, offset: int(offset), fetchLimit: int(limit + 1) },
    { database: process.env.NEO4J_DATABASE || "neo4j", routing: "READ" },
  );
  return {
    bills: records.slice(0, limit).map((record) => {
      const parse = (key: string) => {
        const value = record.get(key);
        return typeof value === "string" ? JSON.parse(value) : null;
      };
      return { billId: record.get("billId"), sourceFile: record.get("sourceFile") || "", createdAt: record.get("createdAt") || "",
        classification: parse("classificationJson"), workbook: parse("workbookJson"), ocr: parse("ocrJson") };
    }),
    nextOffset: records.length > limit ? offset + limit : null,
  };
}
