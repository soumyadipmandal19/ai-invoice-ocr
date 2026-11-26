import "server-only";

import { completeClassificationJob, readClassificationArtifacts, readClassificationJob, deleteClassificationJobForOwner } from "@/lib/server/classification/store";
import { recoverMissingWorkbookItems } from "@/lib/financial/workbook";
import { normalizeBill } from "@/lib/server/bills/normalize";
import { storeBill, deleteOwnedBill } from "@/lib/server/bills/store";
import { embeddingsEnabled, queueBillEmbeddings } from "@/lib/server/embeddings/service";

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
  const artifacts = await readClassificationArtifacts(job.id);
  if (!artifacts) throw new BillSaveError("The original OCR and AI snapshots are unavailable for this older result. Upload the document again.", 409);
  // Recover source-backed rows before normalization, including older staged jobs.
  const workbook = recoverMissingWorkbookItems(job.workbook, artifacts.ocr)!;
  const { bill, items } = normalizeBill(job.id, ownerUserId, workbook, job.result);
  const saved = await storeBill(bill, items, artifacts, job.uploadKey);
  // Complete the local job only after the graph transaction commits successfully.
  await completeClassificationJob(job.id, job.result, workbook, saved.billId);
  if (embeddingsEnabled()) {
    try { await queueBillEmbeddings(saved.billId, ownerUserId); }
    catch { console.error("Bill saved, but local embeddings could not be queued. Retry POST /api/embeddings."); }
  }
  return saved;
}
