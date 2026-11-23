import type { ClassificationJob } from "@/lib/classification/document";
import type { FinancialWorkbook } from "@/lib/financial/workbook";
import type { ExtractionResult } from "@/types/extraction/result";

/** One upload attempt, kept in arrival order for the lifetime of this tab. */
export type WorkspaceRecord = {
  id: string;
  index: number;
  fileName: string;
  addedAt: string;
  status: "extracting" | "checking" | "ready" | "unsupported" | "failed";
  result: ExtractionResult | null;
  workbook: FinancialWorkbook | null;
  job: ClassificationJob | null;
  error: string;
  restored?: boolean;
};
