"use client";

import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import type { AuthUser } from "@/types/auth/user";
import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { useWorkspaceScroll } from "@/components/workspace-provider";
import PdfUpload from "@/components/pdf-upload";
import ProfileMenu from "@/components/profile-menu";
import DocumentChat from "@/components/document-chat";
import EmbeddingDemo from "@/components/embedding-demo";

type IconName = "help" | "close" | "signout";
function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, string> = {
    help: "M9.2 8a3 3 0 0 1 5.6 1.5c0 2-2.8 2.2-2.8 4M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    close: "m6 6 12 12M6 18 18 6",
    signout: "M9 5H5v14h4M14 8l4 4-4 4M9 12h9",
  };
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

function SignOutButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-wait disabled:opacity-50">
      <Icon name="signout" className="size-4" />
      <span className="sr-only sm:not-sr-only">{pending ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}

export default function Dashboard({ user }: { user: AuthUser }) {
  const help = useRef<HTMLDialogElement>(null);
  const workspace = useRef<HTMLElement>(null);
  useWorkspaceScroll(workspace, "dashboard");

  return (
    <div className="app-shell h-dvh overflow-hidden bg-background text-foreground">
      <a href="#main-workspace" className="sr-only z-50 rounded-lg bg-accent p-3 text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to workspace</a>
      <div className="flex h-full min-w-0 flex-col">
        <header className="z-20 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-panel/70 px-4 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" aria-label="Paper to text home" className="flex items-center gap-2.5 whitespace-nowrap text-sm font-semibold tracking-tight"><span className="flex size-8 items-center justify-center rounded-lg bg-accent font-mono text-lg font-bold text-ink">p.</span><span className="hidden sm:inline">paper<span className="mx-1 text-accent">/</span>text</span></Link>
            <span aria-hidden="true" className="h-5 w-px bg-line" />
            <h1 id="workspace-title" className="text-sm font-medium text-body"><span className="sm:hidden">Workspace</span><span className="hidden sm:inline">Document workspace</span></h1>
          </div>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <EmbeddingDemo />
            <a href="/templates/bills-template.xlsx" download className="hidden min-h-9 items-center gap-2 rounded-lg px-2.5 text-sm text-muted hover:bg-surface hover:text-foreground lg:inline-flex"><svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 3h16v18H4zM4 9h16M10 9v12M4 15h16" /></svg>Excel template</a>
            <button type="button" title="Quick help" aria-label="Quick help" aria-haspopup="dialog" aria-controls="workspace-help" onClick={() => help.current?.showModal()} className="rounded-lg p-2 text-muted hover:bg-surface hover:text-foreground"><Icon name="help" className="size-[18px]" /></button>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
            <ProfileMenu user={user} />
            <form action={signOut}><SignOutButton /></form>
          </div>
        </header>

        <main ref={workspace} id="main-workspace" tabIndex={-1} className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto p-3 outline-none sm:p-4 lg:overflow-hidden">
          <section id="document-workspace" aria-labelledby="workspace-title" className="flex min-h-[1000px] flex-1 flex-col sm:min-h-[680px] lg:min-h-0">
            <PdfUpload />
          </section>
        </main>
      </div>

      <dialog ref={help} id="workspace-help" aria-labelledby="help-title" className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-auto rounded-2xl border border-line-strong bg-panel p-6 text-foreground shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3"><h2 id="help-title" className="text-lg font-semibold">A little help.</h2><button type="button" aria-label="Close help" onClick={() => help.current?.close()} className="rounded-lg p-2 text-muted hover:bg-surface"><Icon name="close" className="size-4" /></button></div>
        <ol className="mt-5 space-y-5 text-sm leading-6 text-muted">{[{ title: "Add your file", text: "Drop a PDF or image into the Upload card. Use Preview to inspect the selected file." }, { title: "Extract the text", text: "Select Extract text. Scanned pages and photos are recognized automatically." }, { title: "Review and export", text: "Open Review to browse saved files and inspect their OCR and AI output. Use All bills for the combined workbook. Use Bills, Bill Items, and Needs review to check your data, then export Excel or CSV. Export corrections before refreshing; edits stay in this tab." }].map((step, index) => <li key={step.title} className="flex items-start gap-3"><span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs text-accent">{index + 1}</span><div><h3 className="font-medium text-foreground">{step.title}</h3><p className="mt-1 text-sm leading-6">{step.text}</p></div></li>)}</ol>
        <a href="/templates/bills-template.xlsx" download className="mt-5 inline-flex rounded-lg border border-line-strong px-3 py-2 text-sm text-body hover:bg-surface">Download Excel template</a>
        <p className="mt-6 border-t border-line pt-4 text-xs leading-6 text-subtle">PDF, PNG, JPG, WebP, BMP · 10 MB maximum.<br />Up to 20 PDF pages or a 20 MP image. Current OCR language: English.</p>
      </dialog>
      <DocumentChat userName={user.name} />
    </div>
  );
}
