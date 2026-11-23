import { PRODUCT_COLUMNS, RECEIPT_COLUMNS, type CsvSheet, type FinancialWorkbook } from "@/lib/financial/workbook";
import { currencyCode } from "@/lib/financial/currency";
import type { WorkspaceRecord } from "@/types/workspace/record";

export const RECORD_STATUS = {
  extracting: "Extracting", checking: "Organizing", ready: "Organized",
  unsupported: "Not organized", failed: "Processing failed",
};

const COLUMN_LABELS: Record<string, string> = {
  document_date: "Bill date", merchant_name: "Vendor", document_type: "Document type",
  document_number: "Bill number", order_id: "Order ID", shipping_method: "Shipping method", currency: "Currency", subtotal: "Subtotal",
  discount: "Discount amount", tax: "Tax amount", shipping: "Shipping amount", total: "Total",
  amount_paid: "Amount paid", balance_due: "Balance due", payment_method: "Payment method",
  customer_name: "Customer", merchant_tax_id: "Vendor tax ID", document_id: "Bill ID",
  source_file: "Source file", review_status: "Review status", notes: "Notes",
  product_name: "Product / service", product_code: "Product code", category: "Category",
  quantity: "Quantity", unit: "Unit", unit_price: "Unit price", discount_rate: "Discount rate (%)",
  tax_rate: "Tax rate (%)", line_total: "Line total", line_number: "Item number", source_page: "Source page",
  processing_status: "Processing status", pages: "Pages", added_at: "Added at", storage: "Storage", review_notes: "Review notes",
};
export const sessionColumnLabel = (key: string) => COLUMN_LABELS[key] || key;
export const BILL_ESSENTIAL_COLUMNS = ["document_number", "document_date", "merchant_name", "currency", "subtotal", "tax", "total", "review_status", "File"];
export const ITEM_ESSENTIAL_COLUMNS = ["document_number", "product_name", "quantity", "unit_price", "discount", "tax", "line_total", "currency"];
const metadataColumns = ["Index", "File", "processing_status", "pages", "storage", "added_at", "review_notes"];

type Source = { recordId: string; sheetId?: string; row?: number; issues?: Record<string, string>; editableFields?: string[] };
export type SessionSheet = CsvSheet & { sources: Source[]; prefix: number; editableColumns: boolean[] };

export function receiptValues(record: WorkspaceRecord): Record<string, string> {
  const sheet = record.workbook?.sheets.find((sheet) => sheet.id === "receipts");
  return Object.fromEntries((sheet?.columns || []).map((key, index) => [key, sheet?.rows[0]?.[index] || ""]));
}

export function billReview(record: WorkspaceRecord) {
  const values = receiptValues(record);
  const issues: Record<string, string> = {};
  const reasons: string[] = [];
  if (record.error) reasons.push(record.error);
  if (record.status === "failed" || record.status === "unsupported") reasons.push(RECORD_STATUS[record.status]);
  if (record.job?.persistence?.status === "failed") reasons.push("Saving failed; retry saving this bill.");
  if (record.workbook) {
    for (const key of ["document_number", "document_date", "merchant_name", "currency", "total"]) {
      if (!values[key]?.trim()) issues[key] = `${sessionColumnLabel(key)} is missing. Check the source document.`;
    }
    if (values.currency && !currencyCode(values.currency)) issues.currency = "The printed currency indicator does not establish an exact currency code.";
    if (values.document_date && !isoBillDate(values.document_date)) issues.document_date = "The bill date needs review. Use YYYY-MM-DD after checking the source.";
    reasons.push(...Object.values(issues));
    const products = record.workbook.sheets.find((sheet) => sheet.id === "items");
    for (const [index, row] of (products?.rows || []).entries()) {
      for (const key of ["product_name", "quantity", "unit_price", "line_total"]) {
        const column = products!.columns.indexOf(key);
        if (column < 0 || !row[column]?.trim()) reasons.push(`Item ${index + 1}: ${sessionColumnLabel(key)} is missing.`);
      }
    }
    reasons.push(...record.workbook.warnings.filter((warning) => !/^(Financial columns were organized|Missing or unsupported values)/.test(warning)));
    if (!/^reviewed$/i.test(values.review_status?.trim() || "")) reasons.push("Not yet marked as reviewed.");
  }
  const processing = record.status === "extracting" || record.status === "checking";
  if (!processing && !record.workbook && !reasons.length) reasons.push("Financial data has not been organized.");
  const unique = [...new Set(reasons)];
  return { issues, reasons: unique, needsReview: !processing && unique.length > 0,
    status: processing ? RECORD_STATUS[record.status] : unique.length ? "Needs review" : record.workbook ? "Reviewed" : "Not organized" };
}

export function isoBillDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

/** Spreadsheet notes are a concise checklist; full messages stay in bill details. */
export function conciseReviewNotes(reasons: string[]) {
  const summaries = new Set<string>();
  for (const reason of reasons) {
    if (reason === "Not yet marked as reviewed.") continue;
    const missing = reason.match(/^(.*?) is missing\./);
    const unverified = reason.match(/(?:model value for|label does not describe) (\w+)/i);
    const conflict = reason.match(/Conflicting (?:model mappings|evidence) for (\w+)/i);
    if (missing) summaries.add(`${missing[1]} missing`);
    else if (/printed currency indicator|exact currency code|currency code.*unconfirmed/i.test(reason)) summaries.add("Currency unconfirmed");
    else if (/bill date needs review/i.test(reason)) summaries.add("Check bill date");
    else if (unverified) summaries.add(`${sessionColumnLabel(unverified[1])} unverified`);
    else if (conflict) summaries.add(`Conflicting ${sessionColumnLabel(conflict[1]).toLowerCase()}`);
    else if (/conflicting currencies/i.test(reason)) summaries.add("Conflicting currencies");
    else if (/^Item \d+:.*(?:differs|mismatch)/i.test(reason)) summaries.add(`${reason.match(/^Item \d+/)![0]}: total mismatch`);
    else if (/^Subtotal.*differs/i.test(reason)) summaries.add("Bill totals mismatch");
    else if (/saving failed|save failed/i.test(reason)) summaries.add("Save failed");
    else if (/processing failed/i.test(reason)) summaries.add("Processing failed");
    else if (/not organized|not been organized/i.test(reason)) summaries.add("Not organized");
    else summaries.add("Source check needed");
  }
  const unique = [...summaries];
  return [...unique.slice(0, 4), ...(unique.length > 4 ? [`+${unique.length - 4} more checks`] : [])].join("; ");
}

const userNotes = (value: string | undefined) => value === "Mapped by LLM; verify against the source." ? "" : value || "";

export type BillFilters = { query: string; vendor: string; currency: string; dateFrom: string; dateTo: string; status: string };
export const EMPTY_BILL_FILTERS: BillFilters = { query: "", vendor: "", currency: "", dateFrom: "", dateTo: "", status: "" };
export function filterWorkspaceRecords(records: WorkspaceRecord[], filters: BillFilters) {
  return records.filter((record) => {
    const values = receiptValues(record);
    const review = billReview(record);
    const query = filters.query.trim().toLowerCase();
    const searchable = [record.fileName, values.document_number, values.merchant_name,
      ...(record.workbook?.sheets.find((sheet) => sheet.id === "items")?.rows.map((row) => row.join(" ")) || [])].join(" ").toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (filters.vendor && values.merchant_name !== filters.vendor) return false;
    if (filters.currency && (currencyCode(values.currency) || values.currency || "unknown") !== filters.currency) return false;
    const date = isoBillDate(values.document_date);
    if ((filters.dateFrom || filters.dateTo) && (!date || (filters.dateFrom && date < filters.dateFrom) || (filters.dateTo && date > filters.dateTo))) return false;
    if (filters.status === "needs-review" && !review.needsReview) return false;
    if (filters.status === "reviewed" && review.status !== "Reviewed") return false;
    if (filters.status === "processing" && !["extracting", "checking"].includes(record.status)) return false;
    if (filters.status === "failed" && record.status !== "failed" && record.job?.persistence?.status !== "failed") return false;
    return true;
  });
}

function makeSheet(id: string, name: string, preferred: string[], columns: readonly string[]): SessionSheet {
  const ordered = [...new Set([...preferred, ...columns.filter((key) => key !== "source_file"), ...metadataColumns])];
  return { id, name, prefix: 0, columns: ordered, rows: [], sources: [],
    editableColumns: ordered.map((key) => columns.includes(key) && !["document_id", "line_number", "source_page"].includes(key) && !(id === "items" && key === "review_status")) };
}

/** One bill row per upload; item rows join to their parent through a stable Bill ID. */
export function buildSessionSheets(records: WorkspaceRecord[]): SessionSheet[] {
  const bills = makeSheet("receipts", "Bills", BILL_ESSENTIAL_COLUMNS, RECEIPT_COLUMNS);
  const items = makeSheet("items", "Bill Items", ITEM_ESSENTIAL_COLUMNS, PRODUCT_COLUMNS);
  for (const record of records) {
    const receipt = record.workbook?.sheets.find((sheet) => sheet.id === "receipts");
    const values = receiptValues(record);
    const review = billReview(record);
    const metadata = {
      Index: String(record.index), File: record.fileName,
      document_id: values.document_id || record.job?.persistence?.billId || record.id,
      processing_status: RECORD_STATUS[record.status],
      pages: record.result ? String(record.result.pageCount) : "",
      added_at: record.addedAt, review_notes: conciseReviewNotes(review.reasons),
      storage: record.job?.persistence?.status === "saved" ? "Saved" : record.job?.persistence?.status === "failed" ? "Save failed" : ["extracting", "checking"].includes(record.status) ? "Pending" : "Not saved",
    };
    const bill = { ...values, ...metadata, document_type: values.document_type || record.job?.result?.documentType || "", review_status: review.status, notes: userNotes(values.notes) };
    bills.rows.push(bills.columns.map((key) => bill[key as keyof typeof bill] || ""));
    bills.sources.push({ recordId: record.id, ...(receipt?.rows[0] ? { sheetId: "receipts", row: 0, editableFields: receipt.columns } : {}), issues: { ...review.issues, ...(review.needsReview ? { review_status: review.reasons.join("\n") } : {}) } });
    const products = record.workbook?.sheets.find((sheet) => sheet.id === "items");
    for (const [row, cells] of (products?.rows || []).entries()) {
      const item = Object.fromEntries(products!.columns.map((key, column) => [key, cells[column] || ""]));
      const issues: Record<string, string> = {};
      for (const key of ["product_name", "quantity", "unit_price", "line_total"]) if (!item[key]?.trim()) issues[key] = `${sessionColumnLabel(key)} is missing. Check the source document.`;
      const itemCurrency = products!.columns.includes("currency") ? item.currency : values.currency;
      if (!itemCurrency?.trim()) issues.currency = "Currency is missing. Check the source document.";
      else if (!currencyCode(itemCurrency)) issues.currency = "The printed currency indicator does not establish an exact currency code.";
      const itemReasons = [...Object.values(issues), ...review.reasons.filter((reason) => reason.startsWith(`Item ${row + 1}:`))];
      const data = { ...values, ...item, ...metadata, document_number: item.document_number || values.document_number || "", review_status: review.status, review_notes: conciseReviewNotes(itemReasons), notes: userNotes(item.notes) };
      items.rows.push(items.columns.map((key) => data[key as keyof typeof data] || ""));
      items.sources.push({ recordId: record.id, sheetId: "items", row, issues, editableFields: products!.columns });
    }
  }
  const needsReview = { ...bills, id: "needs-review", name: "Needs review", rows: [] as string[][], sources: [] as Source[] };
  bills.sources.forEach((source, index) => {
    if (billReview(records[index]).needsReview) {
      needsReview.rows.push(bills.rows[index]);
      needsReview.sources.push(source);
    }
  });
  return [bills, items, needsReview];
}

export function selectSessionColumns(sheet: SessionSheet, keys: string[]): SessionSheet {
  const indices = keys.map((key) => sheet.columns.indexOf(key)).filter((index) => index >= 0);
  return { ...sheet, prefix: 0, columns: indices.map((index) => sheet.columns[index]),
    rows: sheet.rows.map((row) => indices.map((index) => row[index])), editableColumns: indices.map((index) => sheet.editableColumns[index]) };
}

export function canEditSessionCell(sheet: SessionSheet, row: number, column: number) {
  const source = sheet.sources[row - 1];
  return row > 0 && !!source?.sheetId && !!sheet.editableColumns[column - sheet.prefix]
    && (!source.editableFields || source.editableFields.includes(sheet.columns[column]));
}

export function editSessionWorkbook(records: WorkspaceRecord[], sheet: SessionSheet, row: number, column: number, value: string): { id: string; workbook: FinancialWorkbook } | null {
  if (!canEditSessionCell(sheet, row, column)) return null;
  const source = sheet.sources[row - 1];
  const record = records.find((entry) => entry.id === source.recordId);
  if (!record?.workbook) return null;
  const field = sheet.columns[column];
  return { id: record.id, workbook: { ...record.workbook, sheets: record.workbook.sheets.map((entry) => entry.id !== source.sheetId ? entry : {
    ...entry, rows: entry.rows.map((cells, index) => index !== source.row ? cells : cells.map((cell, cellIndex) => entry.columns[cellIndex] === field ? value : cell)),
  }) } };
}
