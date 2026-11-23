"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";

export default function PdfPreview({ file, compact = false }: { file: File; compact?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    async function load() {
      try {
        // Import in the browser: PDF.js depends on browser canvas APIs.
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const data = new Uint8Array(await file.arrayBuffer());
        if (cancelled) return;
        task = pdfjs.getDocument({ data, useSystemFonts: true });
        const pdf = await task.promise;
        if (!cancelled) setDocument(pdf);
      } catch (error) {
        if (cancelled) return;
        setBusy(false);
        setError(error instanceof Error && error.name === "PasswordException"
          ? "This PDF is password-protected. Choose an unlocked copy to preview and extract it."
          : "This PDF could not be previewed. Check that the file is valid, or open the full preview.");
      }
    }
    void load();
    return () => { cancelled = true; void task?.destroy().catch(() => {}); };
  }, [file]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const width = Math.round(element.clientWidth);
      const height = Math.round(element.clientHeight);
      setDimensions((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const { width, height } = dimensions;
    if (!document || !canvas.current || width < 40 || height < 40) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    async function render() {
      try {
        const page = await document!.getPage(pageNumber);
        if (cancelled || !canvas.current) return;
        setBusy(true);
        const base = page.getViewport({ scale: 1 });
        // Limit canvas memory at high zoom on wide/high-DPI displays.
        const fitScale = compact ? Math.min((width - 24) / base.width, (height - 24) / base.height) : (width - 32) / base.width;
        const requestedScale = fitScale * zoom;
        const scale = Math.min(requestedScale, Math.sqrt(8_000_000 / (base.width * base.height)));
        const viewport = page.getViewport({ scale });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
        // Keep the displayed page intact while a replacement is being rendered.
        const buffer = canvas.current.ownerDocument.createElement("canvas");
        buffer.width = Math.floor(viewport.width * pixelRatio);
        buffer.height = Math.floor(viewport.height * pixelRatio);
        task = page.render({ canvas: buffer, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] });
        await task.promise;
        if (cancelled || !canvas.current) return;
        const element = canvas.current;
        element.width = buffer.width;
        element.height = buffer.height;
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        element.getContext("2d")?.drawImage(buffer, 0, 0);
        setBusy(false);
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "RenderingCancelledException")) return;
        setBusy(false);
        setError("This page could not be rendered. Try opening the full preview.");
      }
    }
    void render();
    return () => { cancelled = true; task?.cancel(); };
  }, [document, pageNumber, zoom, dimensions, compact]);

  return (
    <div className={compact ? "flex h-full min-h-0 flex-col" : ""}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2">
        <div className="flex items-center gap-3"><button type="button" aria-label="Previous PDF page" disabled={!document || pageNumber === 1} onClick={() => { setPageNumber(pageNumber - 1); host.current?.scrollTo(0, 0); }} className="result-button disabled:opacity-40">←</button><span aria-live="polite" className="text-xs text-body">Page {pageNumber} of {document?.numPages || "…"}</span><button type="button" aria-label="Next PDF page" disabled={!document || pageNumber === document.numPages} onClick={() => { setPageNumber(pageNumber + 1); host.current?.scrollTo(0, 0); }} className="result-button disabled:opacity-40">→</button></div>
        {!compact && <div className="flex items-center gap-2"><button type="button" aria-label="Zoom out PDF" disabled={!document || zoom <= .5} onClick={() => setZoom(Math.max(.5, zoom - .25))} className="result-button disabled:opacity-40">−</button><button type="button" disabled={!document} onClick={() => setZoom(1)} className="result-button disabled:opacity-40">{zoom === 1 ? "Fit width" : `${Math.round(zoom * 100)}%`}</button><button type="button" aria-label="Zoom in PDF" disabled={!document || zoom >= 2} onClick={() => setZoom(Math.min(2, zoom + .25))} className="result-button disabled:opacity-40">+</button></div>}
      </div>
      <div className={compact ? "relative min-h-0 flex-1" : "relative"}>
        <div ref={host} className={`overflow-auto bg-background [scrollbar-gutter:stable] ${compact ? "h-full p-3" : "h-[540px] p-4"}`} aria-busy={busy}>
          {error ? <p role="alert" className="rounded-lg border border-line bg-panel p-5 text-sm leading-6 text-muted">{error}</p> : <canvas ref={canvas} width={0} height={0} role="img" aria-label={`PDF page ${pageNumber} preview`} className="mx-auto block bg-white shadow-lg" />}
        </div>
        {busy && !error && <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3"><p role="status" className="rounded-lg border border-line bg-panel px-4 py-2 text-center text-xs text-accent shadow-lg">Rendering PDF preview…</p></div>}
      </div>
    </div>
  );
}
