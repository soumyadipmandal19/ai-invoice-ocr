"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type RefObject } from "react";
import Link, { useLinkStatus } from "next/link";
import { useWorkspaceState } from "@/components/workspace-provider";
import { useRouter } from "next/navigation";
import ProcessingLoader from "@/components/processing-loader";
import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import SessionWorkbook from "@/components/session-workbook";
import WorkspaceRecordReview from "@/components/workspace-record-review";
import type { WorkspaceRecord } from "@/types/workspace/record";
import type { FinancialWorkbook } from "@/lib/financial/workbook";
import type { SavedBillPage } from "@/types/bills/responses";
import { mergeSavedBills, mergeDuplicateUpload, removeWorkspaceRecord } from "@/lib/bills/history";
import type { DuplicateUpload } from "@/types/extraction/upload";
import FilePreview from "@/components/file-preview";
import { isExtractionResult, MAX_UPLOAD_BYTES, SUPPORTED_FILE_EXTENSIONS, type ExtractionResult } from "@/types/extraction/result";

export type WorkspaceSnapshot = {
  status: "empty" | "ready" | "processing" | "checking" | "unsupported" | "complete" | "error";
  fileName: string | null;
  result: ExtractionResult | null;
};

function ReviewStatus({ count }: { count: number }) {
  const { pending } = useLinkStatus();
  return <span role="status" className="ml-auto min-w-16 text-right text-xs text-subtle">{pending ? "Opening…" : count ? `${count} ready` : "Documents"}</span>;
}

export default function PdfUpload({ inputRef, onStateChange }: {
  inputRef?: RefObject<HTMLInputElement | null>;
  onStateChange?: (state: WorkspaceSnapshot) => void;
}) {
  const router = useRouter();
  const preview = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(inputRef, () => input.current!, []);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [records, setRecords] = useWorkspaceState<WorkspaceRecord[]>("records", () => []);
  const [historyPage, setHistoryPage] = useWorkspaceState("history.request", () => ({ offset: 0, version: 0 }));
  const [historyCache, setHistoryCache] = useWorkspaceState("history.cache", () => ({ offset: -1, version: -1, time: 0 }));
  const [historyLoading, setHistoryLoading] = useState(!historyCache.time);
  const [historyError, setHistoryError] = useState("");
  const [nextHistoryOffset, setNextHistoryOffset] = useWorkspaceState<number | null>("history.nextOffset", null);
  const [historyBillIds, setHistoryBillIds] = useWorkspaceState<string[]>("history.billIds", () => []);
  const busy = pending || historyLoading;
  const [activeRecord, setActiveRecord] = useWorkspaceState("active-record", "workbook");
  const tabsId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeDocument = records.find((record) => record.id === activeRecord);
  const readyCount = records.filter((record) => record.workbook).length;
  const processingCount = records.filter((record) => record.status === "extracting" || record.status === "checking").length;
  const extracting = useRef(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const patchRecord = useCallback((id: string, patch: Partial<WorkspaceRecord>) => {
    setRecords((current) => current.map((record) => record.id === id ? { ...record, ...patch } : record));
    if (patch.status === "ready" && patch.job?.persistence?.status === "saved") setActiveRecord((current) => current === id ? "workbook" : current);
  }, [setRecords, setActiveRecord]);
  const changeWorkbook = useCallback((id: string, workbook: FinancialWorkbook) => patchRecord(id, { workbook }), [patchRecord]);
  function chooseAnother() {
    input.current?.click();
  }

  function clearUpload() {
    setFile(null);
    setPreviewUrl(null);
    if (input.current) input.current.value = "";
    preview.current?.close();
  }

  function removeRecord(id: string) {
    const billId = records.find((record) => record.id === id)?.job?.persistence?.billId;
    if (billId && historyBillIds.includes(billId)) {
      setHistoryBillIds((current) => current.filter((id) => id !== billId));
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
      // Activity re-runs effects when returning. A fresh, completed page needs no fetch.
      if (historyCache.offset === historyPage.offset && historyCache.version === historyPage.version
        && Date.now() - historyCache.time < 300_000) return;
      try {
        const response = await fetch(`/api/bills?offset=${historyPage.offset}&limit=25`, {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        const data: SavedBillPage & { error?: string } = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load saved documents.");
        if (!Array.isArray(data.bills) || !(data.nextOffset === null || Number.isSafeInteger(data.nextOffset))) throw new Error("Invalid saved document response.");
        if (controller.signal.aborted) return;
        setHistoryBillIds((current) => [...new Set([...current, ...data.bills.map((bill) => bill.billId)])]);
        setRecords((current) => mergeSavedBills(current, data.bills));
        setNextHistoryOffset(data.nextOffset);
        setHistoryCache({ ...historyPage, time: Date.now() });
      } catch (error) {
        if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : "Unable to load saved documents.");
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }
    void loadHistory();
    return () => controller.abort();
  }, [historyPage, historyCache, setHistoryCache, setHistoryBillIds, setRecords, setNextHistoryOffset]);

  function openRecord(id: string) {
    const savedId = records.find((record) => record.id === id)?.job?.persistence?.billId;
    if (savedId) router.push(`/workspace/documents/${encodeURIComponent(savedId)}`);
    else setActiveRecord(id);
  }

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
    setNotice("");
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
    const attempt: WorkspaceRecord = { id, index: records.length + 1, fileName: file.name, addedAt, status: "extracting", result: null, workbook: null, job: null, error: "" };
    setRecords((current) => [...current, { ...attempt, index: current.length + 1 }]);
    setActiveRecord(id);
    setPending(true);
    setError("");
    setNotice("");
    onStateChange?.({ status: "processing", fileName: file.name, result: null });
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch("/api/extract", { method: "POST", body: form });
      const data: unknown = await response.json();
      if (response.status === 409 && typeof data === "object" && data !== null && "duplicate" in data && data.duplicate === true && "jobId" in data && typeof data.jobId === "string") {
        const duplicate = data as DuplicateUpload;
        setRecords((current) => mergeDuplicateUpload(current, id, duplicate).records);
        setActiveRecord(duplicate.bill ? "workbook" : mergeDuplicateUpload([...records, attempt], id, duplicate).activeId);
        setNotice(duplicate.message);
        onStateChange?.({ status: duplicate.bill ? "complete" : "checking", fileName: file.name, result: duplicate.bill?.ocr || duplicate.document || null });
        clearUpload();
        return;
      }
      if (!response.ok) {
        const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
          ? data.error : "Extraction failed. Please try again.";
        throw new Error(message);
      }
      if (!isExtractionResult(data)) throw new Error("The server returned an unexpected result.");
      patchRecord(id, { result: data, status: data.classification ? "jobId" in data.classification ? "checking" : "failed" : "ready", error: data.classification && "error" in data.classification ? data.classification.error : "" });
      onStateChange?.({ status: data.classification ? "jobId" in data.classification ? "checking" : "error" : "complete", fileName: file.name, result: data });
      clearUpload();
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
    historyLoading && records.length === 0 ? <WorkspaceSkeleton /> :
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <section id="document-upload" aria-label="Upload, extract, and review" className="grid shrink-0 gap-3 sm:grid-cols-3 lg:grid-cols-[1.2fr_1fr_1fr]"
        onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]); }}>
        <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,application/pdf,image/png,image/jpeg,image/webp,image/bmp" disabled={busy} className="sr-only" aria-label="Choose PDF or image"
          onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ""; }} />
        <article aria-labelledby="upload-heading" className={`workflow-card min-w-0 ${dragging ? "border-accent bg-accent-soft" : "border-line bg-panel"}`}>
          <div className="flex items-center gap-2.5"><span className="workflow-icon text-accent"><svg aria-hidden="true" className="size-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg></span><h2 id="upload-heading" className="text-sm font-semibold">Upload</h2><span className="ml-auto text-xs text-subtle">Max 10 MB</span></div>
          <div className="mt-3 flex min-w-0 items-center gap-2">
            <button type="button" disabled={busy} onClick={chooseAnother} aria-label={file ? `Replace ${file.name}` : "Choose a PDF or image"} className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg border border-dashed px-3 py-2 text-left transition-colors hover:border-accent/60 hover:bg-accent-soft disabled:cursor-wait disabled:opacity-50 ${dragging ? "border-accent" : "border-line-strong"}`}>
              <span className="min-w-0 flex-1"><span title={file?.name} className="block truncate text-sm font-medium text-body">{file ? file.name : dragging ? "Drop your document here" : "Choose a document"}</span><span className="mt-0.5 block text-xs text-subtle">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · Click to replace` : "or drag a PDF or image here"}</span></span>
              <span aria-hidden="true" className="shrink-0 text-lg text-accent">{file ? "✓" : "+"}</span>
            </button>
            {file && previewUrl && <button type="button" onClick={() => preview.current?.showModal()} aria-haspopup="dialog" aria-controls={`${tabsId}-preview`} className="min-h-9 shrink-0 rounded-lg border border-line-strong px-2.5 text-sm text-body hover:bg-surface">Preview</button>}
          </div>
        </article>
        <article aria-labelledby="extract-heading" className={`workflow-card min-w-0 ${processingCount ? "border-accent/40 bg-panel" : "border-line bg-panel"}`}>
          <div className="flex items-center gap-2.5"><span className={`workflow-icon ${processingCount ? "text-accent" : "text-muted"}`}><svg aria-hidden="true" className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /></svg></span><h2 id="extract-heading" className="text-sm font-semibold">Extract</h2><span role="status" className={`ml-auto text-xs ${processingCount ? "text-accent" : "text-subtle"}`}>{pending ? "Extracting…" : processingCount ? "Organizing…" : file ? "File ready" : "Waiting for a file"}</span></div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-48 text-[13px] leading-5 text-muted">{processingCount ? "Reading and organizing your document." : "Turn your document into editable tables."}</p>
            <button type="button" onClick={extract} disabled={!file || busy} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-accent bg-accent px-3 text-sm font-semibold text-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-surface disabled:text-subtle">
              {pending && <span aria-hidden="true" className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}{pending ? "Extracting…" : "Extract text"}
            </button>
          </div>
        </article>
        <Link href="/workspace/documents" prefetch={true} aria-labelledby="review-heading" className={`workflow-card block min-w-0 transition-colors hover:border-accent/50 focus-visible:outline-2 focus-visible:outline-accent ${readyCount ? "border-accent/25 bg-accent-soft/40" : "border-line bg-panel"}`}>
          <div className="flex items-center gap-2.5"><span className="workflow-icon text-accent"><svg aria-hidden="true" className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 7V5h6l2 3h10v12H3V7Z" /></svg></span><h2 id="review-heading" className="text-sm font-semibold">Review</h2><ReviewStatus count={readyCount} /><span aria-hidden="true" className="text-muted">↗</span></div>
          <p className="mt-3 text-[13px] leading-5 text-muted">Browse your files and open their OCR, bill data, and AI output.</p>
        </Link>
      </section>
      {(notice || error) && <div aria-live="polite" className="shrink-0 text-sm">{notice && <p role="status" className="rounded-lg border border-accent/20 bg-accent-soft px-3 py-2 text-body">{notice}</p>}{error && <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-red-200">{error}</p>}</div>}
      <dialog ref={preview} id={`${tabsId}-preview`} aria-labelledby={`${tabsId}-preview-title`} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-auto rounded-2xl border border-line-strong bg-panel text-foreground shadow-2xl backdrop:bg-black/75">
        <div className="flex items-center justify-between gap-3 border-b border-line p-3">
          <h2 id={`${tabsId}-preview-title`} className="min-w-0 truncate text-xs font-medium">{file?.name}</h2>
          <button type="button" autoFocus onClick={() => preview.current?.close()} className="result-button">Close preview</button>
        </div>
        {file && previewUrl && <FilePreview key={previewUrl} file={file} url={previewUrl} />}
      </dialog>

      <section id="document-results" aria-label="Extraction results" aria-busy={busy} className="flex min-h-[520px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel sm:min-h-[400px] lg:min-h-0">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-3 py-2.5 sm:px-4">
          <h2 className="mr-auto flex items-center gap-2 text-sm font-semibold">Bills workspace <span className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs font-normal tabular-nums text-muted">{records.length}</span></h2>
          {historyLoading ? <p role="status" className="text-xs text-muted">Loading saved documents…</p> : historyError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-xs"><p className="text-red-300">{historyError}</p><button type="button" onClick={() => requestHistoryPage(historyPage.offset)} className="result-button">Retry</button></div> : nextHistoryOffset !== null ? <button type="button" onClick={() => requestHistoryPage(nextHistoryOffset)} className="result-button">Load more documents</button> : null}

        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div role="tablist" aria-label="Documents" aria-orientation="horizontal" className="flex min-w-0 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-background/50 px-3 py-2">
              <button ref={(element) => { if (element) tabRefs.current.set("workbook", element); else tabRefs.current.delete("workbook"); }}
                id={`${tabsId}-tab-workbook`} type="button" role="tab" aria-selected={activeRecord === "workbook"} aria-controls={`${tabsId}-panel-workbook`} tabIndex={0}
                onClick={() => setActiveRecord("workbook")}
                className={`flex min-h-9 shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent ${activeRecord === "workbook" ? "border-accent/25 bg-accent-soft text-accent" : "border-transparent text-muted hover:bg-surface"}`}>
                <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" /></svg>
                <span>All bills</span><span className="text-xs tabular-nums opacity-60">{records.length}</span>
              </button>
              {!records.length && <p className="shrink-0 px-2 text-sm text-subtle">Add your first document above.</p>}
            </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div id={`${tabsId}-panel-workbook`} role="tabpanel" aria-labelledby={`${tabsId}-tab-workbook`} tabIndex={0} hidden={activeRecord !== "workbook"} className={activeRecord === "workbook" ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "hidden"}>
              <SessionWorkbook records={records} onReview={openRecord} onWorkbookChange={changeWorkbook} onDeleted={removeRecord} deleteDisabled={historyLoading} />
            </div>
            {records.filter((record) => record.id === activeRecord || (!record.restored && record.status === "checking")).map((record) => <div key={record.id} id={`${tabsId}-panel-${record.id}`} role="tabpanel" aria-label={record.fileName} tabIndex={0} hidden={activeRecord !== record.id} className={activeRecord === record.id ? "flex min-h-0 flex-1 flex-col overflow-auto" : "hidden"}>
              {record.result || record.workbook || record.restored ? <WorkspaceRecordReview record={record} onPatch={patchRecord} onChooseAnother={chooseAnother} /> : record.status === "failed" ? <div className="flex min-h-96 flex-col items-center justify-center px-6 py-12 text-center"><h3 className="text-lg font-semibold text-foreground">Couldn’t extract this document</h3><p className="mt-3 max-w-md break-words text-sm leading-6 text-muted">{record.error}</p><button type="button" onClick={chooseAnother} className="result-button mt-5">Choose another document</button></div> : <ProcessingLoader stage="extracting" />}
            </div>)}
          </div>
        </div>
        {activeDocument && <p className="shrink-0 border-t border-line bg-panel px-4 py-1.5 text-xs leading-5 text-muted">Showing only <span className="break-all font-medium text-foreground">{activeDocument.fileName}</span>. Select All bills for the combined workbook.</p>}
      </section>
    </div>
  );
}
