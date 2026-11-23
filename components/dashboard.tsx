"use client";

import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import type { AuthUser } from "@/types/auth/user";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import PdfUpload, { type WorkspaceSnapshot } from "@/components/pdf-upload";
import ProfileMenu from "@/components/profile-menu";

type IconName = "workspace" | "help" | "close" | "signout";
function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, string> = {
    workspace: "M4 3h10l6 6v12H4zM14 3v6h6M8 13h8M8 17h5",
    help: "M9.2 8a3 3 0 0 1 5.6 1.5c0 2-2.8 2.2-2.8 4M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    close: "m6 6 12 12M6 18 18 6",
    signout: "M9 5H5v14h4M14 8l4 4-4 4M9 12h9",
  };
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

const statusLabels = { empty: "Ready when you are", ready: "File ready", processing: "Extracting…", checking: "Checking document type…", unsupported: "Unsupported document", complete: "Ready to review", error: "Check your file" };

function SignOutButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-line-strong bg-panel px-3 text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-50">
      <Icon name="signout" className="size-4" />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

export default function Dashboard({ user }: { user: AuthUser }) {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>({ status: "empty", fileName: null, result: null });
  const help = useRef<HTMLDialogElement>(null);
  const processing = workspace.status === "processing";
  const stage = workspace.status === "complete" ? 2 : workspace.fileName ? 1 : 0;

  return (
    <div className="app-shell h-dvh overflow-hidden bg-background text-foreground">
      <a href="#main-workspace" className="sr-only z-50 rounded-lg bg-accent p-3 text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to workspace</a>
      <aside aria-label="Workspace rail" className="fixed inset-y-0 left-0 z-30 hidden w-[72px] flex-col items-center border-r border-line bg-panel/70 py-5 backdrop-blur-xl md:flex">
        <Link href="/" aria-label="Paper to text home" className="neon-mark flex size-10 items-center justify-center rounded-2xl bg-accent font-mono text-lg font-bold tracking-tighter text-ink">p.</Link>
        <nav aria-label="Workspace navigation" className="mt-12 flex flex-1 flex-col items-center gap-3">
          <a href="#document-workspace" title="Document workspace" aria-label="Document workspace" aria-current="page" className="flex size-11 items-center justify-center rounded-2xl border border-accent/20 bg-accent-soft text-accent"><Icon name="workspace" /></a>
        </nav>
        <button type="button" title="Quick help" aria-label="Quick help" aria-haspopup="dialog" aria-controls="workspace-help" onClick={() => help.current?.showModal()} className="flex size-11 items-center justify-center rounded-2xl text-subtle hover:bg-surface hover:text-foreground"><Icon name="help" /></button>
      </aside>

      <div className="flex h-full min-w-0 flex-col md:pl-[72px]">
        <header className="sticky top-0 z-20 flex min-h-[68px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-background/90 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3"><Link href="/" className="whitespace-nowrap text-sm font-semibold tracking-tight text-foreground">paper<span className="mx-1 text-accent">/</span>text</Link><span className="hidden h-4 w-px bg-line sm:block" /><span className="hidden text-xs text-subtle sm:block">Workspace</span></div>
          <div className="flex max-w-full flex-wrap items-center gap-2 sm:gap-3">
            <span role="status" className="hidden items-center gap-2 text-xs text-muted xl:inline-flex"><span className={`size-1.5 rounded-full ${processing ? "animate-pulse bg-accent" : workspace.status === "error" ? "bg-muted" : "bg-accent"}`} />{statusLabels[workspace.status]}</span>
            <button type="button" aria-label="Quick help" aria-haspopup="dialog" aria-controls="workspace-help" onClick={() => help.current?.showModal()} className="rounded-xl p-2 text-muted hover:bg-surface md:hidden"><Icon name="help" className="size-[18px]" /></button>
            <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-line sm:block" />
            <ProfileMenu user={user} />
            <form action={signOut}><SignOutButton /></form>
          </div>
        </header>

        <main id="main-workspace" tabIndex={-1} className="flex min-h-0 w-full flex-1 flex-col overflow-hidden px-3 py-3 outline-none sm:px-4 lg:px-5">
          <section id="document-workspace" aria-labelledby="workspace-title" className="flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <div><h1 id="workspace-title" className="text-base font-semibold leading-tight tracking-tight">Document workspace</h1><p className="mt-1 text-xs text-muted">Upload, review, and manage your bills.</p></div>
              <ol aria-label="Extraction steps" className="hidden shrink-0 items-center gap-4 sm:flex">
                {["Upload", "Extract", "Review"].map((label, index) => <li key={label} aria-current={stage === index ? "step" : undefined} className={`flex items-center gap-1.5 text-[11px] font-medium ${stage === index ? "text-accent" : index < stage ? "text-muted" : "text-subtle"}`}><span className={index === stage ? "opacity-60" : "opacity-70"}>{index < stage ? "✓" : `0${index + 1}`}</span>{label}</li>)}
              </ol>
            </div>
            <PdfUpload onStateChange={setWorkspace} />
          </section>
        </main>
      </div>

      <dialog ref={help} id="workspace-help" aria-labelledby="help-title" className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-auto rounded-2xl border border-line-strong bg-panel p-6 text-foreground shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3"><h2 id="help-title" className="text-lg font-semibold">A little help.</h2><button type="button" aria-label="Close help" onClick={() => help.current?.close()} className="rounded-lg p-2 text-muted hover:bg-surface"><Icon name="close" className="size-4" /></button></div>
        <ol className="mt-5 space-y-5 text-sm leading-6 text-muted">{[{ title: "Add your file", text: "Drop a PDF or image into the upload box. Use Preview to inspect the selected file." }, { title: "Extract the text", text: "Select Extract text. Scanned pages and photos are recognized automatically." }, { title: "Make it yours", text: "Review the extracted fields and tables, correct values, and download TXT or JSON. Save before refreshing; edits stay in this tab." }].map((step, index) => <li key={step.title} className="flex items-start gap-3"><span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs text-accent">{index + 1}</span><div><h3 className="font-medium text-foreground">{step.title}</h3><p className="mt-1 text-xs leading-6">{step.text}</p></div></li>)}</ol>
        <p className="mt-6 border-t border-line pt-4 text-xs leading-6 text-subtle">PDF, PNG, JPG, WebP, BMP · 10 MB maximum.<br />Up to 20 PDF pages or a 20 MP image. Current OCR language: English.</p>
      </dialog>
    </div>
  );
}
