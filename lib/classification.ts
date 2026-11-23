import type { ExtractedPage } from "@/types/extraction/result";
import type { FinancialWorkbook } from "@/lib/financial-workbook";

// A byte cap also bounds token use for non-English text; this is not a token estimate.
export const MAX_CLASSIFICATION_BYTES = 2_400;
export const DOCUMENT_TYPES = ["invoice", "receipt", "bill", "credit_note", "purchase_order", "bank_statement", "other", "unknown"] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: "Invoice", receipt: "Receipt", bill: "Bill", credit_note: "Credit note",
  purchase_order: "Purchase order", bank_statement: "Bank statement", other: "Other document", unknown: "Unknown document type",
};

export type Classification = {
  documentType: DocumentType;
  isFinancialDocument: boolean;
  sampledBytes: number;
  model: string | null;
  inputTokens?: number;
  outputTokens?: number;
};

export type ClassificationJob = {
  id: string;
  status: "pending" | "complete" | "failed";
  expiresAt: number;
  result?: Classification;
  workbook?: FinancialWorkbook;
  error?: string;
  ownerUserId?: string;
  persistence?: { status: "pending" | "saved" | "failed"; billId?: string };
};

export type ClassificationReference = { jobId: string } | { error: string };

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && DOCUMENT_TYPES.some((type) => type === value);
}

function prefix(text: string, bytes: number) {
  let result = "";
  let size = 0;
  for (const char of text) {
    const length = Buffer.byteLength(char, "utf8");
    if (size + length > bytes) break;
    result += char;
    size += length;
  }
  return result;
}

function tail(text: string, bytes: number) {
  return Array.from(prefix(Array.from(text).reverse().join(""), bytes)).reverse().join("");
}

export function buildClassificationSample(pages: Pick<ExtractedPage, "text">[]): string {
  // Later pages and full tables never enter the event or model request.
  const texts = pages.slice(0, 2).map(({ text }) => text.replace(/[^\S\n]+/g, " ").trim());
  if (!texts.some(Boolean)) return "";
  const heading = prefix(texts[0] || "", 900);
  const ending = tail((texts[0] || "").slice(heading.length), 450);
  const secondHeading = prefix(texts[1] || "", 350);
  const cues = /\b(invoice|receipt|bill|total|paid|payment|balance|due|tax|vat|gst|credit note|purchase order|statement)\b/i;
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      const value = prefix(line.trim(), 120);
      if (cues.test(value) && !seen.has(value) && ![heading, ending, secondHeading].some((part) => part.includes(value))) {
        seen.add(value);
        lines.push(value);
        if (lines.length >= 12) break;
      }
    }
    if (lines.length >= 12) break;
  }
  return prefix([
    heading && `[Page 1 heading]\n${heading}`,
    lines.length && `[Payment clues]\n${prefix(lines.join("\n"), 600)}`,
    ending && `[Page 1 ending]\n${ending}`,
    secondHeading && `[Page 2 heading]\n${secondHeading}`,
  ].filter(Boolean).join("\n\n"), MAX_CLASSIFICATION_BYTES);
}
