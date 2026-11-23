"use client";

import { useCallback, useId, useRef, useState, type KeyboardEvent } from "react";
import type { ExtractionResult } from "@/types/extraction/result";
import ProcessingLoader from "@/components/processing-loader";
import StructuredReview from "@/components/structured-review";
import DocumentClassification from "@/components/document-classification";
import FinancialWorkbookView from "@/components/financial-workbook";
import type { ClassificationJob } from "@/lib/classification";
import type { FinancialWorkbook } from "@/lib/financial-workbook";

const labels = { text: "PDF text", ocr: "OCR", mixed: "Text + OCR", blank: "Blank page" };
type View = "financial" | "structured" | "formatted" | "original" | "json";
const VIEWS = [
  { value: "financial", label: "Financial CSV", icon: "grid", title: "Financial document sheets", description: "Review organized document fields and item tables, then export each sheet as CSV." },
  { value: "structured", label: "Fields & tables", icon: "fields", title: "Review fields & tables", description: "Check detected values and mark them reviewed." },
  { value: "formatted", label: "Readable text", icon: "text", title: "Document text", description: "Extracted text with headings, lists, and spacing." },
  { value: "original", label: "Original text", icon: "original", title: "Original extraction", description: "The original text returned by extraction." },
  { value: "json", label: "JSON", icon: "code", title: "JSON data", description: "Structured data with your latest edits." },
] as const;

function ViewIcon({ name }: { name: typeof VIEWS[number]["icon"] }) {
  const paths = {
    grid: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18",
    fields: "M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1",
    text: "M4 4h16M12 4v16M8 20h8",
    original: "M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6",
    code: "m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16",
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0"><path d={paths[name]} /></svg>;
}

type TextBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "fields"; rows: { label: string; value: string }[] }
  | { type: "list"; items: { marker: string; text: string }[] };

// Formatting only: preserve the original text for copying and exports.
function organizeText(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let group: TextBlock | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      group = undefined;
      continue;
    }
    const field = line.match(/^([A-Za-z][A-Za-z0-9 ()/#&._-]{0,59}):\s+(.+)$/);
    const item = line.match(/^([-*•▪‣]|\d{1,3}[.)])\s+(.+)$/);
    const heading = line.length <= 80 && (
      /^[A-Z][A-Z\d\s&/(),.'-]{2,79}$/.test(line) ||
      /^[A-Za-z][A-Za-z0-9 ()/#&._-]{0,59}:$/.test(line)
    );
    if (field) {
      if (group?.type !== "fields") {
        group = { type: "fields", rows: [] };
        blocks.push(group);
      }
      group.rows.push({ label: field[1], value: field[2] });
    } else if (item) {
      if (group?.type !== "list") {
        group = { type: "list", items: [] };
        blocks.push(group);
      }
      group.items.push({ marker: item[1], text: item[2] });
    } else if (heading) {
      blocks.push({ type: "heading", text: line });
      group = undefined;
    } else {
      if (group?.type !== "paragraph") {
        group = { type: "paragraph", lines: [] };
        blocks.push(group);
      }
      group.lines.push(raw);
    }
  }
  return blocks;
}

function FormattedText({ text }: { text: string }) {
  return (
    <div className="space-y-5 text-sm leading-7 text-body">
      {organizeText(text).map((block, index) => {
        if (block.type === "heading") return (
          <h4 key={index} className="border-b border-line-soft pb-2 pt-1 text-base font-semibold text-foreground">{block.text}</h4>
        );
        if (block.type === "fields") return (
          <dl key={index} className="overflow-hidden rounded-lg border border-line">
            {block.rows.map((row, rowIndex) => (
              <div key={rowIndex} className="grid border-b border-line-soft last:border-b-0 sm:grid-cols-[minmax(100px,1fr)_2fr]">
                <dt className="bg-background px-4 py-2.5 font-medium text-muted">{row.label}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words px-4 py-2.5 text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>
        );
        if (block.type === "list") return (
          <ul key={index} className="space-y-2">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="flex gap-3"><span className="shrink-0 font-medium text-accent">{item.marker}</span><span className="min-w-0 break-words">{item.text}</span></li>
            ))}
          </ul>
        );
        return <p key={index} className="whitespace-pre-wrap break-words">{block.lines.join("\n")}</p>;
      })}
    </div>
  );
}

export default function ExtractionResultView({ result, fileName, onChooseAnother, onClassificationSettled, onClassificationError, workbook, onWorkbookChange, initialJob }: {
  result: ExtractionResult; fileName: string; onChooseAnother?: () => void;
  onClassificationSettled?: (job: ClassificationJob) => void;
  onClassificationError?: () => void;
  workbook?: FinancialWorkbook | null;
  onWorkbookChange?: (workbook: FinancialWorkbook | null) => void;
  initialJob?: ClassificationJob;
}) {
  const id = useId();
  const tabRefs = useRef<Partial<Record<View, HTMLButtonElement>>>({});
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("structured");
  const [structured, setStructured] = useState(result.structured);
  const [selectedPage, setSelectedPage] = useState("all");
  const [query, setQuery] = useState("");
  const [classificationJob, setClassificationJob] = useState<ClassificationJob | null>(initialJob || null);
  const [classificationError, setClassificationError] = useState("");
  const [localWorkbook, setFinancialWorkbook] = useState<FinancialWorkbook | null>(null);
  const financialWorkbook = workbook === undefined ? localWorkbook : workbook;
  const receiveClassification = useCallback((job: ClassificationJob) => {
    setClassificationJob(job);
    setFinancialWorkbook(job.workbook || null);
    if (job.workbook) setView((current) => current === "structured" ? "financial" : current);
    onClassificationSettled?.(job);
  }, [onClassificationSettled]);
  const receiveClassificationError = useCallback((message: string) => {
    setClassificationError(message);
    onClassificationError?.();
  }, [onClassificationError]);
  const views = VIEWS.filter((option) => option.value !== "financial" || financialWorkbook);
  const text = result.pages.map((page) => `--- Page ${page.page} ---\n${page.text}`).join("\n\n");
  const characterCount = result.pages.reduce((sum, page) => sum + page.text.length, 0);
  const wordCount = result.pages.reduce((sum, page) => sum + (page.text.trim().match(/\S+/g)?.length || 0), 0);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visiblePages = result.pages.filter((page) =>
    (selectedPage === "all" || String(page.page) === selectedPage) &&
    (!normalizedQuery || page.text.toLocaleLowerCase().includes(normalizedQuery) ||
      structured.fields.some((field) => field.page === page.page && `${field.label} ${field.value}`.toLocaleLowerCase().includes(normalizedQuery)) ||
      structured.tables.some((table) => table.page === page.page && [...table.columns, ...table.rows.flat()].join(" ").toLocaleLowerCase().includes(normalizedQuery))));
  const reviewedResult = { ...result, structured, classificationResult: classificationJob?.result, financialWorkbook };

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("All extracted text copied to clipboard.");
    } catch {
      setNotice("Clipboard unavailable. Download the text instead.");
    }
  }

  function download(format: "txt" | "json") {
    const content = format === "txt" ? text : JSON.stringify(reviewedResult, null, 2);
    const url = URL.createObjectURL(new Blob([content], {
      type: format === "txt" ? "text/plain;charset=utf-8" : "application/json",
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName.replace(/\.(pdf|png|jpe?g|webp|bmp)$/i, "")}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (exportMenu.current) {
      exportMenu.current.open = false;
      exportMenu.current.querySelector("summary")?.focus();
    }
    setNotice(`Downloaded all pages as ${format.toUpperCase()}.`);
  }

  function chooseView(next: View) {
    setView(next);
    setNotice("");
  }

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>) {
    const current = views.findIndex((option) => option.value === view);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % views.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + views.length) % views.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = views.length - 1;
    else return;
    event.preventDefault();
    const nextView = views[next].value;
    chooseView(nextView);
    tabRefs.current[nextView]?.focus();
    tabRefs.current[nextView]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function renderContent(activeView: View) {
    if (activeView === "financial" && financialWorkbook) return <FinancialWorkbookView workbook={financialWorkbook} onChange={(next) => { setFinancialWorkbook(next); onWorkbookChange?.(next); }} fileName={fileName} />;
    return (<>
        {visiblePages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-panel p-8 text-center">
            <h3 className="font-medium text-foreground">No matching pages</h3>
            <p className="mt-2 text-sm text-muted">Try another search or clear the filters above.</p>
          </div>
        ) : activeView === "structured" ? (
          <>
            <StructuredReview data={structured} onChange={setStructured} pages={visiblePages.map((page) => page.page)} defaultPage={selectedPage === "all" ? (visiblePages[0]?.page || 1) : Number(selectedPage)} />
            <section id={`${id}-structured-source-content`} aria-labelledby={`${id}-source-content-title`} className="space-y-4">
              <div className="pt-2"><h3 id={`${id}-source-content-title`} className="font-semibold text-foreground">Full document content</h3><p className="mt-2 text-xs leading-6 text-muted">Complete extracted text, including content outside detected fields and tables.</p></div>
              {visiblePages.map((page) => <section key={page.page} aria-label={`Full content, page ${page.page}`} className="document-paper rounded-lg border border-line bg-panel p-5 shadow-lg"><h4 className="mb-4 border-b border-line-soft pb-3 text-sm font-semibold text-foreground">Page {page.page} · {labels[page.method]}</h4>{page.text ? <FormattedText text={page.text} /> : <p className="text-sm text-muted">No readable text found on this page.</p>}</section>)}
            </section>
          </>
        ) : activeView === "json" ? (
          <pre aria-label="Extracted JSON" className="overflow-auto rounded-xl border border-line bg-panel p-5 font-mono text-xs leading-6 text-body">{JSON.stringify({ pageCount: result.pageCount, pages: visiblePages, structured: { ...structured, fields: structured.fields.filter((field) => visiblePages.some((page) => page.page === field.page)), tables: structured.tables.filter((table) => visiblePages.some((page) => page.page === table.page)) } }, null, 2)}</pre>
        ) : visiblePages.map((page) => (
          <section key={page.page} aria-label={`Page ${page.page}`} className="document-paper mx-auto w-full max-w-4xl min-w-0 overflow-hidden rounded-lg border border-line bg-panel shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-5 py-3">
              <h4 className="text-sm font-semibold text-foreground">Page {page.page} <span className="ml-2 font-normal text-subtle">of {result.pageCount}</span></h4>
              <span className="rounded-full bg-surface px-2.5 py-1 text-xs text-muted">{labels[page.method]}</span>
            </div>
            <div className="px-6 py-7 sm:px-9 sm:py-8">
              {!page.text ? <p className="text-sm italic text-subtle">No text found on this page.</p> : activeView === "formatted" ? <FormattedText text={page.text} /> : <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-7 text-body">{page.text}</pre>}
            </div>
          </section>
        ))}
    </>);
  }

  const filtered = normalizedQuery !== "" || selectedPage !== "all";
  const classificationBanner = !initialJob && result.classification && <DocumentClassification
    key={"jobId" in result.classification ? result.classification.jobId : "unavailable"}
    reference={result.classification} onSettled={receiveClassification} onError={receiveClassificationError}
  />;
  const classificationIssue = classificationError || classificationJob?.error ||
    (classificationJob?.status === "failed" ? "Document type detection failed." : "") ||
    (result.classification && "error" in result.classification ? result.classification.error : "");
  const checking = !!result.classification && !classificationJob && !classificationIssue;
  const rejected = classificationJob?.status === "complete" && !classificationJob.result?.isFinancialDocument;

  if (checking) return <div>{classificationBanner}<ProcessingLoader stage="organizing" /></div>;

  if (rejected || classificationIssue) {
    const unknown = classificationJob?.result?.documentType === "unknown";
    return <div>
      {classificationBanner}
      <section role="alert" aria-labelledby={`${id}-document-status`} className="flex min-h-[480px] flex-col items-center justify-center px-6 py-12 text-center sm:px-10">
        <span aria-hidden="true" className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-surface text-2xl text-muted">!</span>
        <h2 id={`${id}-document-status`} className="text-xl font-semibold text-foreground">{classificationIssue ? "Document processing could not finish" : unknown ? "We couldn’t identify this document" : "This document isn’t supported"}</h2>
        <p className="mt-3 max-w-lg text-sm leading-7 text-muted">{classificationIssue
            ? "We couldn’t finish checking or organizing your document, so organized results aren’t available. Please try again with a smaller document if this continues."
            : unknown
              ? "Sorry, we couldn’t confirm that this is a bill, receipt, invoice, or another supported financial document. We couldn’t create organized results. Please upload a clearer copy of a supported document."
              : "Sorry, this document doesn’t appear to be a bill, receipt, invoice, or another supported financial document. We can’t create organized results for it. Please upload a supported document."}</p>
        {onChooseAnother
          ? <button type="button" onClick={onChooseAnother} className="mt-6 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-ink hover:bg-accent-hover">Choose another document</button>
          : <a href="#document-upload" className="mt-6 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-ink hover:bg-accent-hover">Choose another document</a>}
      </section>
    </div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {classificationBanner}
      <header className="flex shrink-0 flex-col gap-2 border-b border-line px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent-soft text-accent"><ViewIcon name="original" /></div>
          <div className="min-w-0">
            <h2 title={fileName} className="truncate text-sm font-semibold text-foreground">{fileName}</h2>
            <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              <span>{result.pageCount} {result.pageCount === 1 ? "page" : "pages"}</span>
              <span>{wordCount.toLocaleString()} words</span>
              <span>{structured.fields.length} fields</span>
              <span>{structured.tables.length} tables</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
          <span className="mr-2 hidden items-center gap-1.5 text-xs text-accent xl:inline-flex"><span aria-hidden="true">✓</span> Extracted</span>
          <button type="button" onClick={copy} className="result-button">Copy text</button>
          <details ref={exportMenu} className="group relative" onBlur={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
            <summary className="flex list-none items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-ink hover:bg-accent-hover [&::-webkit-details-marker]:hidden">Download <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" className="size-3.5 transition-transform group-open:rotate-180"><path d="m4 6 4 4 4-4" strokeWidth="1.5" /></svg></summary>
            <div role="group" aria-label="Download options" className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border border-line-strong bg-panel p-1.5 shadow-xl">
              <button type="button" onClick={() => download("txt")} className="block w-full rounded-lg px-3 py-2.5 text-left hover:bg-surface"><span className="block text-sm font-medium text-foreground">Download TXT</span><span className="mt-1 block text-xs text-muted">Original text, all pages</span></button>
              <button type="button" onClick={() => download("json")} className="block w-full rounded-lg px-3 py-2.5 text-left hover:bg-surface"><span className="block text-sm font-medium text-foreground">Download JSON</span><span className="mt-1 block text-xs text-muted">Data with your corrections</span></button>
            </div>
          </details>
        </div>
      </header>

      <div role="tablist" aria-label="Result views" className="flex shrink-0 overflow-x-auto border-b border-line bg-background/60 px-2 sm:px-4">
        {views.map((option) => <button key={option.value} ref={(element) => { if (element) tabRefs.current[option.value] = element; }} id={`${id}-tab-${option.value}`} type="button" role="tab" aria-selected={view === option.value} aria-controls={`${id}-panel-${option.value}`} tabIndex={view === option.value ? 0 : -1} onClick={() => chooseView(option.value)} onKeyDown={navigateTabs}
          className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-xs font-medium outline-offset-[-4px] transition-colors sm:px-4 ${view === option.value ? "border-accent bg-accent-soft text-accent" : "border-transparent text-muted hover:bg-surface hover:text-foreground"}`}><ViewIcon name={option.icon} />{option.label}</button>)}
      </div>

      <div role="search" aria-label="Search extracted data" hidden={view === "financial"} className="shrink-0 space-y-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search document</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search document…" className="w-full min-w-0 rounded-lg border border-line bg-background py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-subtle" />
          </label>
          {result.pageCount > 1 && <label className="shrink-0"><span className="sr-only">Filter by page</span><select value={selectedPage} onChange={(event) => setSelectedPage(event.target.value)} className="w-32 rounded-lg border border-line bg-background px-3 py-2.5 text-sm text-foreground"><option value="all">All pages</option>{result.pages.map((page) => <option key={page.page} value={page.page}>Page {page.page}</option>)}</select></label>}
        </div>
        {filtered && <div className="flex items-center justify-between gap-3 text-xs text-muted"><span role="status">{visiblePages.length} of {result.pageCount} pages</span><button type="button" onClick={() => { setQuery(""); setSelectedPage("all"); }} className="font-medium text-accent hover:underline">Clear filters</button></div>}
      </div>

      {characterCount === 0 && <p className="mx-4 mt-4 rounded-lg border border-line bg-surface p-3 text-sm text-foreground">No readable text found. Try a clearer scan or another file.</p>}
      {views.map((option) => <div key={option.value} id={`${id}-panel-${option.value}`} role="tabpanel" aria-labelledby={`${id}-tab-${option.value}`} hidden={view !== option.value} tabIndex={0} className={view === option.value ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background" : "hidden"}>
        {view === option.value && <>
          {option.value !== "financial" && <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line bg-surface px-4 py-4 sm:px-6">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">{option.value === "formatted" || option.value === "original" ? "Document content" : "Data workspace"}</p><h3 className="mt-1.5 text-lg font-semibold text-foreground">{option.title}</h3><p className="mt-1 text-xs leading-5 text-muted">{option.description}</p></div>
            <span className="mt-1 shrink-0 rounded-md border border-line-strong bg-panel px-2.5 py-1 text-[11px] text-muted">{option.value === "structured" ? "Editable" : "Read only"}</span>
          </div>}
          <div className={option.value === "financial" ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" : "min-h-0 flex-1 space-y-6 overflow-auto p-4 sm:p-7"}>{renderContent(option.value)}</div>
        </>}
      </div>)}
      {notice && <div role="status" className="fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-4 rounded-xl border border-accent/30 bg-panel px-4 py-3 text-sm text-body shadow-xl"><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")} className="text-muted hover:text-foreground">×</button></div>}
    </div>
  );
}
