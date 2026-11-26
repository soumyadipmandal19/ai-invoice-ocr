import type { OrganizationSource } from "@/lib/financial/organization";
import type { ExtractionResult } from "@/types/extraction/result";

const ORDER_LABEL = /\border\s*(?:id|number|no\.?)\s*[:=#]/i;
const SHIPPING_LABEL = /\b(?:ship(?:ping)?|delivery)\s*(?:mode|method)\s*[:=]/i;

/** Literal evidence alone cannot establish that a value has the right meaning. */
export function matchesReceiptMeaning(key: string, source: string) {
  if (key === "document_date" && /\b(?:period|duration|due\s*date|delivery\s*date|order\s*date|payment\s*date)\b/i.test(source)
    && !/\b(?:bill|invoice|receipt|statement|issue|issued|transaction)\s*date\b/i.test(source)) return false;
  if (key === "document_number" && ORDER_LABEL.test(source) && !/\b(?:invoice|receipt|bill)\s*(?:number|no\.?|#)/i.test(source)) return false;
  if (key === "payment_method" && SHIPPING_LABEL.test(source) && !/\bpayment\s*(?:mode|method)\s*[:=]/i.test(source)) return false;
  return true;
}

const printedDate = /^(?:\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})(?![\d/-])/i;

/** Resolve chunk disagreement only from explicit date labels in original OCR.
 * Keep the printed value; numeric date order is never guessed. */
export function reconcileReceiptDate(receipt: Record<string, string>, pages: Pick<ExtractionResult, "pages">["pages"]): string[] | null {
  const candidates: { value: string; priority: number }[] = [];
  for (const page of pages) {
    for (const line of page.text.split(/\r?\n/)) {
      const labels = /\b((?:bill|invoice|receipt|statement|issue|issued|transaction)\s*date|date\s+of\s+issue)\s*[:=]?\s*/gi;
      for (const match of line.matchAll(labels)) {
        const value = line.slice(match.index! + match[0].length).match(printedDate)?.[0];
        if (value) candidates.push({ value, priority: /^(?:statement|transaction)/i.test(match[1]) ? 1 : 2 });
      }
      const plain = line.match(/^\s*date\s*[:=]\s*/i);
      const value = plain && line.slice(plain[0].length).match(printedDate)?.[0];
      if (value) candidates.push({ value, priority: 0 });
    }
  }
  if (!candidates.length) return null;
  const priority = Math.max(...candidates.map((candidate) => candidate.priority));
  const values = new Map(candidates.filter((candidate) => candidate.priority === priority)
    .map(({ value }) => [value.toLowerCase().replace(/\s+/g, " "), value]));
  if (values.size === 1) {
    receipt.document_date = [...values.values()][0];
    return [];
  }
  delete receipt.document_date;
  return ["Conflicting explicit document dates were left blank. Check the source document."];
}

/** Recover only explicit, unambiguous identifiers; never infer financial amounts. */
export function reconcileReceiptIdentifiers(receipt: Record<string, string>, sources: OrganizationSource[], documentType?: string) {
  const candidates = new Map<string, Set<string>>();
  const add = (key: string, value: string) => {
    if (!candidates.has(key)) candidates.set(key, new Set());
    candidates.get(key)!.add(value.trim());
  };
  const lines = sources.filter((source) => source.kind === "line");
  for (const [index, source] of lines.entries()) {
    const order = source.text.match(/^\s*order\s*(?:id|number|no\.?)\s*[:=#]\s*(\S+)\s*$/i);
    if (order) add("order_id", order[1]);
    const shipping = source.text.match(/^\s*(?:ship(?:ping)?|delivery)\s*(?:mode|method)\s*[:=]\s*(.+)$/i);
    if (shipping) add("shipping_method", shipping[1]);
    const number = source.text.match(/^\s*(invoice|receipt|bill|purchase\s+order)\s*(?:number|no\.?|#)\s*[:=#]?\s*(\S+)\s*$/i);
    if (number && (!documentType || number[1].toLowerCase().replace(/\s+/g, "_") === documentType)) add("document_number", number[2]);
    // A standalone # is an invoice number only next to an invoice heading.
    const bare = source.text.match(/^\s*#\s*(\S+)\s*$/);
    const previous = lines[index - 1];
    if (bare && documentType === "invoice" && previous?.page === source.page && /\binvoice\s*$/i.test(previous.text)
      && (source.line === undefined || previous.line === undefined || source.line - previous.line <= 3)) add("document_number", bare[1]);
  }
  const warnings: string[] = [];
  for (const [key, values] of candidates) {
    if (values.size !== 1 || (receipt[key] && !values.has(receipt[key]))) {
      delete receipt[key];
      warnings.push(`Conflicting evidence for ${key} was left blank. Check the source document.`);
    } else receipt[key] = [...values][0];
  }
  return warnings;
}

// Deliberately excludes ambiguous comma decimals and currency-code conversions.
function decimal(value: string | undefined) {
  if (!value) return null;
  const text = value.trim().replace(/^(?:[A-Z]{3}\s+|[$€£₹฿]\s*)/, "").replace(/\s+[A-Z]{3}$/, "");
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
  const number = Number(text.replaceAll(",", ""));
  return Number.isFinite(number) && Math.abs(number) < 1e12 ? number : null;
}

export function financialArithmeticWarnings(receipt: Record<string, string>, items: Record<string, string>[]) {
  const warnings: string[] = [];
  for (const [index, item] of items.entries()) {
    // Adjustment semantics vary by invoice. Check only simple, unadjusted rows.
    if (["discount", "discount_rate", "tax", "tax_rate"].some((key) => item[key])) continue;
    const quantity = decimal(item.quantity), price = decimal(item.unit_price), total = decimal(item.line_total);
    if (quantity !== null && price !== null && total !== null && Math.abs(quantity * price - total) > 0.005) {
      warnings.push(`Item ${index + 1}: quantity × unit price differs from the printed line total. Original amounts were retained; check rounding or missing adjustments.`);
    }
  }
  const subtotal = decimal(receipt.subtotal), total = decimal(receipt.total);
  const adjustments = ["discount", "tax", "shipping"].map((key) => receipt[key] ? decimal(receipt[key]) : 0);
  if (subtotal !== null && total !== null && adjustments.every((value) => value !== null)) {
    const [discount, tax, shipping] = adjustments as number[];
    if (Math.abs(subtotal - discount + tax + shipping - total) > 0.005) warnings.push("Subtotal minus discount plus tax and shipping differs from the printed total. Original amounts were retained; check missing adjustments.");
  }
  return warnings;
}
