"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import ProcessingLoader from "@/components/processing-loader";
import SessionWorkbook from "@/components/session-workbook";
import WorkspaceRecordReview from "@/components/workspace-record-review";
import type { WorkspaceRecord } from "@/types/workspace/record";
import type { FinancialWorkbook } from "@/lib/financial-workbook";
import type { SavedBillPage } from "@/types/bills/responses";
import { mergeSavedBills, removeWorkspaceRecord } from "@/lib/bills/history";
import FilePreview from "@/components/file-preview";
import { isExtractionResult, MAX_UPLOAD_BYTES, SUPPORTED_FILE_EXTENSIONS, type ExtractionResult } from "@/types/extraction/result";

export type WorkspaceSnapshot = {
  status: "empty" | "ready" | "processing" | "checking" | "unsupported" | "complete" | "error";
  fileName: string | null;
  result: ExtractionResult | null;
};

export default function PdfUpload({ inputRef, onStateChange }: {
  inputRef?: RefObject<HTMLInputElement | null>;
  onStateChange?: (state: WorkspaceSnapshot) => void;
}) {
  const preview = useRef<HTMLDialogElement>(null);
  const fallbackInput = useRef<HTMLInputElement>(null);
  const input = inputRef || fallbackInput;
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [records, setRecords] = useState<WorkspaceRecord[]>([]);
  const [historyPage, setHistoryPage] = useState({ offset: 0, version: 0 });
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [nextHistoryOffset, setNextHistoryOffset] = useState<number | null>(null);
  const historyBillIds = useRef(new Set<string>());
  const busy = pending || historyLoading;
  const [activeRecord, setActiveRecord] = useState("workbook");
  const tabsId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeDocument = records.find((record) => record.id === activeRecord);
  const extracting = useRef(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const patchRecord = useCallback((id: string, patch: Partial<WorkspaceRecord>) => {
    setRecords((current) => current.map((record) => record.id === id ? { ...record, ...patch } : record));
  }, []);
  const changeWorkbook = useCallback((id: string, workbook: FinancialWorkbook) => patchRecord(id, { workbook }), [patchRecord]);
  function chooseAnother() {
    input.current?.click();
  }

  function removeRecord(id: string) {
    const billId = records.find((record) => record.id === id)?.job?.persistence?.billId;
    if (billId && historyBillIds.current.delete(billId)) {
      setNextHistoryOffset((offset) => offset === null ? null : Math.max(0, offset - 1));
    }
    setRecords((current) => removeWorkspaceRecord(current, id));
    setActiveRecord("workbook");
    requestAnimationFrame(() => tabRefs.current.get("workbook")?.focus());
  }

  function requestHistoryPage(offset: number) {
    if (historyLoading) return;
    setHistoryLoading(true);
    setHistoryError("");
    setHistoryPage((page) => ({ offset, version: page.version + 1 }));
  }

  useEffect(() => {
    const controller = new AbortController();
    async function loadHistory() {
      try {
        const response = await fetch(`/api/bills?offset=${historyPage.offset}&limit=25`, {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        const data: SavedBillPage & { error?: string } = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load saved documents.");
        if (!Array.isArray(data.bills) || !(data.nextOffset === null || Number.isSafeInteger(data.nextOffset))) throw new Error("Invalid saved document response.");
        if (controller.signal.aborted) return;
        data.bills.forEach((bill) => historyBillIds.current.add(bill.billId));
        setRecords((current) => mergeSavedBills(current, data.bills));
        setNextHistoryOffset(data.nextOffset);
      } catch (error) {
        if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : "Unable to load saved documents.");
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }
    void loadHistory();
    return () => controller.abort();
  }, [historyPage]);

  function navigateDocuments(event: KeyboardEvent<HTMLButtonElement>) {
    const ids = ["workbook", ...records.map((record) => record.id)];
    const current = ids.indexOf(activeRecord);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % ids.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + ids.length) % ids.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    else return;
    event.preventDefault();
    setActiveRecord(ids[next]);
    tabRefs.current.get(ids[next])?.focus();
  }

  useEffect(() => {
    tabRefs.current.get(activeRecord)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeRecord]);

  useEffect(() => {
    const latest = records[records.length - 1];
    if (!latest) return;
    const statuses = { extracting: "processing", checking: "checking", ready: "complete", unsupported: "unsupported", failed: "error" } as const;
    onStateChange?.({ status: statuses[latest.status], fileName: latest.fileName, result: latest.result });
  }, [records, onStateChange]);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  function selectFile(selected: File | undefined) {
    if (busy || !selected) return;
    setError("");
    const extension = selected.name.split(".").pop()?.toLowerCase() || "";
    if (!SUPPORTED_FILE_EXTENSIONS.includes(extension)) {
      setFile(null);
      setPreviewUrl(null);
      setError("Choose a PDF, PNG, JPG, WebP, or BMP file.");
      onStateChange?.({ status: "error", fileName: null, result: null });
    } else if (!selected.size || selected.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setPreviewUrl(null);
      setError(selected.size ? "Choose a file smaller than 10 MB." : "This file is empty.");
      onStateChange?.({ status: "error", fileName: null, result: null });
    } else {
      setFile(selected);
      const mimeTypes: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", bmp: "image/bmp" };
      setPreviewUrl(URL.createObjectURL(new Blob([selected], { type: mimeTypes[extension] })));
      onStateChange?.({ status: "ready", fileName: selected.name, result: null });
    }
  }

  async function extract() {
    if (!file || extracting.current || historyLoading) return;
    extracting.current = true;
    const id = crypto.randomUUID();
    const addedAt = new Date().toISOString();
    setRecords((current) => [...current, { id, index: current.length + 1, fileName: file.name, addedAt, status: "extracting", result: null, workbook: null, job: null, error: "" }]);
    setActiveRecord(id);
    setPending(true);
    setError("");
    onStateChange?.({ status: "processing", fileName: file.name, result: null });
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch("/api/extract", { method: "POST", body: form });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
          ? data.error : "Extraction failed. Please try again.";
        throw new Error(message);
      }
      if (!isExtractionResult(data)) throw new Error("The server returned an unexpected result.");
      patchRecord(id, { result: data, status: data.classification ? "jobId" in data.classification ? "checking" : "failed" : "ready", error: data.classification && "error" in data.classification ? data.classification.error : "" });
      onStateChange?.({ status: data.classification ? "jobId" in data.classification ? "checking" : "error" : "complete", fileName: file.name, result: data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to connect. Please try again.";
      setError(message);
      patchRecord(id, { status: "failed", error: message });
      onStateChange?.({ status: "error", fileName: file.name, result: null });
    } finally {
      extracting.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <section id="document-upload" aria-labelledby="upload-heading" className={`shrink-0 scroll-mt-24 rounded-xl border p-3 transition-colors ${dragging ? "border-accent bg-accent-soft" : "border-line bg-panel"}`}
        onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]); }}>
        <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,application/pdf,image/png,image/jpeg,image/webp,image/bmp" disabled={busy} className="sr-only" aria-label="Choose PDF or image"
          onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ""; }} />
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          <button type="button" disabled={busy} onClick={chooseAnother} aria-label={file ? `Replace ${file.name}` : "Choose a PDF or image"} className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left outline-offset-4 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60">
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-background text-accent transition-colors group-hover:border-accent/40"><svg className="size-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg></span>
            <span className="min-w-0 flex-1">
              <span id="upload-heading" title={file?.name} className="block truncate text-xs font-medium text-foreground">{file ? file.name : dragging ? "Drop your document here" : "Choose a document"}</span>
              <span className="mt-0.5 block text-[11px] text-muted">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ${pending ? "Extracting…" : "Click to replace"}` : "or drag it here · PDF or image · Max 10 MB"}</span>
            </span>
          </button>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
            <a href="/templates/bills-template.xlsx" download title="Download the Excel bill tracker template" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent">
              <svg aria-hidden="true" className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3h16v18H4zM4 9h16M10 9v12M4 15h16" /></svg>Excel template
            </a>
            {file && previewUrl && <button type="button" onClick={() => preview.current?.showModal()} aria-haspopup="dialog" aria-controls={`${tabsId}-preview`} className="inline-flex min-h-9 items-center rounded-lg border border-line-strong px-3 text-xs font-medium text-body hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent">Preview</button>}
            <button type="button" onClick={extract} disabled={!file || busy} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-accent bg-accent px-3.5 text-xs font-semibold text-ink transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-surface disabled:text-subtle">
              {pending ? <span aria-hidden="true" className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <svg aria-hidden="true" className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>}{pending ? "Extracting…" : "Extract text"}
            </button>
          </div>
        </div>
        <div aria-live="polite" className="text-xs">
          {pending && <p className="mt-2 text-muted">Processing your document. Please keep this page open.</p>}
          {error && <p role="alert" className="mt-2 rounded-lg bg-surface p-2 text-foreground">{error}</p>}
        </div>
      </section>
      <dialog ref={preview} id={`${tabsId}-preview`} aria-labelledby={`${tabsId}-preview-title`} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-auto rounded-2xl border border-line-strong bg-panel text-foreground shadow-2xl backdrop:bg-black/75">
        <div className="flex items-center justify-between gap-3 border-b border-line p-3">
          <h2 id={`${tabsId}-preview-title`} className="min-w-0 truncate text-xs font-medium">{file?.name}</h2>
          <button type="button" autoFocus onClick={() => preview.current?.close()} className="result-button">Close preview</button>
        </div>
        {file && previewUrl && <FilePreview key={previewUrl} file={file} url={previewUrl} />}
      </dialog>

      <section id="document-results" aria-label="Extraction results" aria-busy={busy} className="flex min-h-0 min-w-0 flex-1 flex-col scroll-mt-24 overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
          <h2 className="text-xs font-semibold text-foreground">Document workbook <span className="ml-2 font-normal text-muted">{records.length} {records.length === 1 ? "document" : "documents"}</span></h2>
          {historyLoading ? <p role="status" className="text-xs text-muted">Loading saved documents…</p> : historyError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-xs"><p className="text-red-300">{historyError}</p><button type="button" onClick={() => requestHistoryPage(historyPage.offset)} className="result-button">Retry</button></div> : nextHistoryOffset !== null ? <button type="button" onClick={() => requestHistoryPage(nextHistoryOffset)} className="result-button">Load more documents</button> : null}
        </div>
        <div role="tablist" aria-label="Documents" className="flex shrink-0 overflow-x-auto border-b border-line bg-background">
          {[{ id: "workbook", label: "All documents", detail: "Combined workbook" }, ...records.map((record) => ({
            id: record.id, label: `#${record.index} · ${record.fileName}`,
            detail: { extracting: "Extracting…", checking: "Organizing…", ready: "Ready to review", unsupported: "Unsupported document", failed: "Processing failed" }[record.status],
          }))].map((tab) => <button key={tab.id} ref={(element) => { if (element) tabRefs.current.set(tab.id, element); else tabRefs.current.delete(tab.id); }}
            id={`${tabsId}-tab-${tab.id}`} type="button" role="tab" aria-selected={activeRecord === tab.id} aria-controls={`${tabsId}-panel-${tab.id}`} tabIndex={activeRecord === tab.id ? 0 : -1}
            onClick={() => setActiveRecord(tab.id)} onKeyDown={navigateDocuments} title={tab.label}
            className={`min-w-40 max-w-64 shrink-0 border-b-2 px-4 py-2 text-left outline-offset-[-4px] transition-colors ${activeRecord === tab.id ? "border-accent bg-accent-soft text-accent" : "border-transparent text-muted hover:bg-surface hover:text-foreground"}`}>
            <span className="block truncate text-xs font-medium">{tab.label}</span><span className="sr-only">{tab.detail}</span>
          </button>)}
        </div>
        <div id={`${tabsId}-panel-workbook`} role="tabpanel" aria-labelledby={`${tabsId}-tab-workbook`} tabIndex={0} hidden={activeRecord !== "workbook"} className={activeRecord === "workbook" ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "hidden"}>
          <SessionWorkbook records={records} onReview={setActiveRecord} onWorkbookChange={changeWorkbook} onDeleted={removeRecord} deleteDisabled={historyLoading} />
        </div>
        {records.map((record) => <div key={record.id} id={`${tabsId}-panel-${record.id}`} role="tabpanel" aria-labelledby={`${tabsId}-tab-${record.id}`} tabIndex={0} hidden={activeRecord !== record.id} className={activeRecord === record.id ? "flex min-h-0 flex-1 flex-col overflow-auto" : "hidden"}>
          {record.result || record.workbook || record.restored ? <WorkspaceRecordReview record={record} onPatch={patchRecord} onChooseAnother={chooseAnother} /> : record.status === "failed" ? <div className="flex min-h-96 flex-col items-center justify-center px-6 py-12 text-center"><h3 className="text-lg font-semibold text-foreground">Couldn’t extract this document</h3><p className="mt-3 max-w-md break-words text-sm leading-6 text-muted">{record.error}</p><button type="button" onClick={chooseAnother} className="result-button mt-5">Choose another document</button></div> : <ProcessingLoader stage="extracting" />}
        </div>)}
        {activeDocument && <p className="shrink-0 border-t border-line bg-panel px-4 py-1.5 text-xs leading-5 text-muted">Showing only <span className="break-all font-medium text-foreground">#{activeDocument.index} · {activeDocument.fileName}</span>. Select All documents for the combined workbook.</p>}
      </section>
    </div>
  );
}
