// Validate the actual store queries against Neo4j. Fixture data is rolled back.
// Schema constraints/index initialization is intentionally retained.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });

const { getNeo4jDriver } = await import("../../lib/server/database/neo4j.ts");
const { ensureEmbeddingIndex } = await import("../../lib/server/database/schema.ts");
const { EMBEDDING_PROFILE } = await import("../../lib/server/embeddings/chunks.ts");
const store = await import("../../lib/server/embeddings/store.ts");
const { deleteOwnedBill } = await import("../../lib/server/bills/store.ts");
const { deleteAccount } = await import("../../lib/server/auth/store.ts");
const { listDocumentFiles } = await import("../../lib/server/documents/store.ts");

let driver;
let session;
let transaction;
try {
  driver = getNeo4jDriver();
  await ensureEmbeddingIndex();
  session = driver.session({ database: process.env.NEO4J_DATABASE || "neo4j" });
  transaction = session.beginTransaction();
  globalThis.auraDriver = { executeQuery: (query, parameters) => transaction.run(query, parameters) };
  const ownerUserId = `embedding-check-${randomUUID()}`;
  const billId = randomUUID();
  const vector = Array(768).fill(0.01);
  const ocr = { pageCount: 1, pages: [{ page: 1, text: "Embedding model test fixture.", method: "text" }],
    structured: { schemaVersion: 1, fields: [], tables: [], warnings: [] } };
  await transaction.run(
    `CREATE (u:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill {billId: $billId,
       embeddingStatus: 'ready', embeddingProfile: $profile, embeddingChunkCount: 1,
       embeddingFingerprint: 'original', embeddingRequestId: 'legacy-run'})
     CREATE (b)-[:HAS_OCR]->(:OCRExtraction {extractionId: $billId, dataJson: $data})
     CREATE (b)-[:HAS_CHUNK]->(:DocumentChunk {chunkId: $chunkId, billId: $billId,
       text: 'Original fixture', embedding: $vector, model: 'nomic-embed-text-v1.5', dimensions: 768})`,
    { ownerUserId, billId, profile: EMBEDDING_PROFILE, chunkId: `${billId}:1:0`, data: JSON.stringify(ocr), vector });

  assert.equal((await store.readEmbeddingDocument(billId, ownerUserId)).status, "ready");
  const files = await listDocumentFiles(ownerUserId, 0, "", "other");
  assert.equal(files.files.length, 1);
  assert.equal(files.files[0].billId, billId);
  assert.equal(files.folders[0].count, 1);
  assert.equal((await listDocumentFiles("other-owner", 0, "", "")).files.length, 0);
  assert.equal((await listDocumentFiles(ownerUserId, 0, "no-matching-file", "")).files.length, 0);
  assert.equal(await store.readEmbeddingDocument(billId, "other-owner"), null);
  assert.equal(await store.markEmbeddingQueued(billId, ownerUserId, "unused"), false);
  const { records } = await transaction.run(
    `MATCH (b:Bill {billId: $billId})-[:HAS_EMBEDDINGS]->(e:DocumentEmbeddings)-[:HAS_CHUNK]->(c:DocumentChunk)
     RETURN e.embeddingId AS id, e.chunkCount AS count, e.status AS status, c.embedding AS vector,
       c.embeddingId AS groupId, b.embeddingStatus AS legacyStatus, c.model AS legacyModel,
       EXISTS { MATCH (b)-[:HAS_CHUNK]->() } AS directLinks`, { billId });
  assert.equal(records.length, 1);
  const row = records[0];
  assert.equal(row.get("id"), billId);
  assert.equal(row.get("groupId"), billId);
  assert.equal(row.get("count").toNumber(), 1);
  assert.equal(row.get("status"), "ready");
  assert.deepEqual(row.get("vector"), vector);
  assert.equal(row.get("legacyStatus"), null);
  assert.equal(row.get("legacyModel"), null);
  assert.equal(row.get("directLinks"), false);
  await transaction.run("MATCH (e:DocumentEmbeddings {embeddingId: $billId}) SET e.profile = 'old'", { billId });
  assert.equal(await store.markEmbeddingQueued(billId, ownerUserId, "current-run"), true);
  await store.failEmbedding(billId, ownerUserId, "stale-run");
  assert.equal((await store.readEmbeddingDocument(billId, ownerUserId)).status, "queued");
  assert.equal(await store.saveDocumentEmbeddings(billId, ownerUserId, "current-run", "new", [{
    chunkId: `${billId}:1:0`, embeddingId: billId, billId, ownerUserId, page: 1, position: 0,
    text: "New fixture", textHash: "fixture", embedding: vector,
  }]), true);
  assert.equal((await store.readEmbeddingDocument(billId, ownerUserId)).status, "ready");
  assert.equal(await deleteOwnedBill(billId, ownerUserId), true);
  const afterDelete = await transaction.run(
    "MATCH (n) WHERE n.billId = $billId OR n.embeddingId = $billId OR n.extractionId = $billId RETURN count(n) AS remaining", { billId });
  assert.equal(afterDelete.records[0].get("remaining").toNumber(), 0);
  assert.equal(await store.ensureBillEmbeddingGroup(billId, ownerUserId), false);

  const secondId = randomUUID();
  const token = randomUUID().replaceAll("-", "").repeat(2);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await transaction.run(
    `MATCH (u:User {id: $ownerUserId})
     CREATE (:Session {tokenHash: $tokenHash, expiresAt: $expiresAt})-[:BELONGS_TO]->(u)
     CREATE (u)-[:UPLOADED]->(b:Bill {billId: $secondId})
     CREATE (b)-[:HAS_EMBEDDINGS]->(:DocumentEmbeddings {embeddingId: $secondId, billId: $secondId})-[:HAS_CHUNK]->(:DocumentChunk {chunkId: $groupedId, billId: $secondId})
     CREATE (b)-[:HAS_CHUNK]->(:DocumentChunk {chunkId: $legacyId, billId: $secondId})`,
    { ownerUserId, tokenHash, expiresAt: Date.now() + 60_000, secondId, groupedId: `${secondId}:grouped`, legacyId: `${secondId}:legacy` });
  assert.equal(await deleteAccount(token), true);
  const afterAccount = await transaction.run(
    "MATCH (n) WHERE n.billId = $secondId OR n.embeddingId = $secondId OR n.id = $ownerUserId RETURN count(n) AS remaining",
    { ownerUserId, secondId });
  assert.equal(afterAccount.records[0].get("remaining").toNumber(), 0);
  console.log("Embedding graph validated: legacy migration, grouped storage, ownership, stale requests, and bill/account cleanup. Fixture transaction will be rolled back.");
} catch (error) {
  console.error("Embedding graph check failed:", error.code || error.name);
  process.exitCode = 1;
} finally {
  globalThis.auraDriver = driver;
  if (transaction) await transaction.rollback();
  if (session) await session.close();
  if (driver) await driver.close();
}
