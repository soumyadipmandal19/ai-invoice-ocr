import "server-only";

import { int } from "neo4j-driver";
import { getNeo4jDriver } from "@/lib/server/database/neo4j";
import type { DocumentFilesPage } from "@/types/documents";

const numeric = (value: number | { toNumber(): number } | null) => typeof value === "number" ? value : value?.toNumber() ?? 0;

export async function listDocumentFiles(ownerUserId: string, offset: number, query: string, folder: string): Promise<DocumentFilesPage> {
  const driver = getNeo4jDriver();
  const config = { database: process.env.NEO4J_DATABASE || "neo4j", routing: "READ" as const };
  const [page, folders] = await Promise.all([
    driver.executeQuery(
      `MATCH (:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill)
       WHERE ($folder = '' OR coalesce(b.documentType, 'other') = $folder)
         AND ($query = '' OR toLower(coalesce(b.sourceFile, '')) CONTAINS $query
           OR toLower(coalesce(b.billNumber, '')) CONTAINS $query)
       WITH DISTINCT b ORDER BY b.createdAt DESC, b.billId ASC SKIP $offset LIMIT 51
       OPTIONAL MATCH (b)-[:HAS_OCR]->(ocr:OCRExtraction)
       RETURN b.billId AS billId, b.sourceFile AS fileName, b.documentType AS documentType,
         b.billNumber AS billNumber, b.createdAt AS createdAt, ocr.pageCount AS pageCount
       ORDER BY createdAt DESC, billId ASC`,
      { ownerUserId, offset: int(offset), query, folder }, config),
    driver.executeQuery(
      `MATCH (:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill)
       RETURN coalesce(b.documentType, 'other') AS type, count(DISTINCT b) AS count ORDER BY type`,
      { ownerUserId }, config),
  ]);
  return { files: page.records.slice(0, 50).map((row) => ({ billId: row.get("billId"),
    fileName: row.get("fileName") || "Saved document", documentType: row.get("documentType") || "other",
    billNumber: row.get("billNumber"), createdAt: row.get("createdAt") || "", pageCount: numeric(row.get("pageCount")) })),
    nextOffset: page.records.length > 50 ? offset + 50 : null,
    folders: folders.records.map((row) => ({ type: row.get("type"), count: numeric(row.get("count")) })) };
}
