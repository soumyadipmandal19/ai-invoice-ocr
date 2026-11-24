"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useWorkspaceState } from "@/components/workspace-provider";
import WorkspaceRecordReview from "@/components/workspace-record-review";
import { mergeSavedBills } from "@/lib/bills/history";
import type { Classification } from "@/lib/classification/document";
import type { ExtractionResult } from "@/types/extraction/result";
import type { FinancialWorkbook } from "@/lib/financial/workbook";
import type { WorkspaceRecord } from "@/types/workspace/record";

type SavedOutputs = { billId: string; sourceFile: string; createdAt: string; ocr: ExtractionResult | null;
  workbook: FinancialWorkbook | null; llm: { classification?: Classification } | null };

export default function DocumentDetail({ saved }: { saved: SavedOutputs }) {
  const router = useRouter();
  const [record, setRecord] = useWorkspaceState("record", () => mergeSavedBills([], [{ billId: saved.billId, sourceFile: saved.sourceFile,
    createdAt: saved.createdAt, ocr: saved.ocr, workbook: saved.workbook, classification: saved.llm?.classification || null }])[0]);
  const [view, setView] = useWorkspaceState("view", "review");
  const patch = useCallback((_id: string, values: Partial<WorkspaceRecord>) => setRecord((current) => ({ ...current, ...values })), [setRecord]);
  return <main className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-panel px-5 py-4"><Link href="/workspace/documents" className="text-sm text-muted hover:text-accent">← All bills</Link><span className="h-4 w-px bg-line" /><h1 className="min-w-0 flex-1 truncate text-sm font-semibold" title={saved.sourceFile}>{saved.sourceFile}</h1><Link href="/workspace/dashboard" className="text-xs text-subtle hover:text-accent">Dashboard</Link></header>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2" role="tablist" aria-label="Document data">{[{ id: "review", name: "Bill & OCR" }, { id: "ocr", name: "Original OCR JSON" }, { id: "ai", name: "AI output" }].map((tab) => <button key={tab.id} id={`document-${tab.id}`} type="button" role="tab" aria-selected={view === tab.id} aria-controls="document-data-panel" onClick={() => setView(tab.id)} className={`rounded-lg px-3 py-2 text-xs ${view === tab.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface"}`}>{tab.name}</button>)}</div>
    <section id="document-data-panel" role="tabpanel" aria-labelledby={`document-${view}`} className="flex min-h-0 flex-1 flex-col overflow-auto">{view === "review" ? <WorkspaceRecordReview record={record} onPatch={patch} onChooseAnother={() => router.push("/workspace/dashboard")} /> : <pre className="m-4 overflow-auto rounded-xl border border-line bg-panel p-5 font-mono text-xs leading-6 whitespace-pre-wrap break-words text-body">{JSON.stringify(view === "ocr" ? saved.ocr : saved.llm, null, 2) || "No saved output available."}</pre>}</section>
    <p className="shrink-0 border-t border-line px-5 py-2 text-[11px] text-subtle">Saved OCR and extracted data. Edits stay in this tab during navigation; export before refreshing.</p>
  </main>;
}
