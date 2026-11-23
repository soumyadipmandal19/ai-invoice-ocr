import type { Classification } from "@/lib/classification/document";
import type { FinancialWorkbook } from "@/lib/financial/workbook";
import type { ExtractionResult } from "@/types/extraction/result";

export type SavedBill = {
  billId: string;
  sourceFile: string;
  createdAt: string;
  classification: Classification | null;
  workbook: FinancialWorkbook | null;
  ocr: ExtractionResult | null;
};
export type SavedBillPage = { bills: SavedBill[]; nextOffset: number | null };
