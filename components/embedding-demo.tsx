"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type EmbeddingOutput = { model: string; dimensions: number; inferenceMode: string; vector: number[] };
const sample = "Payment is due within 30 days.";

export default function EmbeddingDemo() {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [text, setText] = useState(sample);
  const [output, setOutput] = useState<EmbeddingOutput | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => pending.current?.abort(), []);

  function clear() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setOutput(null);
    setError("");
    setText(sample);
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setOutput(null);
    setError("");
    try {
      const response = await fetch("/api/embeddings/demo", {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to generate an embedding.");
      if (!controller.signal.aborted) setOutput(result);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to generate an embedding.");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-controls="embedding-demo" onClick={() => dialog.current?.showModal()}
        className="inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-line-strong px-2.5 text-xs font-medium text-body transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent sm:text-sm">
        <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18" /></svg>
        Embedding demo
      </button>
      <dialog ref={dialog} id="embedding-demo" aria-labelledby="embedding-demo-title" onClose={clear}
        className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-auto rounded-2xl border border-line-strong bg-panel p-5 text-foreground shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="embedding-demo-title" className="text-lg font-semibold">Try a local embedding</h2>
            <p className="mt-1 text-sm leading-6 text-muted">Turn a short piece of text into a vector of 768 numbers.</p></div>
          <button type="button" aria-label="Close embedding demo" onClick={() => dialog.current?.close()}
            className="rounded-lg p-2 text-muted hover:bg-surface hover:text-foreground">
            <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </div>
        <form onSubmit={generate} autoComplete="off" className="mt-5">
          <label htmlFor="embedding-demo-text" className="text-sm font-medium text-body">Text to embed</label>
          <textarea id="embedding-demo-text" autoFocus rows={4} maxLength={1000} value={text} disabled={busy}
            onChange={(event) => { setText(event.target.value); setOutput(null); setError(""); }}
            aria-describedby="embedding-demo-privacy" placeholder="Enter a sentence or short paragraph…"
            className="mt-2 block w-full resize-y rounded-xl border border-line-strong bg-background p-3 text-base leading-6 text-foreground placeholder:text-subtle disabled:opacity-60 sm:text-sm" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-subtle">{Array.from(text).length} / 1,000 characters</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={clear} className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface hover:text-foreground">Reset</button>
              <button type="submit" disabled={busy || !text.trim()} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-hover disabled:cursor-wait disabled:opacity-50">
                {busy && <span aria-hidden="true" className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                {busy ? "Generating…" : "Generate embedding"}
              </button>
            </div>
          </div>
        </form>
        <p id="embedding-demo-privacy" className="mt-4 rounded-lg border border-line bg-surface/50 px-3 py-2 text-xs leading-5 text-muted">Demo only. Your text and vector stay in memory and are cleared when you close this dialog. Nothing is saved to the database or files.</p>
        <div aria-live="polite" aria-busy={busy}>
          {error && <p role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">{error}</p>}
          {busy && <p className="mt-4 text-sm text-muted">Running Nomic locally. The first request may take a moment to load the model.</p>}
          {output && <section aria-labelledby="embedding-demo-output" className="mt-5 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="embedding-demo-output" className="text-sm font-semibold">Embedding output</h3><span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent">Local · {output.dimensions} dimensions</span></div>
            <p className="mt-2 text-xs text-muted">Model: <span className="font-mono text-body">{output.model}</span></p>
            <pre tabIndex={0} aria-label="Full embedding vector as JSON" className="mt-3 max-h-72 overflow-auto rounded-xl border border-line bg-background p-4 font-mono text-xs leading-5 text-body">{JSON.stringify(output, null, 2)}</pre>
          </section>}
        </div>
      </dialog>
    </>
  );
}
