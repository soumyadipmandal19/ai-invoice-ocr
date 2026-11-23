import { PRODUCT_COLUMNS, RECEIPT_COLUMNS, type CsvSheet, type FinancialWorkbook } from "@/lib/financial-workbook";
import type { WorkspaceRecord } from "@/types/workspace/record";

export const RECORD_STATUS = {
  extracting: "Extracting", checking: "Organizing", ready: "Ready for review",
  unsupported: "Not organized", failed: "Processing failed",
};

const COLUMN_LABELS: Record<string, string> = {
  document_date: "Bill Date", merchant_name: "Vendor", document_type: "Document Type",
  document_number: "Bill Number", order_id: "Order ID", shipping_method: "Shipping Method", currency: "Currency", subtotal: "Subtotal",
  discount: "Discount Amount", tax: "Tax Amount", shipping: "Shipping Amount", total: "Total Amount",
  amount_paid: "Amount Paid", balance_due: "Balance Due", payment_method: "Payment Method",
  customer_name: "Customer", merchant_tax_id: "Vendor Tax ID", document_id: "Bill ID",
  source_file: "Source File", review_status: "Review Status", notes: "Notes",
  product_name: "Product / Service", product_code: "Product Code", category: "Category",
  quantity: "Quantity", unit: "Unit", unit_price: "Unit Price", discount_rate: "Discount Rate (%)",
  tax_rate: "Tax Rate (%)", line_total: "Line Total", line_number: "Item Number", source_page: "Source Page",
};
export const sessionColumnLabel = (key: string) => COLUMN_LABELS[key] || key;

type Source = { recordId: string; sheetId?: string; row?: number };
export type SessionSheet = CsvSheet & { sources: Source[]; prefix: number; editableColumns: boolean[] };

/** Append in upload order even when later jobs complete before earlier jobs. */
export function buildSessionSheets(records: WorkspaceRecord[]): SessionSheet[] {
  const documents: SessionSheet = {
    id: "documents", name: "Documents", prefix: 0, editableColumns: [],
    columns: ["Index", "File", "Status", "Document type", "Pages", "Bill number", "Vendor", "Currency", "Total", "Added at", "Notes", "Storage"],
    rows: [], sources: [],
  };
  const bills: SessionSheet = { id: "receipts", name: "Bills", prefix: 3, columns: ["Index", "Upload #", "File", ...RECEIPT_COLUMNS], rows: [], sources: [], editableColumns: RECEIPT_COLUMNS.map((key) => !["document_id", "source_file"].includes(key)) };
  const items: SessionSheet = { id: "items", name: "Bill Items", prefix: 3, columns: ["Index", "Upload #", "File", ...PRODUCT_COLUMNS], rows: [], sources: [], editableColumns: PRODUCT_COLUMNS.map((key) => !["document_id", "source_file", "line_number", "source_page"].includes(key)) };
  const fields: SessionSheet = { id: "fields", name: "OCR Fields", prefix: 0, columns: ["Index", "Upload #", "File", "Page", "Field", "Value"], rows: [], sources: [], editableColumns: [] };
  const text: SessionSheet = { id: "text", name: "OCR Text", prefix: 0, columns: ["Index", "Upload #", "File", "Page", "Line", "Text"], rows: [], sources: [], editableColumns: [] };
  for (const record of records) {
    const receipt = record.workbook?.sheets.find((sheet) => sheet.id === "receipts");
    const get = (key: string) => receipt?.rows[0]?.[receipt.columns.indexOf(key)] || "";
    documents.rows.push([
      String(record.index), record.fileName, RECORD_STATUS[record.status], record.job?.result?.documentType || "",
      record.result ? String(record.result.pageCount) : "", get("document_number"), get("merchant_name"),
      get("currency"), get("total"), record.addedAt, record.error,
      record.job?.persistence?.status === "saved" ? "Saved" : record.job?.persistence?.status === "failed" ? "Save failed" : record.status === "extracting" || record.status === "checking" ? "Pending" : "Not saved",
    ]);
    documents.sources.push({ recordId: record.id });
    for (const target of [bills, items]) {
      const source = record.workbook?.sheets.find((sheet) => sheet.id === target.id);
      if (!source) continue;
      for (let row = 0; row < source.rows.length; row++) {
        target.rows.push([
          String(target.rows.length + 1), String(record.index), record.fileName,
          ...target.columns.slice(target.prefix).map((key) => source.rows[row][source.columns.indexOf(key)] || ""),
        ]);
        target.sources.push({ recordId: record.id, sheetId: source.id, row });
      }
    }
    for (const field of record.result?.structured.fields || []) {
      fields.rows.push([String(fields.rows.length + 1), String(record.index), record.fileName, String(field.page), field.label, field.value]);
      fields.sources.push({ recordId: record.id });
    }
    for (const page of record.result?.pages || []) {
      page.text.split(/\r?\n/).forEach((line, index) => {
        if (!line.trim()) return;
        text.rows.push([String(text.rows.length + 1), String(record.index), record.fileName, String(page.page), String(index + 1), line]);
        text.sources.push({ recordId: record.id });
      });
    }
  }
  return [documents, bills, items, fields, text];
}

export function canEditSessionCell(sheet: SessionSheet, row: number, column: number) {
  return row > 0 && !!sheet.sources[row - 1]?.sheetId && !!sheet.editableColumns[column - sheet.prefix];
}

export function editSessionWorkbook(records: WorkspaceRecord[], sheet: SessionSheet, row: number, column: number, value: string): { id: string; workbook: FinancialWorkbook } | null {
  if (!canEditSessionCell(sheet, row, column)) return null;
  const source = sheet.sources[row - 1];
  const record = records.find((entry) => entry.id === source.recordId);
  if (!record?.workbook) return null;
  const field = sheet.columns[column];
  return {
    id: record.id,
    workbook: { ...record.workbook, sheets: record.workbook.sheets.map((entry) => entry.id !== source.sheetId ? entry : {
      ...entry, rows: entry.rows.map((cells, index) => index !== source.row ? cells : cells.map((cell, cellIndex) => entry.columns[cellIndex] === field ? value : cell)),
    }) },
  };
}
