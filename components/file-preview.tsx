"use client";

import Image from "next/image";
import { useState } from "react";
import PdfPreview from "@/components/pdf-preview";

export default function FilePreview({ file, url, compact = false }: { file: File; url: string; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  return (
    <section aria-label="Selected file preview" className={compact ? "h-[360px] min-h-0 overflow-hidden" : ""}>
      {!compact && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-widest text-accent">Input preview</p><h2 className="mt-2 break-all text-sm font-medium text-foreground">{file.name}</h2><p className="mt-1 text-xs text-muted">{(file.size / 1024 / 1024).toFixed(2)} MB · {isPdf ? "PDF document" : "Image"}</p></div>
        <a href={url} target="_blank" rel="noopener noreferrer" className="result-button">Open full preview ↗</a>
      </div>}
      {isPdf ? <PdfPreview file={file} compact={compact} /> : <div className={`${compact ? "h-full p-3" : "h-[540px] p-3 sm:p-5"} bg-background`}>
        {failed ? (
          <div role="alert" className="flex h-full items-center justify-center rounded-lg border border-line p-6 text-center text-sm leading-6 text-muted">This image could not be previewed. Choose a valid PNG, JPG, WebP, or BMP file.</div>
        ) : <Image src={url} alt={`Preview of ${file.name}`} width={1200} height={1600} unoptimized onError={() => setFailed(true)} className="h-full w-full rounded-lg object-contain" />}
      </div>}
    </section>
  );
}
