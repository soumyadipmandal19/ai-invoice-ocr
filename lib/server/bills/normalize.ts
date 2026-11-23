import "server-only";

import type { Classification } from "@/lib/classification";
import type { FinancialWorkbook } from "@/lib/financial-workbook";
import type { BillNode, BillItemNode } from "@/lib/server/database/schema";

/** Retain all original mapped values, including numbers/dates we cannot normalize safely. */
export function normalizeBill(jobId: string, ownerUserId: string, workbook: FinancialWorkbook, classification: Classification) {
  const receipt = workbook.sheets.find((sheet) => sheet.id === "receipts");
  const products = workbook.sheets.find((sheet) => sheet.id === "items");
  if (workbook.schemaVersion !== 2 || !receipt || receipt.rows.length !== 1 || !products || !classification.isFinancialDocument) {
    throw new Error("A completed version 2 financial workbook is required.");
  }
  const fields = (columns: string[], cells: string[]) => Object.fromEntries(columns.map((column, index) => [column, cells[index]?.trim() || ""]));
  const values = fields(receipt.columns, receipt.rows[0]);
  const warnings: string[] = [];
  const text = (value: string | undefined) => value?.trim() || null;
  function number(value: string | undefined, field: string, rate = false) {
    const raw = value?.trim() || "";
    if (!raw) return null;
    const candidate = rate ? raw.replace(/%$/, "").trim() : raw;
    const parsed = Number(candidate);
    if (!/^-?\d+(?:\.\d+)?$/.test(candidate) || !Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER || candidate.replace(/[^0-9]/g, "").replace(/^0+/, "").length > 15) {
      warnings.push(`${field}: original value needs numeric review.`);
      return null;
    }
    return parsed;
  }
  const rawDate = text(values.document_date);
  const parsedDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00.000Z`) : null;
  const billDate = parsedDate && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === rawDate ? rawDate : null;
  if (rawDate && !billDate) warnings.push("Bill date: original date needs review; no date order was guessed.");
  const rawCurrency = values.currency?.trim().toUpperCase();
  const currency = rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null;
  if (rawCurrency && !currency) warnings.push("Currency: original value needs a three-letter code.");
  const now = new Date().toISOString();
  const bill: BillNode = {
    billId: jobId, ownerUserId, jobId, documentType: classification.documentType,
    billNumber: text(values.document_number), orderId: text(values.order_id), shippingMethod: text(values.shipping_method), billDate, originalBillDate: rawDate,
    vendorName: text(values.merchant_name), vendorTaxId: text(values.merchant_tax_id), customerName: text(values.customer_name), currency,
    subtotal: number(values.subtotal, "Subtotal"), discountAmount: number(values.discount, "Discount"),
    taxAmount: number(values.tax, "Tax"), shippingAmount: number(values.shipping, "Shipping"),
    totalAmount: number(values.total, "Total"), amountPaid: number(values.amount_paid, "Paid"), balanceDue: number(values.balance_due, "Balance"),
    paymentMethod: text(values.payment_method), reviewStatus: "Needs review", notes: text(values.notes),
    sourceFile: values.source_file || "", createdAt: now, updatedAt: now,
    workbookJson: JSON.stringify(workbook), classificationJson: JSON.stringify(classification), normalizationWarnings: warnings,
  };
  const items: BillItemNode[] = products.rows.map((row, index) => {
    const item = fields(products.columns, row);
    const label = `Item ${index + 1}`;
    const itemCurrency = item.currency?.trim().toUpperCase();
    const normalizedCurrency = itemCurrency ? /^[A-Z]{3}$/.test(itemCurrency) ? itemCurrency : null : currency;
    if (itemCurrency && normalizedCurrency !== currency) warnings.push(`${label}: currency differs from the bill or needs review; original value retained.`);
    const page = number(item.source_page, `${label} page`);
    if (page !== null && (!Number.isInteger(page) || page < 1)) warnings.push(`${label}: original source page needs review.`);
    return {
      itemId: `${jobId}:${index + 1}`, billId: jobId, itemNumber: index + 1, currency: normalizedCurrency,
      description: text(item.product_name), productCode: text(item.product_code), category: text(item.category),
      quantity: number(item.quantity, `${label} quantity`), unit: text(item.unit), unitPrice: number(item.unit_price, `${label} price`),
      discountAmount: number(item.discount, `${label} discount`), discountRate: number(item.discount_rate, `${label} discount rate`, true),
      taxRate: number(item.tax_rate, `${label} tax rate`, true), taxAmount: number(item.tax, `${label} tax`), lineTotal: number(item.line_total, `${label} total`),
      sourcePage: page !== null && Number.isInteger(page) && page >= 1 ? page : null, reviewStatus: "Needs review", notes: text(item.notes),
    };
  });
  return { bill, items };
}
