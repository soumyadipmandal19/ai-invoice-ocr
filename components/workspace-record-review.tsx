"use client";

import { useCallback } from "react";
import ExtractionResultView from "@/components/extraction-result";
import FinancialWorkbookView from "@/components/financial-workbook";
import BillEvidence from "@/components/bill-evidence";
import type { ClassificationJob } from "@/lib/classification/document";
import type { FinancialWorkbook } from "@/lib/financial/workbook";
import type { WorkspaceRecord } from "@/types/workspace/record";

/** Stable per-record callbacks keep background polling independent of new uploads. */
export default function WorkspaceRecordReview({ record, onPatch, onChooseAnother }: {
  record: WorkspaceRecord;
  onPatch: (id: string, patch: Partial<WorkspaceRecord>) => void;
  onChooseAnother: () => void;
}) {
  const id = record.id;
  const settled = useCallback((job: ClassificationJob) => {
    onPatch(id, {
      job, workbook: job.workbook || null,
      status: job.status === "failed" ? "failed" : job.result?.isFinancialDocument ? "ready" : "unsupported",
      error: job.error || "",
    });
  }, [id, onPatch]);
  const failed = useCallback(() => onPatch(id, { status: "failed", error: "Could not finish organizing. Original OCR output is available in the workbook." }), [id, onPatch]);
  const changed = useCallback((workbook: FinancialWorkbook | null) => onPatch(id, { workbook }), [id, onPatch]);
  if (record.restored && record.workbook && (!record.result || !record.job?.result)) return <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><BillEvidence record={record} /><FinancialWorkbookView workbook={record.workbook} onChange={changed} fileName={record.fileName} /></div>;
  if (!record.result) return <p className="p-5 text-sm text-muted">The saved output is unavailable for this record.</p>;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{record.workbook && <BillEvidence record={record} />}<ExtractionResultView result={record.result} fileName={record.fileName} workbook={record.workbook} onWorkbookChange={changed} onChooseAnother={onChooseAnother} onClassificationSettled={settled} onClassificationError={failed} initialJob={record.restored ? record.job || undefined : undefined} /></div>;
}
