import { billReview, receiptValues, sessionColumnLabel, isoBillDate } from "@/lib/bills/session-workbook";
import { currencyCode, priceCurrencies } from "@/lib/financial/currency";
import type { WorkspaceRecord } from "@/types/workspace/record";

export function standardizedValue(key: string, value: string): string | null {
  if (!value.trim()) return null;
  if (key === "currency") return currencyCode(value);
  if (key === "document_date") return isoBillDate(value);
  let amount = value.trim();
  for (const currency of priceCurrencies(amount)) {
    if (amount.startsWith(currency)) amount = amount.slice(currency.length).trim();
    else if (amount.endsWith(currency)) amount = amount.slice(0, -currency.length).trim();
  }
  if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(amount)) amount = amount.replaceAll(",", "");
  // Comma decimals and locale-dependent dates require a human to resolve them.
  return /^[+-]?\d+(?:\.\d+)?$/.test(amount) ? amount : null;
}

export default function BillEvidence({ record }: { record: WorkspaceRecord }) {
  const values = receiptValues(record);
  const review = billReview(record);
  return <details className="max-h-[45dvh] shrink-0 overflow-auto border-b border-line bg-panel px-4 py-2 text-sm text-muted">
    <summary className="cursor-pointer font-medium text-body">Source evidence &amp; standardized values</summary>
    <p className="my-3 text-xs leading-5">The source text stays unchanged. The comparison shows your extracted or edited values and unambiguous standard forms; unresolved values stay unconfirmed.</p>
    {review.reasons.length > 0 && <div className="mb-3 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3"><h3 className="text-sm font-medium text-amber-200">Detailed review checks</h3><ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted">{review.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
    <div className="grid gap-3 pb-3 lg:grid-cols-2">
      <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full text-left text-sm"><thead className="bg-surface text-body"><tr><th className="p-2 font-medium">Field</th><th className="p-2 font-medium">Extracted / edited</th><th className="p-2 font-medium">Standard form</th></tr></thead><tbody>{["document_date", "currency", "subtotal", "tax", "total", "amount_paid", "balance_due"].map((key) => <tr key={key} className="border-t border-line"><th className="p-2 font-normal text-muted">{sessionColumnLabel(key)}</th><td className="p-2 text-body">{values[key] || "Missing"}</td><td className="p-2 text-body">{standardizedValue(key, values[key] || "") || "Unconfirmed"}</td></tr>)}</tbody></table></div>
      <div className="max-h-64 overflow-auto rounded-lg border border-line bg-background p-3"><h3 className="mb-2 text-xs font-medium text-subtle">Original OCR evidence · read-only</h3>{record.result?.pages.length ? record.result.pages.map((page) => <div key={page.page} className="mb-3"><p className="mb-1 text-xs text-subtle">Page {page.page}</p><pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-body">{page.text}</pre></div>) : <p className="text-sm text-muted">This older bill has no original OCR snapshot. Its saved source sheets remain available below.</p>}</div>
    </div>
  </details>;
}
