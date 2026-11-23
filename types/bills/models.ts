/** Canonical bill dataset. Unknown extracted values are null, never guessed zeros. */
export type BillReviewStatus = "Needs review" | "Reviewed";

export type BillRecord = {
  billId: string;
  ownerUserId: string;
  billNumber: string | null;
  billDate: string | null; // YYYY-MM-DD; ambiguous dates remain null.
  originalBillDate: string | null;
  vendorName: string | null;
  vendorTaxId: string | null;
  customerName: string | null;
  currency: string | null; // Three-letter currency code after review.
  subtotal: number | null;
  discountAmount: number | null;
  taxAmount: number | null;
  shippingAmount: number | null;
  totalAmount: number | null;
  amountPaid: number | null;
  balanceDue: number | null;
  paymentMethod: string | null;
  orderId?: string | null; // Optional on older saved records.
  shippingMethod?: string | null;
  reviewStatus: BillReviewStatus;
  notes: string | null;
  sourceFile: string;
  createdAt: string; // UTC ISO timestamp.
  updatedAt: string;
};

export type BillItemRecord = {
  itemId: string;
  billId: string;
  itemNumber: number; // Positive integer, unique within a bill.
  description: string | null;
  productCode: string | null;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  discountAmount: number | null;
  discountRate: number | null; // Percentage points, e.g. 5 means 5%.
  taxRate: number | null;
  taxAmount: number | null;
  lineTotal: number | null;
  sourcePage: number | null;
  reviewStatus: BillReviewStatus;
  notes: string | null;
};

export type BillDataset = {
  schemaVersion: 1;
  bills: BillRecord[];
  items: BillItemRecord[];
};
