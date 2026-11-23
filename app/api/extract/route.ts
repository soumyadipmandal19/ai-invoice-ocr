import { getUser } from "@/lib/server/auth/session";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ExtractionError, extractDocument } from "@/lib/server/extraction/extract-document";
import { queueClassification } from "@/lib/server/classification/queue";
import { MAX_UPLOAD_BYTES, SUPPORTED_FILE_EXTENSIONS } from "@/types/extraction/result";

let activeJobs = 0;
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 128 * 1024;

function detectFileType(content: Buffer) {
  if (content.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return "pdf";
  if (content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (content[0] === 255 && content[1] === 216 && content[2] === 255) return "jpg";
  if (content.subarray(0, 4).toString() === "RIFF" && content.subarray(8, 12).toString() === "WEBP") return "webp";
  if (content.subarray(0, 2).toString() === "BM") return "bmp";
  return null;
}

// Bound the body even when a client omits Content-Length.
async function readForm(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("multipart/form-data;")) {
    throw new ExtractionError("Upload a PDF or image using the file picker.", 400);
  }
  if (!request.body) throw new ExtractionError("Choose a PDF or image to upload.", 400);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new ExtractionError("Choose a file smaller than 10 MB.", 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new ExtractionError("The upload could not be read. Please select the file again.", 400);
  }
}

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  // A per-process limit for this initial synchronous implementation.
  if (activeJobs >= 2) {
    return Response.json({ error: "The processor is busy. Please try again shortly." }, { status: 429 });
  }
  activeJobs++;
  let directory: string | undefined;
  try {
    const form = await readForm(request);
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ExtractionError("Choose a PDF or image file.", 400);
    }
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!SUPPORTED_FILE_EXTENSIONS.includes(extension)) throw new ExtractionError("Choose a PDF, PNG, JPG, WebP, or BMP file.", 400);
    if (!file.size) throw new ExtractionError("This file is empty.", 400);
    if (file.size > MAX_UPLOAD_BYTES) throw new ExtractionError("Choose a file smaller than 10 MB.", 413);
    const content = Buffer.from(await file.arrayBuffer());
    const detectedType = detectFileType(content);
    if (!detectedType || detectedType !== (extension === "jpeg" ? "jpg" : extension)) {
      throw new ExtractionError("The file content does not match its type. Choose a valid PDF or image.", 400);
    }
    directory = await mkdtemp(path.join(tmpdir(), "ocr-upload-"));
    const filePath = path.join(directory, `document.${detectedType}`);
    await writeFile(filePath, content, { mode: 0o600 });
    const result = await extractDocument(filePath, form.get("forceOcr") === "true", request.signal);
    const document = { ...result, sourceFileName: file.name };
    const classification = await queueClassification(document, user.id);
    return Response.json({ ...document, classification }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ExtractionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Document extraction request failed:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Extraction failed. Please try again." }, { status: 500 });
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      activeJobs--;
    }
  }
}
