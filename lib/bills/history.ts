import type { SavedBill } from "@/types/bills/responses";
import type { WorkspaceRecord } from "@/types/workspace/record";
import type { DuplicateUpload } from "@/types/extraction/upload";

function savedIdentity(record: WorkspaceRecord) {
  return record.job?.persistence?.billId || record.job?.id ||
    (record.result?.classification && "jobId" in record.result.classification ? record.result.classification.jobId : record.id);
}

/** Preserve current-session edits and append only previously unseen saved bills. */
export function mergeSavedBills(current: WorkspaceRecord[], saved: SavedBill[]): WorkspaceRecord[] {
  const known = new Set(current.map(savedIdentity));
  const restored: WorkspaceRecord[] = [];
  for (const bill of saved) {
    if (known.has(bill.billId)) continue;
    known.add(bill.billId);
    // Never poll the expired temporary classification job of a saved bill.
    const result = bill.ocr ? { ...bill.ocr, classification: undefined } : null;
    restored.push({
      id: bill.billId, index: 0, fileName: bill.sourceFile || "Saved document", addedAt: bill.createdAt,
      status: "ready", result, workbook: bill.workbook, error: "", restored: true,
      job: { id: bill.billId, status: "complete", expiresAt: 0, result: bill.classification || undefined,
        workbook: bill.workbook || undefined, persistence: { status: "saved", billId: bill.billId } },
    });
  }
  return [...current, ...restored]
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))
    .map((record, index) => ({ ...record, index: index + 1 }));
}

export function removeWorkspaceRecord(records: WorkspaceRecord[], id: string): WorkspaceRecord[] {
  return records.filter((record) => record.id !== id).map((record, index) => ({ ...record, index: index + 1 }));
}

/** Reuse a document rather than keeping the temporary duplicate-upload row. */
export function mergeDuplicateUpload(current: WorkspaceRecord[], attemptId: string, duplicate: DuplicateUpload) {
  let records = removeWorkspaceRecord(current, attemptId);
  const existing = records.find((record) => savedIdentity(record) === duplicate.jobId);
  if (duplicate.bill) {
    const restored = mergeSavedBills([], [duplicate.bill])[0];
    if (existing) {
      // Preserve edits to ready documents; finish stale/expired polling records.
      if (existing.status !== "ready") records = records.map((record) => record.id === existing.id ? { ...restored, id: existing.id, index: existing.index } : record);
    } else records = mergeSavedBills(records, [duplicate.bill]);
  } else if (!existing && duplicate.document) {
    const attempt = current.find((record) => record.id === attemptId);
    if (attempt) records = [...records, { ...attempt, status: "checking" as const, result: duplicate.document }]
      .map((record, index) => ({ ...record, index: index + 1 }));
  }
  return { records, activeId: existing?.id || records.find((record) => savedIdentity(record) === duplicate.jobId)?.id || "workbook" };
}
