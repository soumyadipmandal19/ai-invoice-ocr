import "server-only";

import { createHash } from "node:crypto";
import type { ExtractionResult } from "@/types/extraction/result";

export const EMBEDDING_MODEL = "nomic-embed-text-v1.5";
export const EMBEDDING_DIMENSIONS = 768;
// Change this when the model, task, dimensions, or chunking rules change.
export const EMBEDDING_PROFILE = "nomic-v1.5-768-page1000-overlap120-v1";
export type TextChunk = { chunkId: string; page: number; position: number; text: string; textHash: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function chunkDocument(billId: string, document: Pick<ExtractionResult, "pages">) {
  const chunks: TextChunk[] = [];
  for (const page of document.pages) {
    const characters = Array.from(page.text);
    for (let start = 0; start < characters.length; start += 880) {
      const text = characters.slice(start, start + 1000).join("").trim();
      if (text) {
        chunks.push({ chunkId: `${billId}:${page.page}:${start}`, page: page.page,
          position: start, text, textHash: hash(text) });
        if (chunks.length > 128) throw new Error("Document exceeds the 128-chunk embedding limit. Split it into smaller documents.");
      }
      if (start + 1000 >= characters.length) break;
    }
  }
  return { chunks, fingerprint: hash(JSON.stringify([EMBEDDING_PROFILE, chunks])) };
}
