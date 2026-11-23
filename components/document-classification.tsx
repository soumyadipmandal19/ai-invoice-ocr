"use client";

import { useEffect, useState } from "react";
import { DOCUMENT_TYPE_LABELS, isDocumentType, type ClassificationJob, type ClassificationReference } from "@/lib/classification";

export default function DocumentClassification({ reference, onSettled, onError }: {
  reference: ClassificationReference;
  onSettled?: (job: ClassificationJob) => void;
  onError?: (message: string) => void;
}) {
  const [job, setJob] = useState<ClassificationJob | null>(null);
  const [error, setError] = useState("");
  const jobId = "jobId" in reference ? reference.jobId : null;

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const started = Date.now();
    async function poll() {
      try {
        const response = await fetch(`/api/classifications/${encodeURIComponent(jobId!)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Unable to check document type. Try processing the document again.");
        const data: ClassificationJob = await response.json();
        if (cancelled) return;
        if (data.status === "complete" && !isDocumentType(data.result?.documentType)) throw new Error("The server returned an invalid document type.");
        setJob(data);
        if (data.status !== "pending") onSettled?.(data);
        if (data.status === "pending") {
          if (Date.now() - started >= 600_000) throw new Error("Document processing is taking longer than expected. Check the Inngest run.");
          timer = setTimeout(poll, 1_000);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Unable to check document type.";
          setError(message);
          onError?.(message);
        }
      }
    }
    void poll();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [jobId, onSettled, onError]);

  const message = "error" in reference ? reference.error : error || job?.error;
  const result = job?.status === "complete" ? job.result : undefined;
  if (!message && !result) return null;

  return (
    <div role="status" className="border-b border-line bg-accent-soft/30 px-4 py-3 text-xs leading-5 sm:px-5">
      <span className="font-medium text-foreground">Document type: </span>
      {message ? <span className="text-muted">{message}</span> : result ? <>
        <span className="font-medium text-accent">{DOCUMENT_TYPE_LABELS[result.documentType]}</span>
        <span className="ml-2 text-muted">{job?.workbook ? "Financial CSV sheets are ready · Verify before use" : result.isFinancialDocument ? "Financial document detected. Process it again to prepare CSV sheets." : result.sampledBytes ? "Not identified as a financial document. CSV organization was skipped." : "No readable text in the sampled pages. CSV organization was skipped."}</span>
      </> : <span className="text-muted">Checking the document type and organizing supported financial data…</span>}
    </div>
  );
}
