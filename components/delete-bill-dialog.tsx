"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { WorkspaceRecord } from "@/types/workspace/record";

export default function DeleteBillDialog({ record, onDeleted, onCancel }: {
  record: WorkspaceRecord;
  onDeleted: (id: string) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const deleting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);

  function cancel() {
    if (deleting.current) return;
    dialog.current?.close();
    onCancel();
  }

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const billId = record.job?.persistence?.billId;
    if (!billId || deleting.current) return;
    deleting.current = true;
    setPending(true);
    setError("");
    let deleted = false;
    try {
      const response = await fetch(`/api/bills/${encodeURIComponent(billId)}`, {
        method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE" }),
      });
      const data: { success?: boolean; error?: string } | null = await response.json().catch(() => null);
      if (!response.ok || data?.success !== true) {
        setError(typeof data?.error === "string" ? data.error : "Unable to delete this bill. Please retry.");
        return;
      }
      deleted = true;
      dialog.current?.close();
      onDeleted(record.id);
    } catch {
      setError("Unable to reach the server. Check your connection and retry.");
    } finally {
      if (!deleted) { deleting.current = false; setPending(false); }
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="delete-bill-title" aria-describedby="delete-bill-description" onCancel={(event) => { event.preventDefault(); cancel(); }} className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-auto rounded-2xl border border-line-strong bg-panel p-6 text-foreground shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm">
      <h2 id="delete-bill-title" className="text-lg font-semibold">Delete this bill?</h2>
      <p className="mt-3 break-words text-sm font-medium text-foreground">#{record.index} · {record.fileName}</p>
      <p id="delete-bill-description" className="mt-3 text-sm leading-6 text-muted">This permanently deletes the bill, all its items, and its original OCR and AI results. This action cannot be undone.</p>
      <form onSubmit={remove} aria-busy={pending}>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-3 text-sm text-red-200">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" autoFocus disabled={pending} onClick={cancel} className="rounded-xl border border-line-strong px-4 py-2.5 text-sm font-medium hover:bg-surface disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={pending} className="rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-wait disabled:opacity-50">{pending ? "Deleting…" : "Delete bill"}</button>
        </div>
      </form>
    </dialog>
  );
}
