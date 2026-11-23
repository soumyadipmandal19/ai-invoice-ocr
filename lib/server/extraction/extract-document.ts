import "server-only";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { isExtractionResult } from "@/types/extraction/result";

const execFileAsync = promisify(execFile);

export class ExtractionError extends Error {
  constructor(message: string, public status = 422) {
    super(message);
  }
}

export async function extractDocument(filePath: string, forceOcr: boolean, signal: AbortSignal) {
  const configuredPython = process.env.PYTHON_EXECUTABLE;
  if (!configuredPython) {
    throw new ExtractionError("Configure PYTHON_EXECUTABLE on the server before extracting documents.", 500);
  }
  // Resolve the host's interpreter at runtime; it must not become a bundled asset.
  const executable = path.resolve(/* turbopackIgnore: true */ process.cwd(), configuredPython);
  const args = [path.join(process.cwd(), "python", "extract.py"), filePath];
  if (forceOcr) args.push("--force-ocr");

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(executable, args, {
      encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL",
      maxBuffer: 12 * 1024 * 1024, signal,
    }));
  } catch (error) {
    if (typeof error === "object" && error !== null && "killed" in error && error.killed) {
      throw new ExtractionError("Processing timed out. Try a smaller document.", 504);
    }
    // Avoid logging PDF text or exposing process paths to the browser.
    console.error("Document worker failed:", error instanceof Error ? error.name : "Unknown error");
    throw new ExtractionError("The Document processor is unavailable. Check the server's Python and OCR setup.", 500);
  }

  const data: unknown = JSON.parse(stdout);
  if (typeof data === "object" && data !== null && "error" in data) {
    const error = data.error;
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
      throw new ExtractionError(error.message);
    }
  }
  if (!isExtractionResult(data)) throw new Error("Invalid Document worker response");
  return data;
}
