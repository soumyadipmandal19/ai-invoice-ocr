// Use the runtime's currency registry rather than a dollar-only allowlist.
const codes = new Set(Intl.supportedValuesOf("currency"));
const symbols = new Map<string, Set<string>>();
for (const code of codes) {
  for (const display of ["symbol", "narrowSymbol"] as const) {
    const symbol = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: display })
      .formatToParts(1).find((part) => part.type === "currency")!.value;
    if (!symbols.has(symbol)) symbols.set(symbol, new Set());
    symbols.get(symbol)!.add(code);
  }
}
// Qualified dollar symbols are not consistently exposed by Intl in English.
for (const [symbol, code] of Object.entries({ "US$": "USD", "CA$": "CAD", "C$": "CAD", "AU$": "AUD", "A$": "AUD", "NZ$": "NZD", "HK$": "HKD", "SG$": "SGD", "S$": "SGD", "NT$": "TWD", "R$": "BRL" })) {
  symbols.set(symbol, new Set([code]));
}
// Rs/Rs. are shared by rupee currencies, including INR even though Intl
// displays INR as ₹. They can agree with ₹ but cannot identify INR alone.
const rupees = new Set([...(symbols.get("Rs") || []), "INR", "NPR", "PKR", "LKR", "MUR", "SCR"]);
symbols.set("Rs", rupees);
symbols.set("Rs.", rupees);

function isCurrencyIndicator(value: string | undefined): value is string {
  return !!value && (codes.has(value.trim().toUpperCase()) || symbols.has(value.trim()) || /^\p{Sc}$/u.test(value.trim()));
}

/** Ambiguous symbols such as $ and ¥ deliberately have no unique code. */
export function currencyCode(value: string | undefined): string | null {
  if (!value) return null;
  const token = value.trim();
  if (codes.has(token.toUpperCase())) return token.toUpperCase();
  const candidates = symbols.get(token);
  return candidates?.size === 1 ? [...candidates][0] : null;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Include textual symbols such as kr, zł and Rs as well as Unicode currency signs.
const namedSymbols = [...symbols.keys()].filter((symbol) => !codes.has(symbol)).sort((a, b) => b.length - a.length);
const token = `(?:${namedSymbols.map(escape).join("|")}|\\p{Sc}|\\b(?:${[...codes].join("|")})\\b)`;
const amount = "[+−-]?\\s*\\d+(?:[.,\\u00a0 ]\\d+)*";

/** Extract only monetary evidence, excluding currency-like words in names/SKUs. */
export function priceCurrencies(text: string): string[] {
  const found = new Set<string>();
  // Do not join lines: a currency on one row must not attach to another row's number.
  for (const line of text.split(/\r?\n/)) {
    const prices = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:(${token})\\s*${amount}|${amount}\\s*(${token}))(?![\\p{L}\\p{N}_-])`, "gu");
    for (const match of line.matchAll(prices)) {
      const currency = match[1] || match[2];
      // Single Latin letters occur in OCR noise, page labels and advertisements.
      // An isolated "P 3" is not enough evidence for Botswana pula.
      if (/^[A-Za-z]$/.test(currency) && !/\d[.,]\d{2}\b/.test(match[0])
        && !/\b(?:currency|price|total|amount|balance|subtotal|tax|paid|cost|charges?)\b/i.test(line)) continue;
      found.add(currency);
    }
    const label = new RegExp(`(?:\\bcurrency\\s*[:=]?\\s*|\\b(?:amounts?|prices?|total|balance|unit price)\\s*(?:in\\s+|\\(\\s*))(${token})`, "giu");
    for (const match of line.matchAll(label)) found.add(match[1]);
  }
  return [...found];
}

function resolve(tokens: string[]): { value?: string; conflict?: boolean } {
  if (!tokens.length) return {};
  const explicit = [...new Set(tokens.map(currencyCode).filter((code): code is string => !!code))];
  if (explicit.length > 1) return { conflict: true };
  if (explicit.length === 1) {
    const code = explicit[0];
    if (tokens.every((token) => currencyCode(token) === code || symbols.get(token)?.has(code))) return { value: code };
    return { conflict: true };
  }
  const unique = [...new Set(tokens)];
  return unique.length === 1 ? { value: unique[0] } : { conflict: true };
}

/** Reconcile after chunk merging, so a currency header can inform later pages. */
export function reconcileFinancialCurrencies(
  receipt: Record<string, string>, items: Record<string, string>[], sourceText: string,
) {
  const warnings: string[] = [];
  const evidence = priceCurrencies(sourceText);
  const mapped = isCurrencyIndicator(receipt.currency) ? receipt.currency : undefined;
  // Existing mappings have already passed literal OCR citation validation.
  const result = resolve([...evidence, ...(mapped ? [mapped] : [])]);
  const updatedReceipt = { ...receipt };
  if (receipt.currency && !mapped) {
    delete updatedReceipt.currency;
    warnings.push("The model's currency value was not a supported currency indicator and was omitted.");
  }
  if (result.conflict) {
    delete updatedReceipt.currency;
    warnings.push("Conflicting currencies were found in the document; bill currency was left blank. Review the printed prices and currency labels.");
  } else if (result.value) {
    updatedReceipt.currency = result.value;
    if (!currencyCode(result.value)) warnings.push(`Currency symbol ${result.value} was detected; the exact currency code is unconfirmed.`);
  }
  const updatedItems = items.map((item) => {
    const local = resolve([
      ...["unit_price", "line_total", "tax", "discount"].flatMap((key) => priceCurrencies(item[key] || "")),
      ...(isCurrencyIndicator(item.currency) ? [item.currency] : []),
    ]);
    const updated = { ...item };
    if (item.currency && !isCurrencyIndicator(item.currency)) delete updated.currency;
    if (local.conflict) {
      // An empty value also prevents workbook inheritance of a bill currency.
      updated.currency = "";
      warnings.push("Conflicting currencies were found in an item's prices; its currency was left blank.");
    } else if (local.value) {
      const combined = resolve([local.value, ...(result.value ? [result.value] : [])]);
      updated.currency = combined.value || local.value;
    } else if (result.value) updated.currency = result.value;
    return updated;
  });
  return { receipt: updatedReceipt, items: updatedItems, warnings };
}
