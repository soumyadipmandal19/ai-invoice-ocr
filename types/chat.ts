export type ChatHistoryMessage = { role: "user" | "assistant"; content: string };
export type ChatSource = {
  id: string;
  billId: string;
  billNumber?: string | null;
  chunkId: string;
  fileName: string;
  page: number;
  text: string;
  score: number;
};
export type ChatIndexing = { totalBills: number; readyBills: number };
export type ChatDocument = { billId: string; fileName: string; billNumber: string | null };
export type ChatResponse = {
  contextBillId?: string | null;
  answer: string;
  sources: ChatSource[];
  model: string | null;
  indexing: ChatIndexing;
};
