import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// Compile the real graph queries against Aura using EXPLAIN only: never write data.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { getNeo4jDriver } = await import("../../lib/server/database/neo4j.ts");
const { normalizeBill } = await import("../../lib/server/bills/normalize.ts");
const { organizeFinancialDocument } = await import("../../lib/financial-workbook.ts");
const { storeBill, readBillOutputs, listUserBills, deleteOwnedBill } = await import("../../lib/server/bills/store.ts");
const { deleteAccount } = await import("../../lib/server/auth/store.ts");
let actual;
let checked = 0;
try {
  actual = getNeo4jDriver();
  await actual.verifyConnectivity();
  // Capture exactly the statements/parameters used by the stores. Schema creation
  // is skipped, and every data query sent to Aura is prefixed with EXPLAIN.
  globalThis.auraDriver = { executeQuery: async (query, values, config) => {
    if (query.startsWith("CREATE CONSTRAINT")) return { records: [] };
    await actual.executeQuery(`EXPLAIN ${query}`, values, config);
    checked++;
    return { records: [{ get: (key) => ({ billId: values.billId, itemCount: values.itemCount, deleted: true, deletedBill: true })[key] }] };
  } };
  const example = JSON.parse(await readFile(new URL("../../data/bills/example.json", import.meta.url), "utf8"));
  const classification = { documentType: "receipt", isFinancialDocument: true, sampledBytes: 10, model: null };
  const id = randomUUID();
  const document = { sourceFileName: "query-check-only.pdf", pages: [], structured: { fields: [], tables: [], warnings: [] } };
  const workbook = organizeFinancialDocument(document, classification, { documentId: id, organization: {
    receipt: { document_number: example.bills[0].billNumber, total: "1180.00", currency: "INR" },
    items: [{ product_name: "Query check only", quantity: "1", line_total: "1180.00" }],
    warnings: [], model: "query-check", inputBytes: 0, chunks: 1,
  } });
  const normalized = normalizeBill(id, "query-check-no-real-user", workbook, classification);
  await storeBill(normalized.bill, normalized.items, { ocr: { ...document, pageCount: 1 }, organization: { receipt: {}, items: [], warnings: [], model: "query-check", inputBytes: 0, chunks: 1 }, mappingResults: [] });
  await readBillOutputs(id, "query-check-no-real-user");
  await listUserBills("query-check-no-real-user", 0, 25);
  await deleteOwnedBill(id, "query-check-no-real-user");
  await deleteAccount("0".repeat(64));
  console.log(`${checked} graph queries passed Neo4j EXPLAIN. No nodes, relationships, or constraints were changed.`);
} catch (error) {
  console.error("Bill query validation failed.", typeof error?.code === "string" ? error.code : "Check server configuration and connectivity.");
  process.exitCode = 1;
} finally {
  await actual?.close();
}
