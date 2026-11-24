import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@/lib/server/embeddings/chunks";

export function embedTexts(texts: string[], task: "search_document" | "search_query" = "search_document", signal?: AbortSignal): Promise<number[][]> {
  if (!texts.length || texts.length > 128 || texts.some((text) => !text.trim() || Array.from(text).length > 2000)) {
    return Promise.reject(new Error("Invalid embedding input."));
  }
  const python = process.env.EMBEDDING_PYTHON_EXECUTABLE || process.env.PYTHON_EXECUTABLE;
  if (signal?.aborted) return Promise.reject(new Error("Embedding request cancelled."));
  if (!python) return Promise.reject(new Error("Configure PYTHON_EXECUTABLE for local embeddings."));
  return new Promise((resolve, reject) => {
    const child = spawn(path.resolve(/* turbopackIgnore: true */ process.cwd(), python),
      [path.join(process.cwd(), "python", "embed.py")], { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [];
    let size = 0;
    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      child.kill("SIGKILL");
      reject(new Error("Local embedding worker failed. Check the Python environment and downloaded Nomic model."));
    };
    const timer = setTimeout(fail, 180_000);
    signal?.addEventListener("abort", fail, { once: true });
    child.on("error", fail);
    child.stdin.on("error", fail);
    // Drain progress without logging private worker output.
    child.stderr.resume();
    child.stdout.on("data", (data: Buffer) => {
      size += data.length;
      if (size > 6 * 1024 * 1024) fail();
      else output.push(data);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", fail);
      if (failed) return;
      try {
        if (code !== 0) throw new Error();
        const result = JSON.parse(Buffer.concat(output).toString("utf8"));
        if (result.model !== EMBEDDING_MODEL || result.dimensions !== EMBEDDING_DIMENSIONS || result.inferenceMode !== "local"
          || !Array.isArray(result.vectors) || result.vectors.length !== texts.length
          || !result.vectors.every((vector: unknown) => Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS
            && vector.every((n) => typeof n === "number" && Number.isFinite(n)) && vector.some((n) => n !== 0))) throw new Error();
        resolve(result.vectors);
      } catch { fail(); }
    });
    child.stdin.end(JSON.stringify({ texts, task }));
  });
}
