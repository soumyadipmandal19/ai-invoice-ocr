import { financialArithmeticWarnings, matchesReceiptMeaning, reconcileReceiptIdentifiers } from "@/lib/financial/validation";
import type { ExtractionResult } from "@/types/extraction/result";

export const MAX_ORGANIZATION_CHUNK_BYTES = 5_000;
export const MAX_ORGANIZATION_TOTAL_BYTES = 24_000;
export const MAX_ORGANIZATION_CHUNKS = 8;

export const RECEIPT_MAPPING_FIELDS = ["document_date", "merchant_name", "document_number", "currency", "subtotal", "discount", "tax", "shipping", "total", "amount_paid", "balance_due", "payment_method", "customer_name", "merchant_tax_id", "order_id", "shipping_method"] as const;
export const PRODUCT_MAPPING_FIELDS = ["product_name", "product_code", "category", "quantity", "unit", "unit_price", "discount", "discount_rate", "tax", "tax_rate", "line_total", "currency"] as const;

export type OrganizationSource = { id: string; page: number; kind: "field" | "table_row" | "line"; text: string; line?: number; continuationOf?: string };
export type MappedProduct = { source: string; values: Record<string, string>; page: number };
export type OrganizationChunkResult = {
  receipt: Record<string, string>; items: MappedProduct[]; warnings: string[];
  model: string; inputBytes: number; inputTokens?: number; outputTokens?: number;
};
export type OrganizedFinancialData = {
  receipt: Record<string, string>; items: Record<string, string>[]; warnings: string[];
  model: string; inputBytes: number; chunks: number; inputTokens?: number; outputTokens?: number;
};

export function compactOcrText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

// Keep fields/table rows compact and avoid sending their duplicate OCR lines.
export function prepareOrganizationInput(document: ExtractionResult, options?: { legacyRecordLimit?: 20; layoutVersion?: 2 | 3 }): OrganizationSource[][] {
  const modern = !options?.legacyRecordLimit && options?.layoutVersion !== 2;
  const pageTextByNumber = new Map<number, string>();
  const pagesByNumber = new Map(modern && document.structured.fields.length
    ? document.pages.map((page) => [page.page, page] as const) : []);
  const represented = new Map<number, Set<string>>();
  const remember = (page: number, value: string) => {
    if (!represented.has(page)) represented.set(page, new Set());
    represented.get(page)!.add(compactOcrText(value));
  };
  // Yield records in the existing order so cached plans retain their boundaries.
  function* sources(): Generator<OrganizationSource> {
    for (const [index, field] of document.structured.fields.entries()) {
      const text = compactOcrText(`${field.label}: ${field.value}`);
      // Reject inferred label/value pairs that do not actually occur in the raw text.
      if (modern) {
        if (!pageTextByNumber.has(field.page)) {
          const page = pagesByNumber.get(field.page);
          if (!page) continue;
          pageTextByNumber.set(field.page, compactOcrText(page.text));
        }
        if (!pageTextByNumber.get(field.page)!.includes(text)) continue;
      }
      yield { id: `f${index + 1}`, page: field.page, kind: "field", text };
      if (!modern) {
        remember(field.page, field.sourceText);
        remember(field.page, text);
      }
    }
    for (const [index, table] of document.structured.tables.entries()) {
      const columns = table.columns.map((column, index) => compactOcrText(column || `Column ${index + 1}`));
      for (const column of table.columns) remember(table.page, column);
      remember(table.page, table.columns.join(" "));
      for (const [rowIndex, row] of table.rows.entries()) {
        for (const cell of row) remember(table.page, cell);
        remember(table.page, row.join(" "));
        yield {
          id: `t${index + 1}r${rowIndex + 1}`, page: table.page, kind: "table_row",
          text: row.map((cell, column) => `${columns[column] ?? `Column ${column + 1}`}: ${compactOcrText(cell)}`).join(" | "),
        };
      }
    }
    for (const page of document.pages) {
      let previous: OrganizationSource | undefined;
      for (const [index, line] of page.text.split(/\r?\n/).entries()) {
        const text = compactOcrText(line);
        if (!text || represented.get(page.page)?.has(text)) continue;
        const source: OrganizationSource = { id: `p${page.page}l${index + 1}`, page: page.page, kind: "line", text, ...(modern ? { line: index + 1 } : {}) };
        // Keep an unlabelled SKU/category continuation with its preceding priced row.
        // Explicit links prevent borrowing another product's values from the same page.
        if (modern && previous && index + 1 - previous.line! <= 3
          && /(?:[$€£₹฿]\s*\d|\d[.,]\d{2}\b)/.test(previous.text)
          && !/^(?:sub\s*total|total|tax|discount|shipping|balance|paid)\b/i.test(previous.text)
          && /,|\b[A-Z]{2,}-[A-Z0-9-]*\d/i.test(text)
          && !/[:=]|[$€£₹฿]|\d[.,]\d{2}\b/.test(text)) source.continuationOf = previous.id;
        yield source;
        previous = source;
      }
    }
  }
  const chunks: OrganizationSource[][] = [];
  let current: OrganizationSource[] = [];
  let currentBytes = 2; // JSON array brackets.
  let totalBytes = 0;
  function packGroup(group: OrganizationSource[]) {
    const groupBytes = Buffer.byteLength(JSON.stringify(group), "utf8");
    if (groupBytes > MAX_ORGANIZATION_CHUNK_BYTES) {
      throw new Error("An OCR row is too large to organize within the model budget. Split the document or use a smaller receipt.");
    }
    // Joining two nonempty JSON arrays replaces their adjacent brackets with a comma.
    const candidateBytes = current.length ? currentBytes + groupBytes - 1 : groupBytes;
    if (current.length && ((options?.legacyRecordLimit && current.length >= options.legacyRecordLimit) || candidateBytes > MAX_ORGANIZATION_CHUNK_BYTES)) {
      totalBytes += currentBytes;
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    currentBytes = current.length ? candidateBytes : groupBytes;
    current.push(...group);
    if (totalBytes + currentBytes > MAX_ORGANIZATION_TOTAL_BYTES || chunks.length + 1 > MAX_ORGANIZATION_CHUNKS) {
      throw new Error("This document exceeds the LLM organization budget. Split it into smaller receipts and try again.");
    }
  }
  // Hold one group until its continuations are known, then pack it immediately.
  let pending: OrganizationSource[] = [];
  for (const source of sources()) {
    if (source.continuationOf && pending.some((entry) => entry.id === source.continuationOf)) {
      pending.push(source);
    } else {
      if (pending.length) packGroup(pending);
      pending = [source];
    }
  }
  if (pending.length) packGroup(pending);
  if (current.length) chunks.push(current);
  return chunks;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasLiteralValue(text: string, value: string) {
  let position = text.indexOf(value);
  while (position >= 0) {
    // A guessed 3.00 must not pass merely because the OCR contains 13.00.
    if (!/^[+\-]?(?:[$€£₹฿]\s*)?\d/.test(value) ||
      (!/[\d.,]/.test(text[position - 1] || "") && !/[\d.,]/.test(text[position + value.length] || ""))) return true;
    position = text.indexOf(value, position + 1);
  }
  return false;
}

// Values must be copied from the cited OCR record, never calculated or invented.
export function validateOrganizationResponse(data: unknown, sources: OrganizationSource[], documentType?: string): Pick<OrganizationChunkResult, "receipt" | "items" | "warnings"> {
  if (!record(data) || !record(data.receipt) || !Array.isArray(data.items) || data.items.length > sources.length) {
    throw new Error("OpenRouter returned an invalid financial mapping.");
  }
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const warnings: string[] = [];
  function fields(value: Record<string, unknown>, allowed: readonly string[], page?: number, rowSource?: string, defaultSource?: string) {
    const mapped: Record<string, string> = {};
    for (const [key, rawEvidence] of Object.entries(value)) {
      if (!allowed.includes(key)) throw new Error("OpenRouter returned an unknown financial field.");
      // Compact item strings cite the item's anchor automatically. Explicit pairs
      // remain available for products whose OCR evidence spans several lines.
      const evidence = typeof rawEvidence === "string" && defaultSource ? [rawEvidence, defaultSource] : rawEvidence;
      if (evidence === null || evidence === "") continue;
      if (!Array.isArray(evidence) || evidence.length !== 2 || typeof evidence[0] !== "string" || typeof evidence[1] !== "string" || evidence[0].length > 500) {
        throw new Error("OpenRouter returned invalid field evidence.");
      }
      const text = compactOcrText(evidence[0]);
      if (!text) continue;
      let source = sourceById.get(evidence[1]);
      // Some models use the anchor ID for a compact value copied from its continuation.
      // Recover only literal, uniquely matching descriptive metadata, never prices.
      if (defaultSource && source?.id === defaultSource && !hasLiteralValue(source.text, text) && ["product_code", "category", "unit"].includes(key)) {
        const matches = sources.filter((entry) => entry.continuationOf === defaultSource && hasLiteralValue(entry.text, text));
        if (matches.length === 1) source = matches[0];
      }
      const anchor = defaultSource ? sourceById.get(defaultSource) : undefined;
      const wrongItem = anchor && source?.id !== anchor.id && !(source?.continuationOf === anchor.id && ["product_code", "category", "unit"].includes(key));
      if (source && !defaultSource && !matchesReceiptMeaning(key, source.text)) {
        warnings.push(`The cited label does not describe ${key}; the model value was left blank.`);
        continue;
      }
      if (!source || (page !== undefined && source.page !== page) || wrongItem || (rowSource && source.id !== rowSource) || !hasLiteralValue(source.text, text)) {
        warnings.push(`A model value for ${key} was not found in its cited OCR source and was left blank.`);
        continue;
      }
      mapped[key] = text;
    }
    return mapped;
  }
  const receipt = fields(data.receipt, RECEIPT_MAPPING_FIELDS);
  warnings.push(...reconcileReceiptIdentifiers(receipt, sources, documentType));
  const items: MappedProduct[] = [];
  const seen = new Set<string>();
  for (const item of data.items) {
    if (!record(item) || typeof item.source !== "string" || !record(item.values)) throw new Error("OpenRouter returned an invalid product mapping.");
    const source = sourceById.get(item.source);
    if (!source || seen.has(source.id)) {
      warnings.push("An invalid or repeated product source was excluded. Check the original OCR data.");
      continue;
    }
    const values = fields(item.values, PRODUCT_MAPPING_FIELDS, source.page, source.kind === "table_row" ? source.id : undefined, source.id);
    if (!values.product_name || !source.text.includes(values.product_name)) {
      warnings.push("A product without a verified source name was excluded. Check source lines for missing items.");
      continue;
    }
    seen.add(source.id);
    items.push({ source: source.id, page: source.page, values });
  }
  return { receipt, items, warnings: [...new Set(warnings)] };
}

export function mergeOrganizationChunks(chunks: OrganizationChunkResult[], bankStatement = false): OrganizedFinancialData {
  const warnings = chunks.flatMap((chunk) => chunk.warnings);
  const receipt: Record<string, string> = {};
  for (const key of RECEIPT_MAPPING_FIELDS) {
    const values = [...new Set(chunks.map((chunk) => chunk.receipt[key]).filter(Boolean))];
    if (values.length === 1) receipt[key] = values[0];
    else if (values.length > 1) warnings.push(`Conflicting model mappings for ${key} were left blank. Check the source document.`);
  }
  const items: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    for (const item of chunk.items) {
      if (bankStatement || seen.has(item.source)) continue;
      seen.add(item.source);
      items.push({ ...item.values, source_page: String(item.page) });
    }
  }
  if (bankStatement) warnings.push("Bank statement transactions are not treated as product purchases.");
  items.sort((a, b) => Number(a.source_page) - Number(b.source_page));
  if (!items.length) warnings.push("No verified product rows were mapped. Review the source document and add missing products manually.");
  const total = (key: "inputTokens" | "outputTokens") => chunks.some((chunk) => chunk[key] !== undefined) ? chunks.reduce((sum, chunk) => sum + (chunk[key] || 0), 0) : undefined;
  return {
    receipt, items, warnings: [...new Set([...warnings, ...financialArithmeticWarnings(receipt, items)])], model: chunks[0]?.model || "",
    inputBytes: chunks.reduce((sum, chunk) => sum + chunk.inputBytes, 0), chunks: chunks.length,
    inputTokens: total("inputTokens"), outputTokens: total("outputTokens"),
  };
}
