import type { ClassificationReference } from "@/lib/classification";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_BYTES = MAX_UPLOAD_BYTES;
export const SUPPORTED_FILE_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "bmp"];
export const MAX_PDF_PAGES = 20;

export type ExtractedPage = {
  page: number;
  text: string;
  method: "text" | "ocr" | "mixed" | "blank";
};

export type StructuredField = {
  id: string;
  page: number;
  key: string;
  label: string;
  value: string;
  sourceText: string;
  sourceLine: number | null;
  reviewed: boolean;
};

export type StructuredTable = {
  id: string;
  page: number;
  columns: string[];
  rows: string[][];
  bbox: number[];
  source: "pdf_layout" | "aligned_text";
  reviewed: boolean;
};

export type StructuredData = {
  schemaVersion: 1;
  fields: StructuredField[];
  tables: StructuredTable[];
  warnings: string[];
};

export type ExtractionResult = {
  sourceFileName?: string;
  pageCount: number;
  pages: ExtractedPage[];
  structured: StructuredData;
  classification?: ClassificationReference;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validPage(value: unknown, pageCount: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= pageCount;
}

function isStructuredData(value: unknown, pageCount: number): value is StructuredData {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.fields) ||
    !Array.isArray(value.tables) || !Array.isArray(value.warnings) ||
    !value.warnings.every((warning: unknown) => typeof warning === "string")) return false;
  const ids = new Set<string>();
  const uniqueId = (id: unknown) => {
    if (typeof id !== "string" || !id || ids.has(id)) return false;
    ids.add(id);
    return true;
  };
  return value.fields.every((field: unknown) => record(field) && uniqueId(field.id) &&
    validPage(field.page, pageCount) && typeof field.key === "string" &&
    typeof field.label === "string" && typeof field.value === "string" &&
    typeof field.sourceText === "string" && typeof field.reviewed === "boolean" &&
    (field.sourceLine === null || (typeof field.sourceLine === "number" && Number.isInteger(field.sourceLine) && field.sourceLine > 0))) &&
    value.tables.every((table: unknown) => {
      if (!record(table) || !uniqueId(table.id) || !validPage(table.page, pageCount) ||
        typeof table.reviewed !== "boolean" || !["pdf_layout", "aligned_text"].includes(String(table.source)) ||
        !Array.isArray(table.columns) || table.columns.length < 2 ||
        !table.columns.every((column: unknown) => typeof column === "string") ||
        !Array.isArray(table.rows) || !Array.isArray(table.bbox) || table.bbox.length !== 4 ||
        !table.bbox.every((coordinate: unknown) => typeof coordinate === "number" && Number.isFinite(coordinate))) return false;
      const width = table.columns.length;
      return table.rows.every((row: unknown) => Array.isArray(row) && row.length === width && row.every((cell: unknown) => typeof cell === "string"));
    });
}

export function isExtractionResult(value: unknown): value is ExtractionResult {
  if (!record(value)) return false;
  const { pageCount, pages, structured } = value;
  return typeof pageCount === "number" && Number.isInteger(pageCount) &&
    pageCount > 0 && pageCount <= MAX_PDF_PAGES && Array.isArray(pages) &&
    pages.length === pageCount && pages.every((item: unknown, index: number) => {
      if (!record(item)) return false;
      return item.page === index + 1 && typeof item.text === "string" &&
        ["text", "ocr", "mixed", "blank"].includes(String(item.method));
    }) && isStructuredData(structured, pageCount);
}
