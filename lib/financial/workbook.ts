import { recoverExplicitProductRows, RECOVERED_ITEM_NOTE } from "@/lib/financial/product-rows";
import type { Classification } from "@/lib/classification/document";
import type { ExtractionResult } from "@/types/extraction/result";
import type { OrganizedFinancialData } from "@/lib/financial/organization";
import { reconcileFinancialCurrencies } from "@/lib/financial/currency";

export type CsvSheet = { id: string; name: string; columns: string[]; rows: string[][] };
export type FinancialWorkbook = {
  schemaVersion: 1 | 2; sheets: CsvSheet[]; warnings: string[];
  organization?: { method: "llm"; model: string; inputBytes: number; chunks: number; inputTokens?: number; outputTokens?: number };
};

export const RECEIPT_COLUMNS = [
  "document_date", "merchant_name", "document_type", "document_number", "currency", "subtotal", "discount",
  "tax", "shipping", "total", "amount_paid", "balance_due", "payment_method", "customer_name",
  "merchant_tax_id", "order_id", "shipping_method", "document_id", "source_file", "review_status", "notes",
] as const;

export const PRODUCT_COLUMNS = [
  "document_date", "merchant_name", "product_name", "product_code", "category", "quantity", "unit",
  "unit_price", "discount", "discount_rate", "tax", "tax_rate", "line_total", "currency", "payment_method",
  "document_type", "document_number", "document_id", "line_number", "source_file", "source_page", "review_status", "notes",
] as const;

// CSV placement uses validated LLM mappings. OCR source sheets remain available for review.
export function organizeFinancialDocument(
  document: ExtractionResult,
  classification: Classification,
  context: { documentId?: string; organization?: OrganizedFinancialData } = {},
): FinancialWorkbook | null {
  if (!classification.isFinancialDocument) return null;
  const organization = context.organization;
  if (!organization) throw new Error("LLM financial organization is required before creating tracking sheets.");
  const currencies = reconcileFinancialCurrencies(organization.receipt, organization.items, document.pages.map((page) => page.text).join("\n"));
  const receipt = currencies.receipt;
  const common = {
    document_id: context.documentId || "", document_type: classification.documentType,
    source_file: document.sourceFileName || "", review_status: "Needs review",
  };
  const row = (columns: readonly string[], values: Record<string, string>) => columns.map((column) => values[column] || "");
  const sheets: CsvSheet[] = [
    {
      id: "items", name: "Products", columns: [...PRODUCT_COLUMNS],
      rows: currencies.items.map((item, index) => row(PRODUCT_COLUMNS, {
        ...Object.fromEntries(["document_date", "merchant_name", "document_number", "currency", "payment_method"].map((key) => [key, receipt[key] || ""])),
        ...item, ...common, line_number: String(index + 1), notes: item.notes || "Mapped by LLM; verify against the source.",
      })),
    },
    {
      id: "receipts", name: "Receipts", columns: [...RECEIPT_COLUMNS],
      rows: [row(RECEIPT_COLUMNS, { ...receipt, ...common, notes: "Mapped by LLM; verify against the source." })],
    },
    {
      id: "fields", name: "Source fields", columns: ["Document type", "Page", "Field", "Value", "Review status"],
      rows: document.structured.fields.map((field) => [classification.documentType, String(field.page), field.label, field.value, "Needs review"]),
    },
    ...document.structured.tables.map((table, index) => ({
      id: `table-${index + 1}`, name: `Table ${index + 1} · Page ${table.page}`,
      columns: ["Page", ...table.columns, "Review status"],
      rows: table.rows.map((cells) => [String(table.page), ...cells, "Needs review"]),
    })),
    {
      id: "source", name: "Source lines", columns: ["Page", "Line", "Original extracted text"],
      rows: document.pages.flatMap((page) => page.text.split(/\r?\n/).map((line, index) => [String(page.page), String(index + 1), line])),
    },
  ];
  return {
    schemaVersion: 2, sheets,
    warnings: [...new Set([
      ...document.structured.warnings, ...organization.warnings, ...currencies.warnings,
      "Financial columns were organized by the LLM and checked against cited OCR records. Verify the field meanings, amounts, and completeness before use.",
      "Missing or unsupported values stay blank. Original numeric formats and ambiguous dates have not been converted.",
    ])],
    organization: {
      method: "llm", model: organization.model, inputBytes: organization.inputBytes, chunks: organization.chunks,
      inputTokens: organization.inputTokens, outputTokens: organization.outputTokens,
    },
  };
}

export function sheetToCsv(sheet: CsvSheet): string {
  const quote = (value: string) => {
    // Quote CSV syntax and neutralize formula execution in spreadsheet imports.
    const safe = /^\s*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return "\ufeff" + [sheet.columns, ...sheet.rows].map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";
}


/** Read-only repair of empty legacy item sheets; originals and existing items stay intact. */
export function recoverMissingWorkbookItems(workbook: FinancialWorkbook | null, document: ExtractionResult | null): FinancialWorkbook | null {
  if (!workbook || !document || !Array.isArray(document.pages)) return workbook;
  const originalItems = workbook.sheets.find((sheet) => sheet.id === "items");
  if (originalItems?.rows.length) return workbook;
  const receipt = workbook.sheets.find((sheet) => sheet.id === "receipts");
  if (!receipt?.rows[0]) return workbook;
  const values = Object.fromEntries(receipt.columns.map((column, index) => [column, receipt.rows[0][index] || ""]));
  if (values.document_type === "bank_statement") return workbook;
  const recovered = recoverExplicitProductRows(document);
  if (!recovered.length) return workbook;
  const currencies = reconcileFinancialCurrencies(values, recovered, document.pages.map((page) => page.text).join("\n"));
  const columns = originalItems?.columns.length ? originalItems.columns : [...PRODUCT_COLUMNS];
  const items: CsvSheet = { id: "items", name: originalItems?.name || "Products", columns,
    rows: currencies.items.map((item, index) => {
      const row = { ...values, ...item, line_number: String(index + 1), review_status: "Needs review", notes: RECOVERED_ITEM_NOTE };
      return columns.map((column) => row[column as keyof typeof row] || "");
    }) };
  return { ...workbook,
    sheets: originalItems ? workbook.sheets.map((sheet) => sheet === originalItems ? items : sheet) : [items, ...workbook.sheets],
    warnings: [...new Set([...workbook.warnings.filter((warning) => !/^No verified product rows were mapped\./.test(warning)),
      `Recovered ${recovered.length} product rows from the saved OCR item table. Original stored results were not rewritten; verify against the source.`, ...currencies.warnings])],
  };
}
