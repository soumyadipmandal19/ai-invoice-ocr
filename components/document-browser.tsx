"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWorkspaceScroll, useWorkspaceState } from "@/components/workspace-provider";
import type { DocumentFilesPage } from "@/types/documents";

function FolderIcon({ className = "size-4" }: { className?: string }) {
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" /></svg>;
}

export default function DocumentBrowser() {
  const [query, setQuery] = useWorkspaceState("library.query", "");
  const [grid, setGrid] = useWorkspaceState("library.grid", true);
  const [page, setPage] = useWorkspaceState("library.page", () => ({ offset: 0, version: 0 }));
  const [data, setData] = useWorkspaceState<DocumentFilesPage>("library.data", () => ({ files: [], folders: [], nextOffset: null }));
  const [cache, setCache] = useWorkspaceState("library.cache", () => ({ query: "", offset: -1, version: -1, time: 0 }));
  const [loading, setLoading] = useState(!cache.time);
  const viewport = useRef<HTMLElement>(null);
  useWorkspaceScroll(viewport, "library", data.files.length);
  const [error, setError] = useState("");
  useEffect(() => {
    if (cache.query === query && cache.offset === page.offset && cache.version === page.version && Date.now() - cache.time < 300_000) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch(`/api/documents?${new URLSearchParams({ offset: String(page.offset), q: query })}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json().catch(() => { throw new Error("The server could not load the document library. Please retry."); });
        if (!response.ok) throw new Error(result.error || "Unable to load documents.");
        if (!controller.signal.aborted) {
          setData((current) => ({ ...result, files: page.offset === 0 ? result.files
            : [...new Map([...current.files, ...result.files].map((file) => [file.billId, file])).values()] }));
          setCache({ query, ...page, time: Date.now() });
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load documents.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, query ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, page, cache, setData, setCache]);
  function showAllBills() { setLoading(true); setQuery(""); setData((current) => ({ ...current, files: [] })); setPage((current) => ({ offset: 0, version: current.version + 1 })); }
  const count = data.folders.reduce((sum, entry) => sum + entry.count, 0);
  return <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
    <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-line bg-panel px-5 py-4"><Link href="/workspace/dashboard" className="text-sm text-muted hover:text-accent">← Dashboard</Link><span className="h-4 w-px bg-line" /><h1 className="text-sm font-semibold">Bills library</h1><span className="ml-auto text-xs text-subtle">{count} saved</span></header>
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
      <aside aria-label="Bill library" className="shrink-0 border-b border-line bg-panel/60 p-3 sm:w-52 sm:border-r sm:border-b-0"><p className="px-3 py-2 text-[10px] font-semibold tracking-widest text-subtle uppercase">Library</p><nav><button type="button" onClick={showAllBills} aria-current="page" className="flex w-full items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent"><FolderIcon />All bills<span className="ml-auto pl-2 text-xs opacity-60">{count}</span></button></nav></aside>
      <section ref={viewport} aria-label="Saved files" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3"><span className="flex items-center gap-2 text-sm text-body"><FolderIcon className="size-4 text-accent" />All bills</span><label className="ml-auto"><span className="sr-only">Search filenames or bill numbers</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setData((current) => ({ ...current, files: [] })); setPage({ offset: 0, version: 0 }); }} placeholder="Search bills…" className="h-8 w-44 rounded-lg border border-line bg-panel px-3 text-sm text-body sm:w-60" /></label><div className="flex rounded-lg border border-line p-0.5">{[true, false].map((value) => <button key={String(value)} type="button" aria-pressed={grid === value} aria-label={value ? "Grid view" : "List view"} onClick={() => setGrid(value)} className={`rounded px-2 py-1 text-xs ${grid === value ? "bg-raised text-foreground" : "text-subtle"}`}>{value ? "Grid" : "List"}</button>)}</div></div>
        {error && <p role="alert" className="m-5 text-sm text-red-300">{error} <button className="underline" onClick={() => setPage((current) => ({ ...current, version: current.version + 1 }))}>Retry</button></p>}
        {!data.files.length && !loading && !error && <div className="flex flex-col items-center gap-3 p-16 text-center"><FolderIcon className="size-12 text-subtle" /><p className="text-sm text-muted">{query ? "No matching bills." : "No saved bills yet."}</p><Link href="/workspace/dashboard" className="text-sm text-accent">Upload a bill →</Link></div>}
        <div aria-busy={loading} className={grid ? "grid grid-cols-2 items-start gap-3 p-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5" : "divide-y divide-line px-4"}>
          {data.files.map((file) => <Link key={file.billId} href={`/workspace/documents/${file.billId}`} title={file.fileName} className={`group min-w-0 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${grid ? "flex flex-col gap-3 border border-line bg-panel p-3 hover:border-accent/40 hover:bg-surface" : "flex items-center gap-3 px-2 py-3 hover:bg-surface"}`}>
            <div className={grid ? "relative flex h-28 w-full shrink-0 items-center justify-center rounded-lg border border-line bg-background/70 transition-colors group-hover:border-accent/25" : "flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-panel"}><svg aria-hidden="true" className={grid ? "size-10 text-accent/70" : "size-5 text-accent/70"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8M8 16h5" /></svg>{grid && <span className="absolute bottom-2 left-2 max-w-[calc(100%_-_1rem)] truncate rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-muted">{/\.([a-z0-9]{1,8})$/i.exec(file.fileName)?.[1].toUpperCase() || "DOC"}</span>}</div>
            <div className={grid ? "w-full min-w-0" : "min-w-0 flex-1"}>
              <p className={grid ? "line-clamp-2 h-10 text-xs leading-5 font-medium break-all text-body group-hover:text-foreground" : "truncate text-sm font-medium text-body group-hover:text-foreground"}>{file.fileName}</p>
              <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] leading-4 text-muted">
                <span className="shrink-0">{file.pageCount ? `${file.pageCount} page${file.pageCount === 1 ? "" : "s"}` : "Bill"}</span>
                {file.billNumber && <><span aria-hidden="true" className="text-subtle">·</span><span title={`Bill number: ${file.billNumber}`} className="min-w-0 truncate font-mono text-[10px]">#{file.billNumber}</span></>}
              </div>
            </div>
            {!grid && <span className="ml-auto hidden shrink-0 text-xs text-subtle sm:block">{file.createdAt.slice(0, 10)}</span>}
          </Link>)}
        </div>
        {loading && <p role="status" className="px-5 py-6 text-sm text-muted">Loading bills…</p>}
        {!loading && data.nextOffset !== null && <button type="button" onClick={() => setPage({ offset: data.nextOffset!, version: 0 })} className="result-button mx-5 mb-5">Load more files</button>}
      </section>
    </div>
  </main>;
}
