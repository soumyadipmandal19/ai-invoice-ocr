export type DocumentFile = {
  billId: string;
  fileName: string;
  documentType: string;
  billNumber: string | null;
  createdAt: string;
  pageCount: number;
};
export type DocumentFilesPage = { files: DocumentFile[]; nextOffset: number | null; folders: { type: string; count: number }[] };
