import type { ExtractionResult } from "@/types/extraction/result";
import type { OrganizedFinancialData, OrganizationChunkResult } from "@/lib/financial-organization";

/** Original OCR result and validated AI outputs, before workbook editing. */
export type WorkflowArtifacts = {
  ocr: ExtractionResult;
  organization: OrganizedFinancialData;
  mappingResults: OrganizationChunkResult[];
};
