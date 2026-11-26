import "server-only";

import { getNeo4jDriver } from "@/lib/server/database/neo4j";
import { sumDecimalAmounts } from "@/lib/server/chat/records";
import { completenessFields, validBillDate, type CompletenessField, type BillFilters, type ChatPlan } from "@/lib/server/chat/plan";

type StructuredBill = {
  billId: string;
  fileName: string;
  billNumber: string | null;
  billDate: string | null;
  vendor: string | null;
  currency: string | null;
  totalAmount: number | null;
  balanceDue: number | null;
  missingFields: CompletenessField[];
};
const numeric = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : value && typeof value === "object" && "toNumber" in value
    && typeof value.toNumber === "function" ? value.toNumber() : null;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
const markdown = (value: string) => value.replace(/[\\`*_\[\]<>]/g, "\\$&").replace(/[\r\n]+/g, " ");
const months = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, month, 1))));

/** Fetch complete metadata only, never OCR snippets. Authorization is fixed in code. */
export async function selectStructuredBills(ownerUserId: string, billId: string | null, plan: ChatPlan) {
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill)
     WHERE $billId IS NULL OR b.billId = $billId
     RETURN DISTINCT b.billId AS billId, b.sourceFile AS fileName, b.billNumber AS billNumber,
       b.billDate AS billDate, b.vendorName AS vendor, b.currency AS currency,
       b.totalAmount AS totalAmount, b.balanceDue AS balanceDue
     ORDER BY billId LIMIT 10001`,
    { ownerUserId, billId }, { database: process.env.NEO4J_DATABASE || "neo4j", routing: "READ",
      transactionConfig: { timeout: 10_000 } });
  if (records.length > 10_000) return null;
  let excluded = 0;
  const bills: StructuredBill[] = [];
  for (const record of records) {
    const bill: StructuredBill = { billId: record.get("billId"), fileName: text(record.get("fileName")) || "Unnamed saved bill",
      billNumber: text(record.get("billNumber")), billDate: validBillDate(record.get("billDate")) ? record.get("billDate") : null,
      vendor: text(record.get("vendor")), currency: text(record.get("currency")),
      totalAmount: numeric(record.get("totalAmount")), balanceDue: numeric(record.get("balanceDue")),
      // Inspect the raw saved value before date parsing, numeric conversion or
      // display fallbacks. Missing and invalid are different conditions.
      missingFields: completenessFields.filter((field) => {
        const value = record.get(field);
        return value === null || value === undefined || (typeof value === "string" && !value.trim());
      }) };
    const result = matches(bill, plan.filters);
    if (result === "no") continue;
    const dateRequired = plan.sort?.startsWith("date") || plan.groupBy === "month" || plan.groupBy === "year";
    const amountRequired = plan.sort?.startsWith("amount");
    if (result === "unknown" || (dateRequired && !bill.billDate) || (amountRequired && bill.totalAmount === null)) {
      excluded++;
      continue;
    }
    bills.push(bill);
  }
  return { bills, excluded };
}

function matches(bill: StructuredBill, filters: BillFilters): "yes" | "no" | "unknown" {
  let unknown = false;
  if (filters.completeness) {
    const checks = filters.completeness.checks.map(({ field, condition }) =>
      bill.missingFields.includes(field) === (condition === "missing"));
    if (filters.completeness.match === "all" ? !checks.every(Boolean) : !checks.some(Boolean)) return "no";
  }
  if (filters.months.length || filters.years.length || filters.from || filters.to) {
    if (!bill.billDate) unknown = true;
    else if ((filters.months.length && !filters.months.includes(Number(bill.billDate.slice(5, 7))))
      || (filters.years.length && !filters.years.includes(Number(bill.billDate.slice(0, 4))))
      || (filters.from && bill.billDate < filters.from) || (filters.to && bill.billDate > filters.to)) return "no";
  }
  for (const [field, requested] of [["vendor", filters.vendor], ["currency", filters.currency],
    ["billNumber", filters.billNumber], ["fileName", filters.fileName]] as const) {
    if (requested === null) continue;
    const saved = bill[field];
    if (saved === null) { unknown = true; continue; }
    if (field === "vendor" ? !normalize(saved).includes(normalize(requested)) : normalize(saved) !== normalize(requested)) return "no";
  }
  if (filters.payment !== null) {
    if (bill.balanceDue === null) unknown = true;
    else if (filters.payment === "paid" ? bill.balanceDue !== 0 : bill.balanceDue <= 0) return "no";
  }
  return unknown ? "unknown" : "yes";
}

export function describeBillFilters(filters: BillFilters) {
  const clauses: string[] = [];
  if (filters.months.length) clauses.push(`bill-date month ${filters.months.map((month) => months[month - 1]).join(", ")}${filters.years.length ? "" : " (across all years)"}`);
  if (filters.years.length) clauses.push(`bill-date year ${filters.years.join(", ")}`);
  if (filters.from) clauses.push(`bill date on or after ${filters.from}`);
  if (filters.to) clauses.push(`bill date on or before ${filters.to}`);
  if (filters.vendor) clauses.push(`vendor containing “${markdown(filters.vendor)}”`);
  if (filters.currency) clauses.push(`currency ${filters.currency}`);
  if (filters.billNumber) clauses.push(`invoice number “${markdown(filters.billNumber)}”`);
  if (filters.fileName) clauses.push(`filename “${markdown(filters.fileName)}”`);
  if (filters.payment) clauses.push(filters.payment === "paid" ? "saved balance due of zero" : "positive saved balance due");
  if (filters.completeness) {
    const labels: Record<CompletenessField, string> = { vendor: "vendor", billDate: "bill date", currency: "currency",
      totalAmount: "total amount", billNumber: "bill number", fileName: "filename", balanceDue: "balance due" };
    clauses.push(filters.completeness.checks.map(({ field, condition }) => `saved ${labels[field]} is ${condition}`)
      .join(filters.completeness.match === "all" ? " AND " : " OR "));
  }
  return clauses.length ? ` Filters: ${clauses.join("; ")}.` : "";
}

export function formatStructuredAnswer(plan: ChatPlan, selected: NonNullable<Awaited<ReturnType<typeof selectStructuredBills>>>) {
  const { bills } = selected;
  let excluded = selected.excluded;
  const scope = describeBillFilters(plan.filters);
  const note = () => excluded ? `\n\nExcluded ${excluded} bill${excluded === 1 ? "" : "s"} with missing or unusable fields required for this calculation.` : "";
  const details = (bill: StructuredBill, index: number) => `${index + 1}. **${markdown(bill.fileName)}**${bill.billDate ? ` — bill date **${bill.billDate}**` : " — bill date unknown"}${bill.billNumber ? ` (invoice ${markdown(bill.billNumber)})` : ""}${bill.totalAmount !== null && bill.currency ? `; ${bill.currency} ${sumDecimalAmounts([bill.totalAmount])}` : ""}`;
  if (plan.operation === "total") {
    const currencies = new Set(Intl.supportedValuesOf("currency"));
    const groups = new Map<string, number[]>();
    for (const bill of bills) {
      if (bill.totalAmount === null || !bill.currency || !currencies.has(bill.currency)) { excluded++; continue; }
      const label = groupLabel(bill, plan.groupBy);
      const key = plan.groupBy && plan.groupBy !== "currency" ? `${label} — ${bill.currency}` : bill.currency;
      const amounts = groups.get(key) || [];
      amounts.push(bill.totalAmount); groups.set(key, amounts);
    }
    const lines = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, amounts]) => `- ${markdown(label)} **${sumDecimalAmounts(amounts)}** (${amounts.length} bill${amounts.length === 1 ? "" : "s"})`);
    return `${lines.length ? `Sum of saved bill totals, kept separate by currency:${scope}\n${lines.join("\n")}` : `No bill totals with a known currency are available in this scope.${scope}`}${note()}\n\nThese are saved document totals, not confirmation of payment.`;
  }
  if (plan.operation === "count") {
    if (plan.groupBy) {
      const groups = new Map<string, number>();
      for (const bill of bills) { const key = groupLabel(bill, plan.groupBy); groups.set(key, (groups.get(key) || 0) + 1); }
      return `Saved bill counts by ${plan.groupBy}:${scope}\n${[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => `- ${markdown(label)}: **${count}**`).join("\n") || "No matching bills."}${note()}`;
    }
    const examples = bills.slice(0, Math.min(5, plan.limit)).map(details);
    return `Found **${bills.length} saved file${bills.length === 1 ? "" : "s"}**.${scope}${examples.length ? `\n\n${examples.join("\n")}` : ""}${bills.length > examples.length ? `\nShowing ${examples.length} of ${bills.length} matching files.` : ""}${note()}`;
  }
  if (plan.sort?.startsWith("amount") && new Set(bills.map((bill) => bill.currency)).size > 1)
    return "These bills have different currencies. Which currency should I use for the amount ranking?";
  if (plan.sort?.startsWith("amount") && bills.some((bill) => !bill.currency))
    return "Some bills have an unknown currency. Specify a currency before ranking their amounts.";
  const sorted = [...bills].sort((a, b) => {
    const difference = plan.sort?.startsWith("amount") ? a.totalAmount! - b.totalAmount!
      : plan.sort?.startsWith("date") ? a.billDate!.localeCompare(b.billDate!) : a.fileName.localeCompare(b.fileName);
    return (plan.sort?.endsWith("Desc") ? -difference : difference) || a.billId.localeCompare(b.billId);
  });
  const shown = sorted.slice(0, plan.limit);
  return `${shown.length ? `Saved files${plan.sort ? ` (sorted by ${plan.sort.startsWith("date") ? "bill date" : "total amount"}, ${plan.sort.endsWith("Desc") ? "descending" : "ascending"})` : ""}:${scope}\n${shown.map(details).join("\n")}` : `No matching saved files.${scope}`}${bills.length > shown.length ? `\nShowing ${shown.length} of ${bills.length} matching files.` : ""}${note()}`;
}

function groupLabel(bill: StructuredBill, group: ChatPlan["groupBy"]) {
  if (group === "month") return months[Number(bill.billDate!.slice(5, 7)) - 1];
  if (group === "year") return bill.billDate!.slice(0, 4);
  if (group === "vendor") return bill.vendor || "Unknown vendor";
  return bill.currency || "Unknown currency";
}
