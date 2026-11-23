import type { SavedBill } from "@/types/bills/responses";
import type { WorkspaceRecord } from "@/types/workspace/record";

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
