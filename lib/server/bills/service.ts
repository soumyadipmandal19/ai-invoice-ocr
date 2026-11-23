import "server-only";

import { completeClassificationJob, readClassificationArtifacts, readClassificationJob, deleteClassificationJobForOwner } from "@/lib/server/classification/store";
import { normalizeBill } from "@/lib/server/bills/normalize";
import { storeBill, deleteOwnedBill } from "@/lib/server/bills/store";

export class BillSaveError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function deleteSavedBill(billId: string, ownerUserId: string) {
  if (!(await deleteOwnedBill(billId, ownerUserId))) return false;
  await deleteClassificationJobForOwner(billId, ownerUserId);
  return true;
}

/** Shared by Inngest and POST /api/bills; the client never supplies bill contents or ownership. */
export async function saveOrganizedBill(jobId: string, ownerUserId: string) {
  const job = await readClassificationJob(jobId);
  if (!job || !job.ownerUserId || job.ownerUserId !== ownerUserId) throw new BillSaveError("Result not found or expired.", 404);
  if (!job.result?.isFinancialDocument || !job.workbook || !job.persistence) {
    throw new BillSaveError("A successfully organized financial result is required before saving.", 409);
  }
  const { bill, items } = normalizeBill(job.id, ownerUserId, job.workbook, job.result);
  const artifacts = await readClassificationArtifacts(job.id);
  if (!artifacts) throw new BillSaveError("The original OCR and AI snapshots are unavailable for this older result. Upload the document again.", 409);
  const saved = await storeBill(bill, items, artifacts);
  // Complete the local job only after the graph transaction commits successfully.
  await completeClassificationJob(job.id, job.result, job.workbook, saved.billId);
  return saved;
}
