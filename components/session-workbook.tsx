"use client";

import { useId, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { useWorkspaceState } from "@/components/workspace-provider";
import ColumnPicker from "@/components/column-picker";
import WorkbookTabs from "@/components/workbook-tabs";
import { SheetGrid } from "@/components/sheet-grid";
import { BILL_ESSENTIAL_COLUMNS, ITEM_ESSENTIAL_COLUMNS, EMPTY_BILL_FILTERS, billReview, receiptValues, filterWorkspaceRecords, selectSessionColumns, buildSessionSheets, canEditSessionCell, editSessionWorkbook, sessionColumnLabel, type BillFilters } from "@/lib/bills/session-workbook";
import { currencyCode } from "@/lib/financial/currency";
import { buildExcelWorkbook } from "@/lib/bills/excel";
import { recoverMissingWorkbookItems, sheetToCsv, type FinancialWorkbook } from "@/lib/financial/workbook";
import type { WorkspaceRecord } from "@/types/workspace/record";
import DeleteBillDialog from "@/components/delete-bill-dialog";

export type SessionWorkbookHandle = { openReview: () => void };
const control = "h-8 max-w-full rounded-md border border-line bg-background px-2 text-sm text-muted";

export default function SessionWorkbook({ records: storedRecords, onReview, onWorkbookChange, onDeleted, deleteDisabled = false, ref }: {
  ref?: Ref<SessionWorkbookHandle>; records: WorkspaceRecord[];
  onReview: (id: string) => void; onWorkbookChange: (id: string, workbook: FinancialWorkbook) => void;
  onDeleted: (id: string) => void; deleteDisabled?: boolean;
}) {
  const records = useMemo(() => storedRecords.map((record) => {
    const workbook = recoverMissingWorkbookItems(record.workbook, record.result);
    return workbook === record.workbook ? record : { ...record, workbook };
  }), [storedRecords]);
  const [sheetId, setSheetId] = useWorkspaceState("workbook.sheet", "receipts");
  const [filters, setFilters] = useWorkspaceState<BillFilters>("workbook.filters", () => ({ ...EMPTY_BILL_FILTERS }));
  const [columnChoices, setColumnChoices] = useWorkspaceState<Record<string, string[]>>("workbook.columns", () => ({}));
  const [selected, setSelected] = useWorkspaceState("workbook.selection", () => ({ row: 1, column: 0 }));
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceRecord | null>(null);
  const [exportError, setExportError] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useWorkspaceState("workbook.filtersExpanded", false);
  const filtersId = useId();
  useImperativeHandle(ref, () => ({ openReview() {
    setSheetId("receipts"); setFilters({ ...EMPTY_BILL_FILTERS }); setFiltersExpanded(false); setSelected({ row: 1, column: 0 });
  } }), [setSheetId, setFilters, setFiltersExpanded, setSelected]);
  const visible = useMemo(() => filterWorkspaceRecords(records, filters), [records, filters]);
  const sheets = useMemo(() => buildSessionSheets(visible), [visible]);
  const fullSheet = sheets.find((entry) => entry.id === sheetId) || sheets[0];
  const columnGroup = sheetId === "items" ? "items" : "receipts";
  const essentials = columnGroup === "items" ? ITEM_ESSENTIAL_COLUMNS : BILL_ESSENTIAL_COLUMNS;
  const columnKeys = columnChoices[columnGroup] || essentials;
  const sheet = selectSessionColumns(fullSheet, fullSheet.columns.filter((key) => columnKeys.includes(key)));
  const selectedRecord = records.find((record) => record.id === sheet.sources[selected.row - 1]?.recordId);
  const selectedReview = selectedRecord ? billReview(selectedRecord) : null;
  const vendors = [...new Set(records.map((record) => receiptValues(record).merchant_name).filter(Boolean))].sort();
  const currencies = [...new Set(records.map((record) => { const value = receiptValues(record).currency; return currencyCode(value) || value || "unknown"; }))].sort();
  const activeFilters = Object.values(filters).some(Boolean);
  const itemlessBills = visible.filter((record) => record.workbook && receiptValues(record).document_type !== "bank_statement"
    && !record.workbook.sheets.find((entry) => entry.id === "items")?.rows.length).length;

  function updateFilter(key: keyof BillFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value })); setSelected({ row: 1, column: 0 });
  }
  function toggleColumn(key: string) {
    setColumnChoices((current) => {
      const keys = current[columnGroup] || essentials;
      const next = keys.includes(key) ? keys.filter((column) => column !== key) : [...keys, key];
      return next.length ? { ...current, [columnGroup]: next } : current;
    });
  }
  function deleteAction(row: number) {
    const record = records.find((entry) => entry.id === sheet.sources[row - 1]?.recordId);
    const saved = record?.job?.persistence?.status === "saved";
    return <button type="button" disabled={!saved || deleteDisabled} title={saved ? "Delete bill and all its related data" : "Available after the bill is saved"} aria-label={`Delete bill ${record?.index ?? ""}: ${record?.fileName ?? ""}`} onClick={() => record && setDeleteTarget(record)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40"><svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>Delete</button>;
  }
  function saveDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadExcel() {
    try {
      setExportError("");
      const exportRecords = sheetId === "needs-review" ? visible.filter((record) => billReview(record).needsReview) : visible;
      const financialSheets = buildSessionSheets(exportRecords).slice(0, 2).map((entry) => ({ ...entry, columns: entry.columns.map(sessionColumnLabel) }));
      saveDownload(new Blob([buildExcelWorkbook(financialSheets)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "bills-workbook.xlsx");
    } catch { setExportError("Could not export this workbook. Reduce the selection and try again."); }
  }
  function markReviewed() {
    if (!selectedRecord) return;
    const bill = buildSessionSheets([selectedRecord])[0];
    const update = editSessionWorkbook(records, bill, 1, bill.columns.indexOf("review_status"), "Reviewed");
    if (update) onWorkbookChange(update.id, update.workbook);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <div className="mr-auto"><span className="text-sm font-medium text-body">{sheet.name}</span><span className="ml-2 text-xs text-subtle">{sheet.rows.length} {sheetId === "items" ? "items" : "bills"}{activeFilters ? " matching filters" : ""}</span></div>
        {selectedRecord && (selectedRecord.result || selectedRecord.workbook) && <button type="button" onClick={() => onReview(selectedRecord.id)} className="h-8 rounded-md px-2.5 text-sm text-muted hover:bg-surface hover:text-foreground">Open bill &amp; source</button>}
        {selectedRecord?.workbook && selectedReview?.status !== "Reviewed" && <button type="button" onClick={markReviewed} disabled={selectedReview?.reasons.some((reason) => reason !== "Not yet marked as reviewed.")} title="Resolve missing values and source warnings before marking the bill reviewed" className="h-8 rounded-md border border-line px-2.5 text-sm text-body hover:bg-surface disabled:opacity-40">Mark reviewed</button>}
        <ColumnPicker columns={fullSheet.columns} selected={columnKeys} onToggle={toggleColumn} onEssential={() => setColumnChoices((current) => ({ ...current, [columnGroup]: essentials }))} onShowAll={() => setColumnChoices((current) => ({ ...current, [columnGroup]: fullSheet.columns }))} />
        <button type="button" disabled={!sheet.rows.length} onClick={() => saveDownload(new Blob([sheetToCsv({ ...sheet, columns: sheet.columns.map(sessionColumnLabel) })], { type: "text/csv;charset=utf-8" }), `bills-${sheet.id}.csv`)} className="h-8 rounded-md border border-line px-3 text-sm text-body hover:bg-surface disabled:opacity-40">CSV</button>
        <button type="button" onClick={downloadExcel} disabled={!sheet.rows.length} className="h-8 rounded-md border border-accent/30 bg-accent-soft px-3 text-sm font-medium text-accent hover:border-accent disabled:opacity-40">Export Excel</button>
      </div>
      <div role="search" aria-label="Filter bills and their items" className="flex shrink-0 flex-wrap items-end gap-2 border-b border-line bg-background/50 px-3 py-2">
        <label className="min-w-40 flex-1"><span className="sr-only">Search bills, vendors, or items</span><input type="search" value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} placeholder="Search bills, vendors, items…" className={`${control} w-full placeholder:text-subtle`} /></label>
        <button type="button" aria-expanded={filtersExpanded} aria-controls={filtersId} onClick={() => setFiltersExpanded((current) => !current)} className={`h-8 rounded-md border px-3 text-sm ${filtersExpanded || activeFilters ? "border-accent/30 bg-accent-soft text-accent" : "border-line text-body hover:bg-surface"}`}>Filters{Object.entries(filters).filter(([key, value]) => key !== "query" && value).length > 0 ? ` (${Object.entries(filters).filter(([key, value]) => key !== "query" && value).length})` : ""}</button>
        {activeFilters && <button type="button" onClick={() => { setFilters({ ...EMPTY_BILL_FILTERS }); setSelected({ row: 1, column: 0 }); }} className="h-8 px-2 text-sm text-accent hover:underline">Clear filters</button>}
      </div>
      <div id={filtersId} hidden={!filtersExpanded} className={filtersExpanded ? "flex max-h-44 shrink-0 flex-wrap items-end gap-2 overflow-y-auto border-b border-line bg-background/50 px-3 py-2" : "hidden"}>
        <label><span className="sr-only">Vendor</span><select aria-label="Filter by vendor" value={filters.vendor} onChange={(event) => updateFilter("vendor", event.target.value)} className={`${control} max-w-44`}><option value="">All vendors</option>{vendors.map((vendor) => <option key={vendor}>{vendor}</option>)}</select></label>
        <label><span className="sr-only">Currency</span><select aria-label="Filter by currency" value={filters.currency} onChange={(event) => updateFilter("currency", event.target.value)} className={control}><option value="">All currencies</option>{currencies.map((currency) => <option key={currency} value={currency}>{currency === "unknown" ? "Currency missing" : currencyCode(currency) ? currency : `${currency} (unconfirmed)`}</option>)}</select></label>
        <label><span className="sr-only">Review status</span><select aria-label="Filter by review status" value={filters.status} onChange={(event) => updateFilter("status", event.target.value)} className={control}><option value="">All statuses</option><option value="needs-review">Needs review</option><option value="reviewed">Reviewed</option><option value="processing">Processing</option><option value="failed">Failed</option></select></label>
        <label className="flex items-center gap-1.5 text-xs text-subtle">From<input aria-label="Bill date from" type="date" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={(event) => updateFilter("dateFrom", event.target.value)} className={`${control} w-36`} /></label>
        <label className="flex items-center gap-1.5 text-xs text-subtle">To<input aria-label="Bill date to" type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(event) => updateFilter("dateTo", event.target.value)} className={`${control} w-36`} /></label>

      </div>
      {sheetId === "items" && itemlessBills > 0 && <p role="status" className="border-b border-line px-3 py-2 text-xs text-amber-200">{itemlessBills} bill{itemlessBills === 1 ? " has" : "s have"} no organized item rows. Open the bill and source to review missing products.</p>}
      {exportError && <p role="alert" className="px-3 py-2 text-sm text-red-200">{exportError}</p>}
      <SheetGrid stateKey={`combined:${sheet.id}:${JSON.stringify(filters)}`} key={`${sheet.id}-${JSON.stringify(filters)}`} columnKeys={sheet.columns} rows={[sheet.columns.map(sessionColumnLabel), ...sheet.rows]} bottomBar={<WorkbookTabs sheets={sheets.map((entry) => ({ id: entry.id, name: entry.name, count: entry.rows.length }))} activeId={sheet.id} onChange={(id) => { setSheetId(id); setSelected({ row: 1, column: 0 }); }} />} widths={sheet.columns.map((column) => ["notes", "review_notes", "File", "product_name"].includes(column) ? 260 : column === "merchant_name" ? 200 : ["currency", "quantity", "pages", "Index"].includes(column) ? 100 : 150)} selected={selected} onSelect={setSelected} editable={(row, column) => canEditSessionCell(sheet, row, column)} cellWarning={(row, column) => row > 0 ? sheet.sources[row - 1]?.issues?.[sheet.columns[column]] : undefined} rowActions={sheet.id !== "items" ? deleteAction : undefined} emptyMessage={activeFilters ? "No bills match these filters. Try clearing or changing them." : sheetId === "needs-review" ? "No bills need review." : undefined} onEdit={(row, column, value) => { const update = editSessionWorkbook(records, sheet, row, column, value); if (update) onWorkbookChange(update.id, update.workbook); }} />
      {deleteTarget && <DeleteBillDialog key={deleteTarget.id} record={deleteTarget} onCancel={() => setDeleteTarget(null)} onDeleted={(id) => { setDeleteTarget(null); setSelected({ row: 1, column: 0 }); onDeleted(id); }} />}
      <details className="max-h-[25dvh] shrink-0 overflow-auto border-t border-line px-3 py-2 text-xs leading-5 text-muted"><summary className="cursor-pointer text-subtle hover:text-muted">{selectedReview?.needsReview ? `Selected bill: ${selectedReview.reasons.length} review checks` : "Workbook help"}</summary>{selectedReview?.needsReview && <ul className="mt-2 list-disc space-y-1 pl-4 text-amber-200">{selectedReview.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}<p className="mt-2">Bills has one row per document; Bill Items has one row per product or service. Needs review shows the same bills with outstanding checks. Double-click a financial cell to edit. Use Columns to reveal additional fields.</p><p>Open bill &amp; source to inspect OCR evidence. Excel includes both financial sheets with all columns and matching Bill IDs, using your current filters and edits. Printed values are preserved as text. Edits remain in this tab; export before leaving.</p></details>
    </div>
  );
}
