"use client";

import { useMemo, useState } from "react";
import WorkbookTabs from "@/components/workbook-tabs";
import { SheetGrid } from "@/components/sheet-grid";
import { buildSessionSheets, canEditSessionCell, editSessionWorkbook, sessionColumnLabel } from "@/lib/bills/session-workbook";
import { sheetToCsv, type FinancialWorkbook } from "@/lib/financial-workbook";
import type { WorkspaceRecord } from "@/types/workspace/record";
import DeleteBillDialog from "@/components/delete-bill-dialog";

export default function SessionWorkbook({ records, onReview, onWorkbookChange, onDeleted, deleteDisabled = false }: {
  records: WorkspaceRecord[];
  onReview: (id: string) => void;
  onWorkbookChange: (id: string, workbook: FinancialWorkbook) => void;
  onDeleted: (id: string) => void;
  deleteDisabled?: boolean;
}) {
  const [sheetId, setSheetId] = useState("documents");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState({ row: 1, column: 0 });
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceRecord | null>(null);
  const visible = useMemo(() => records.filter((record) => filter === "all" || record.id === filter), [records, filter]);
  const sheets = useMemo(() => buildSessionSheets(visible), [visible]);
  const sheet = sheets.find((entry) => entry.id === sheetId) || sheets[0];
  const selectedRecord = records.find((record) => record.id === sheet.sources[selected.row - 1]?.recordId);
  const ready = records.filter((record) => record.workbook).length;
  // New organization results may insert rows before an existing selection.
  // Reset any in-progress grid edit when row identities change.
  const rowIdentity = sheet.sources.map((source) => `${source.recordId}:${source.row ?? ""}`).join("|");

  function deleteAction(row: number) {
    const record = records.find((entry) => entry.id === sheet.sources[row - 1]?.recordId);
    const saved = record?.job?.persistence?.status === "saved";
    return <button type="button" disabled={!saved || deleteDisabled} title={saved ? "Delete bill and all its related data" : "Available after the bill is saved"} aria-label={`Delete bill ${record?.index ?? ""}: ${record?.fileName ?? ""}`} onClick={() => record && setDeleteTarget(record)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-400/10 focus-visible:outline-2 focus-visible:outline-red-300 disabled:cursor-not-allowed disabled:opacity-40"><svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>Delete</button>;
  }

  function download() {
    const url = URL.createObjectURL(new Blob([sheetToCsv({ ...sheet, columns: sheet.columns.map(sessionColumnLabel) })], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `workspace-${sheet.id}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-3 py-2">
        <span className="mr-auto text-xs font-medium text-body">{sheet.name}<span className="ml-2 text-[11px] font-normal text-subtle">{ready} of {records.length} organized</span></span>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {records.length > 1 && <label className="min-w-0"><span className="sr-only">Filter workbook by document</span><select value={filter} onChange={(event) => { setFilter(event.target.value); setSelected({ row: 1, column: 0 }); }} className="h-8 max-w-44 rounded-md border border-line bg-background px-2 text-[11px] text-muted focus-visible:outline-accent"><option value="all">All uploads</option>{records.map((record) => <option key={record.id} value={record.id}>#{record.index} · {record.fileName}</option>)}</select></label>}
          {(selectedRecord?.result || selectedRecord?.workbook) && <button type="button" onClick={() => selectedRecord && onReview(selectedRecord.id)} className="inline-flex h-8 items-center rounded-md px-2.5 text-[11px] font-medium text-muted hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent">Open document ↗</button>}
          <button type="button" onClick={download} disabled={!sheet.rows.length} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-background px-2.5 text-[11px] font-medium text-body hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"><svg aria-hidden="true" className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" /></svg>Export CSV</button>
        </div>
      </div>
      <SheetGrid key={`${sheet.id}-${filter}-${rowIdentity}`} rows={[sheet.columns.map(sessionColumnLabel), ...sheet.rows]} bottomBar={<WorkbookTabs sheets={sheets.map((entry) => ({ id: entry.id, name: entry.name, count: entry.rows.length }))} activeId={sheet.id} onChange={(id) => { setSheetId(id); setSelected({ row: 1, column: 0 }); }} />} widths={sheet.columns.map((column) => ["Text", "Value", "notes", "Notes"].includes(column) ? 320 : ["File", "source_file", "product_name"].includes(column) ? 240 : ["Index", "Upload #", "Pages", "Page", "Line"].includes(column) ? 70 : 150)} selected={selected} onSelect={setSelected} editable={(row, column) => canEditSessionCell(sheet, row, column)} rowActions={sheet.id === "documents" || sheet.id === "receipts" ? deleteAction : undefined} onEdit={(row, column, value) => { const update = editSessionWorkbook(records, sheet, row, column, value); if (update) onWorkbookChange(update.id, update.workbook); }} />
      {deleteTarget && <DeleteBillDialog key={deleteTarget.id} record={deleteTarget} onCancel={() => setDeleteTarget(null)} onDeleted={(id) => { setDeleteTarget(null); setFilter("all"); setSelected({ row: 1, column: 0 }); onDeleted(id); }} />}
      <details className="max-h-[25dvh] shrink-0 overflow-auto border-t border-line px-3 py-2 text-[11px] leading-5 text-muted">
        <summary className="cursor-pointer text-subtle hover:text-muted">{ready} of {records.length} organized · Workbook help</summary>
        <p className="mt-2">{sheet.id === "documents" ? "Select a data row, then choose Open document to review its source." : sheet.id === "receipts" || sheet.id === "items" ? "Double-click a financial cell to edit. Match bills and items by Upload # or Bill ID." : "Original OCR output is read-only. Open its document to inspect fields and tables."}</p>
        <p>Saved results reload for your account. Edits remain in this tab; export corrections before leaving.</p>
      </details>
    </div>
  );
}
