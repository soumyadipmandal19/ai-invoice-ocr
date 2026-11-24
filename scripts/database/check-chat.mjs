// Full local-embedding -> Neo4j -> NVIDIA check using only synthetic sources.
// Fixture graph changes are rolled back; schema initialization is retained.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { getNeo4jDriver } = await import("../../lib/server/database/neo4j.ts");
const { ensureEmbeddingIndex } = await import("../../lib/server/database/schema.ts");
const { embedTexts } = await import("../../lib/server/embeddings/local.ts");
const { EMBEDDING_PROFILE, EMBEDDING_MODEL } = await import("../../lib/server/embeddings/chunks.ts");
const { answerDocumentQuestion } = await import("../../lib/server/chat/service.ts");
const { readChatIndexing, retrieveChatSources } = await import("../../lib/server/chat/retrieval.ts");
let driver;
let session;
let transaction;
try {
  driver = getNeo4jDriver();
  await ensureEmbeddingIndex();
  const texts = ["Synthetic invoice ALPHA. Payment is due within 30 days.", "Synthetic invoice BETA. Payment is due within 60 days."];
  const vectors = await embedTexts(texts);
  session = driver.session({ database: process.env.NEO4J_DATABASE || "neo4j" });
  transaction = session.beginTransaction({ timeout: 180_000 });
  globalThis.auraDriver = { executeQuery: (query, parameters) => transaction.run(query, parameters) };
  const ownerUserId = `chat-check-${randomUUID()}`;
  const billIds = [randomUUID(), randomUUID()];
  for (let index = 0; index < texts.length; index++) {
    await transaction.run(
      `MERGE (u:User {id: $ownerUserId})
       CREATE (u)-[:UPLOADED]->(b:Bill {billId: $billId, billNumber: $billNumber, sourceFile: $fileName, currency: 'USD', totalAmount: $amount})
       CREATE (b)-[:HAS_EMBEDDINGS]->(e:DocumentEmbeddings {embeddingId: $billId, billId: $billId,
         ownerUserId: $ownerUserId, profile: $profile, model: $model, dimensions: 768, status: 'ready', chunkCount: 1})
       CREATE (e)-[:HAS_CHUNK]->(:DocumentChunk {chunkId: $billId, billId: $billId,
         embeddingId: $billId, ownerUserId: $ownerUserId, page: 1, text: $text, embedding: $vector})`,
      { ownerUserId, billId: billIds[index], fileName: `synthetic-${index === 0 ? "alpha" : "beta"}.txt`,
        text: texts[index], vector: vectors[index], profile: EMBEDDING_PROFILE, model: EMBEDDING_MODEL,
        billNumber: index === 0 ? "48482" : "16552", amount: index === 0 ? 1.1 : 2.2 });
  }
  assert.equal((await readChatIndexing(ownerUserId)).readyBills, 2);
  assert.equal((await readChatIndexing(`${ownerUserId}-foreign`)).readyBills, 0);
  assert.equal((await retrieveChatSources(`${ownerUserId}-foreign`, vectors[0])).length, 0);
  const result = await answerDocumentQuestion(ownerUserId, "What payment terms are listed for the ALPHA and BETA invoices?", []);
  assert.ok(/30|thirty/i.test(result.answer));
  assert.ok(/60|sixty/i.test(result.answer));
  assert.equal(new Set(result.sources.map((source) => source.billId)).size, 2);
  assert.ok(result.sources.every((source) => billIds.includes(source.billId)));
  assert.ok(result.model);
  const count = await answerDocumentQuestion(ownerUserId, "How many bills are there?", []);
  assert.equal(count.answer, "You have 2 saved bills.");
  const files = await answerDocumentQuestion(ownerUserId, "List down the uploaded file names", []);
  assert.ok(files.answer.includes("synthetic-alpha.txt") && files.answer.includes("synthetic-beta.txt"));
  const total = await answerDocumentQuestion(ownerUserId, "What is my total spending?", []);
  assert.ok(total.answer.includes("USD 3.30 (2 bills)"));
  const single = await answerDocumentQuestion(ownerUserId, "When is payment due for invoice 48482?", []);
  assert.ok(/30|thirty/i.test(single.answer));
  assert.ok(single.sources.length > 0 && single.sources.every((source) => source.billId === billIds[0]));
  assert.equal(single.contextBillId, billIds[0]);
  const { readSummarySources } = await import("../../lib/server/chat/retrieval.ts");
  assert.equal((await readSummarySources(ownerUserId, null)).length, 2);
  assert.equal((await readSummarySources(ownerUserId, billIds[0])).length, 1);
  console.log(JSON.stringify({ localEmbedding: true, retrieval: true, ownerIsolation: true,
    citedBills: result.sources.length, singleFile: true, countAndFilenames: true, currencyTotals: true,
    exhaustiveSummaryQuery: true, directChat: true, answerModel: result.model, syntheticOnly: true, fixtureRollback: true }));
} catch (error) {
  console.error("Chat workflow check failed:", error.code || error.name);
  if (error.code === "ERR_ASSERTION") console.error(error.stack);
  // Safe application-defined errors contain configuration hints, never response bodies/OCR.
  if (error.name === "ChatModelError") console.error(error.message);
  process.exitCode = 1;
} finally {
  globalThis.auraDriver = driver;
  if (transaction) await transaction.rollback();
  if (session) await session.close();
  if (driver) await driver.close();
}
