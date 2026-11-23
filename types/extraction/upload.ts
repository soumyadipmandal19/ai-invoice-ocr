import type { SavedBill } from "@/types/bills/responses";
import type { ExtractionResult } from "@/types/extraction/result";

export type DuplicateUpload = {
  duplicate: true;
  jobId: string;
  message: string;
  bill?: SavedBill;
  document?: ExtractionResult;
};
