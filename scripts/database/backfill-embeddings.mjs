// Administrative maintenance: process saved bills across owners, locally and sequentially.
// Ownership is obtained from graph relationships, never from untrusted input.
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });

const { getNeo4jDriver } = await import("../../lib/server/database/neo4j.ts");
const { EMBEDDING_PROFILE } = await import("../../lib/server/embeddings/chunks.ts");
const { ensureEmbeddingIndex } = await import("../../lib/server/database/schema.ts");
const store = await import("../../lib/server/embeddings/store.ts");
const { indexBillEmbeddings } = await import("../../lib/server/embeddings/service.ts");
const run = process.argv.includes("--run");
if (process.argv.slice(2).some((argument) => !["--run", "--dry-run"].includes(argument))) {
  throw new Error("Use --dry-run (default) or --run.");
}
const totals = { inspected: 0, generated: 0, reused: 0, needsIndexing: 0, missingOcr: 0, inProgress: 0, failed: 0, generatedChunks: 0 };
let driver;
try {
  driver = getNeo4jDriver();
  const config = { database: process.env.NEO4J_DATABASE || "neo4j" };
  if (run) await ensureEmbeddingIndex();
  let afterBill = "";
  let afterOwner = "";
  while (true) {
    const { records } = await driver.executeQuery(
      `MATCH (u:User)-[:UPLOADED]->(b:Bill)
       WHERE b.billId > $afterBill OR (b.billId = $afterBill AND u.id > $afterOwner)
       RETURN DISTINCT b.billId AS billId, u.id AS ownerUserId
       ORDER BY billId, ownerUserId LIMIT 25`, { afterBill, afterOwner }, config);
    if (!records.length) break;
    for (const row of records) {
      const billId = row.get("billId");
      const ownerUserId = row.get("ownerUserId");
      afterBill = billId; afterOwner = ownerUserId;
      totals.inspected++;
      let requestId;
      try {
        const source = await store.readEmbeddingDocument(billId, ownerUserId);
        if (!source) continue; // A concurrent deletion may remove a scanned bill.
        if (source.status === "ready" && source.profile === EMBEDDING_PROFILE) {
          if (run) await store.ensureBillEmbeddingGroup(billId, ownerUserId);
          totals.reused++;
        } else if (!source.document) {
          totals.missingOcr++;
        } else if (!run) {
          totals.needsIndexing++;
        } else {
          requestId = randomUUID();
          if (!await store.markEmbeddingQueued(billId, ownerUserId, requestId)) {
            const current = await store.readEmbeddingDocument(billId, ownerUserId);
            if (current?.status === "ready" && current.profile === EMBEDDING_PROFILE) totals.reused++;
            else totals.inProgress++;
          } else {
            const result = await indexBillEmbeddings(billId, ownerUserId, requestId);
            if (result.status === "ready") {
              totals.generated++; totals.generatedChunks += result.chunkCount;
            } else totals.inProgress++;
          }
        }
      } catch {
        totals.failed++;
        if (run && requestId) {
          try { await store.failEmbedding(billId, ownerUserId, requestId); } catch { /* Report and continue the remaining bills. */ }
        }
        console.error(JSON.stringify({ billId, status: "failed", message: "Check local model, OCR limits, and database availability; rerun to retry." }));
      }
      if (run) console.log(JSON.stringify({ progress: totals.inspected, generated: totals.generated, reused: totals.reused, failed: totals.failed }));
    }
  }
  const { records: status } = await driver.executeQuery(
    `MATCH (:User)-[:UPLOADED]->(:Bill)-[:HAS_EMBEDDINGS]->(e:DocumentEmbeddings)
     RETURN e.status AS status, count(DISTINCT e) AS groups ORDER BY status`, {}, config);
  const { records: verification } = await driver.executeQuery(
    `MATCH (u:User)-[:UPLOADED]->(b:Bill)-[:HAS_EMBEDDINGS]->(e:DocumentEmbeddings)
     OPTIONAL MATCH (e)-[:HAS_CHUNK]->(c:DocumentChunk)
     WITH u, b, e, collect(c) AS chunks
     RETURN count(e) AS groups, sum(size(chunks)) AS chunks,
       sum(CASE WHEN e.status = 'ready' AND e.chunkCount <> size(chunks) THEN 1 ELSE 0 END) AS invalidCounts,
       sum(size([c IN chunks WHERE size(c.embedding) <> 768
         OR coalesce(c.embeddingId, '') <> e.embeddingId
         OR coalesce(c.ownerUserId, '') <> u.id
         OR coalesce(c.billId, '') <> b.billId])) AS invalidChunks`, {}, config);
  const number = (value) => typeof value === "number" ? value : value?.toNumber() ?? 0;
  const checked = verification[0];
  const result = { mode: run ? "run" : "dry-run", ...totals,
    statuses: status.map((row) => ({ status: row.get("status"), groups: number(row.get("groups")) })),
    verification: Object.fromEntries(["groups", "chunks", "invalidCounts", "invalidChunks"].map((key) => [key, number(checked?.get(key))])) };
  console.log(JSON.stringify(result));
  if (totals.failed || result.verification.invalidCounts || result.verification.invalidChunks) process.exitCode = 1;
} catch (error) {
  console.error("Embedding backfill unavailable:", error.code || error.name);
  process.exitCode = 1;
} finally { await driver?.close(); }
