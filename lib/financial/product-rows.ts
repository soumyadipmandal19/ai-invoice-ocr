import type { ExtractionResult } from "@/types/extraction/result";

export const RECOVERED_ITEM_NOTE = "Recovered from the explicit OCR item table; verify against the source.";

/** A conservative fallback for printed four-column product tables, not prose. */
export function recoverExplicitProductRows(document: Pick<ExtractionResult, "pages">): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  const header = /^(?:item|product|description)(?:\s+(?:name|description))?\s+(?:qty|quantity)\s+(?:rate|unit price)\s+(?:amount|line total)$/i;
  const money = "(?:[₹$€£]\\s*)?[+−-]?\\d[\\d,]*\\.\\d{2}";
  const priced = new RegExp(`^(.+?)\\s+([+−-]?\\d+(?:\\.\\d+)?)\\s+(${money})\\s+(${money})$`);
  const end = /^(?:sub\s*total|taxable\s+(?:value|amount)|grand\s+total|total|cgst|sgst|igst|tax|round[ -]?off|paid|balance|amount due|thank\s+you)\b/i;
  const metadata = /^(?:sac|hsn|gst|gstin|code|rate|amount|qty|quantity|item|description)\b/i;
  for (const page of document.pages) {
    const lines = page.text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim());
    let active = false;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (header.test(line)) { active = true; continue; }
      if (!active || !line) continue;
      if (end.test(line)) { active = false; continue; }
      const match = priced.exec(line);
      if (!match || !/[\p{L}]/u.test(match[1]) || metadata.test(match[1])) continue;
      const name = [match[1]];
      // A wrapped description immediately follows its own priced line. Never
      // cross a tax-code line, another product, a blank gap, or a summary.
      for (let next = index + 1; next <= index + 2 && next < lines.length; next++) {
        const continuation = lines[next];
        if (!continuation || metadata.test(continuation) || end.test(continuation)
          || !/^[\p{L}][\p{L}\s'’(),&/-]{0,100}$/u.test(continuation)) break;
        name.push(continuation);
      }
      items.push({ product_name: name.join(" "), quantity: match[2], unit_price: match[3], line_total: match[4],
        source_page: String(page.page), notes: RECOVERED_ITEM_NOTE });
    }
  }
  return items;
}
