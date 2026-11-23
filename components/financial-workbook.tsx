"use client";

import { useId, useState } from "react";
import WorkbookTabs from "@/components/workbook-tabs";
import { SheetGrid } from "@/components/sheet-grid";
import { PRODUCT_COLUMNS, RECEIPT_COLUMNS, sheetToCsv, type FinancialWorkbook } from "@/lib/financial-workbook";

export default function FinancialWorkbookView({ workbook, onChange, fileName }: {
  workbook: FinancialWorkbook; onChange: (workbook: FinancialWorkbook) => void; fileName: string;
}) {
  const accordionGroup = useId();
  const [sheetId, setSheetId] = useState("items");
  const [selected, setSelected] = useState({ row: 1, column: 1 });
  const sheet = workbook.sheets.find((entry) => entry.id === sheetId) || workbook.sheets[0];
  if (!sheet) return <p className="p-4 text-sm text-muted">No sheets available.</p>;
  const trackingSheet = workbook.schemaVersion === 2 && (sheet.id === "items" || sheet.id === "receipts");

  function edit(row: number, column: number, value: string) {
    if (sheet.id === "source" || (trackingSheet && row === 0)) return;
    onChange({ ...workbook, sheets: workbook.sheets.map((entry) => entry.id !== sheet.id ? entry : {
      ...entry,
      columns: row === 0 ? entry.columns.map((label, index) => index === column ? value : label) : entry.columns,
      rows: row === 0 ? entry.rows : entry.rows.map((cells, index) => index === row - 1 ? cells.map((cell, cellIndex) => cellIndex === column ? value : cell) : cells),
    }) });
  }

  function addProduct() {
    const receipt = workbook.sheets.find((entry) => entry.id === "receipts");
    const metadata = Object.fromEntries((receipt?.columns || []).map((column, index) => [column, receipt?.rows[0]?.[index] || ""]));
    const row = PRODUCT_COLUMNS.map((column) => {
      if (column === "line_number") return String(sheet.rows.length + 1);
      if (column === "review_status") return "Needs review";
      return ["document_id", "document_type", "document_number", "document_date", "merchant_name", "currency", "payment_method", "source_file"].includes(column) ? metadata[column] || "" : "";
    });
    onChange({ ...workbook, sheets: workbook.sheets.map((entry) => entry.id === sheet.id ? { ...entry, rows: [...entry.rows, row] } : entry) });
  }

  function downloadTemplate(kind: "items" | "receipts") {
    const columns = kind === "items" ? PRODUCT_COLUMNS : RECEIPT_COLUMNS;
    const url = URL.createObjectURL(new Blob([sheetToCsv({ id: kind, name: kind, columns: [...columns], rows: [] })], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${kind === "items" ? "products" : "receipts"}-template.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([sheetToCsv(sheet)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName.replace(/\.[^.]+$/, "")}-${sheet.id}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-panel">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4 py-2">
        <div><h4 className="text-sm font-semibold text-accent-text">{sheet.name}</h4><p className="sr-only">{trackingSheet ? sheet.id === "items" ? "One row per product, with the same columns for every receipt." : "One row per document. Match products using document_id." : "Original OCR data for checking your tracking sheets."}</p></div>
        <div className="flex flex-wrap gap-2">{trackingSheet && sheet.id === "items" && <button type="button" onClick={addProduct} className="inline-flex h-8 items-center rounded-md border border-line-strong px-3 text-xs text-body hover:bg-surface">Add product row</button>}<button type="button" onClick={download} className="inline-flex h-8 items-center rounded-md border border-line-strong px-3 text-xs text-body hover:bg-surface">Download CSV</button></div>
      </div>
      <SheetGrid key={sheet.id} rows={[sheet.columns, ...sheet.rows]} bottomBar={<WorkbookTabs label="Financial CSV sheets" sheets={workbook.sheets} activeId={sheet.id} onChange={(id) => { setSheetId(id); setSelected({ row: 1, column: 1 }); }} />} widths={sheet.columns.map((column) => ["product_name", "document_id", "source_file", "notes"].includes(column) ? 300 : column === "merchant_name" ? 220 : 150)} editable={(row) => sheet.id !== "source" && !(trackingSheet && row === 0)} onEdit={edit} selected={selected} onSelect={setSelected} />
      <details name={accordionGroup} className="max-h-[20dvh] shrink-0 overflow-auto border-t border-line px-4 py-2 text-xs leading-5 text-muted"><summary className="cursor-pointer">About this sheet</summary><p className="mt-2">{workbook.organization?.method === "llm" && "AI organized these columns from OCR evidence. Verify every row before use. "}Each CSV contains one sheet and includes your edits. Source lines are read-only. Import identifier columns as text to preserve leading zeros.</p></details>
      {trackingSheet && <details name={accordionGroup} className="max-h-[20dvh] shrink-0 overflow-auto border-t border-line px-4 py-2 text-xs leading-6 text-muted"><summary className="cursor-pointer font-medium">Maintain a receipt tracker</summary><p className="mt-2">Use Products for product quantities and prices. Use Receipts for document totals, tax, and payments. Blank cells need review; missing values are not estimated. Keep the fixed column headers when appending rows to your master file. Check source_file and document_number before appending to avoid duplicate receipts. Your master file is maintained separately.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => downloadTemplate("items")} className="result-button">Products template CSV</button><button type="button" onClick={() => downloadTemplate("receipts")} className="result-button">Receipts template CSV</button></div></details>}
      {workbook.warnings.length > 0 && <details name={accordionGroup} className="max-h-[20dvh] shrink-0 overflow-auto border-t border-line px-4 py-2 text-xs leading-5 text-muted"><summary className="cursor-pointer font-medium">Review notes ({workbook.warnings.length})</summary><ul className="mt-2 list-disc space-y-1 pl-4">{workbook.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    </div>
  );
}
