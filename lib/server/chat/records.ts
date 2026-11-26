import "server-only";

import { int } from "neo4j-driver";
import { getNeo4jDriver } from "@/lib/server/database/neo4j";
import type { ChatDocument } from "@/types/chat";

const config = () => ({ database: process.env.NEO4J_DATABASE || "neo4j", routing: "READ" as const,
  transactionConfig: { timeout: 10_000 } });

export async function listChatDocuments(ownerUserId: string, billId: string | null = null, offset = 0) {
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill)
     WHERE $billId IS NULL OR b.billId = $billId
     RETURN DISTINCT b.billId AS billId, b.sourceFile AS fileName, b.billNumber AS billNumber
     ORDER BY fileName, billId SKIP $offset LIMIT 101`,
    { ownerUserId, billId, offset: int(offset) }, config());
  return { documents: records.slice(0, 100).map((row): ChatDocument => ({ billId: row.get("billId"),
    fileName: row.get("fileName") || "Unnamed saved bill", billNumber: row.get("billNumber") })),
    nextOffset: records.length > 100 ? offset + 100 : null };
}

// Sum the stored decimal representations with integer arithmetic, avoiding binary
// floating-point accumulation. Preserve signs and precision; do not convert currencies.
export function sumDecimalAmounts(values: number[]): string {
  const parts = values.map((value) => {
    if (!Number.isFinite(value)) throw new Error("Invalid saved amount.");
    const [coefficient, exponent = "0"] = value.toString().toLowerCase().split("e");
    const fractional = coefficient.split(".")[1]?.length ?? 0;
    return { units: BigInt(coefficient.replace(".", "")), scale: fractional - Number(exponent) };
  });
  const scale = Math.max(2, ...parts.map((part) => part.scale));
  const total = parts.reduce((sum, part) => sum + part.units * BigInt(10) ** BigInt(scale - part.scale), BigInt(0));
  const digits = (total < BigInt(0) ? -total : total).toString().padStart(scale + 1, "0");
  const fraction = digits.slice(-scale).replace(/0+$/, "").padEnd(2, "0");
  return `${total < BigInt(0) ? "-" : ""}${digits.slice(0, -scale)}.${fraction}`;
}

export async function readBillTotals(ownerUserId: string, billId: string | null) {
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill)
     WHERE $billId IS NULL OR b.billId = $billId
     WITH DISTINCT b
     RETURN b.currency AS currency, collect(b.totalAmount) AS amounts, count(b) AS billCount`,
    { ownerUserId, billId }, config());
  const validCurrencies = new Set(Intl.supportedValuesOf("currency"));
  let excluded = 0;
  const totals: string[] = [];
  for (const row of records) {
    const currency = row.get("currency");
    const count = row.get("billCount");
    const billCount: number = typeof count === "number" ? count : count.toNumber();
    const amounts = (row.get("amounts") as unknown[]).map((value) => typeof value === "number" ? value
      : value && typeof value === "object" && "toNumber" in value ? (value as { toNumber(): number }).toNumber() : NaN)
      .filter((amount) => Number.isFinite(amount));
    if (!validCurrencies.has(currency)) { excluded += billCount; continue; }
    excluded += billCount - amounts.length;
    if (amounts.length) totals.push(`${currency} ${sumDecimalAmounts(amounts)} (${amounts.length} bill${amounts.length === 1 ? "" : "s"})`);
  }
  totals.sort();
  return { totals, excluded };
}
