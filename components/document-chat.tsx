"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatResponse, ChatSource } from "@/types/chat";
import ChatAnswer from "@/components/chat-answer";

type Message = { id: number; role: "user" | "assistant"; text: string; sources?: ChatSource[] };
type IconName = "chat" | "close" | "send" | "new" | "document" | "user";

function ChatIcon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, string> = {
    chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0ZM7 9h10M7 13h6",
    close: "m6 6 12 12M6 18 18 6",
    send: "M12 19V5m-6 6 6-6 6 6",
    new: "M12 5v14M5 12h14",
    document: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8M8 17h5",
    user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
  };
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

function DocumentSources({ sources }: { sources: ChatSource[] }) {
  const pages = new Map<string, { fileName: string; page: number; excerpts: string[] }>();
  for (const source of sources) {
    const key = `${source.billId}:${source.page}`;
    const page = pages.get(key) || { fileName: source.fileName, page: source.page, excerpts: [] };
    if (!page.excerpts.includes(source.text)) page.excerpts.push(source.text);
    pages.set(key, page);
  }
  return <div className="mt-3 space-y-2 border-t border-line pt-3" aria-label="Answer sources">{[...pages].map(([key, page]) => <details key={key} className="rounded-lg border border-line bg-background/50 px-2.5 py-2"><summary className="cursor-pointer text-xs text-accent">{page.fileName} · Page {page.page}</summary><div className="mt-2 space-y-2">{page.excerpts.map((text, index) => <p key={index} className="text-xs leading-5 whitespace-pre-wrap text-muted">{text}</p>)}</div></details>)}</div>;
}

export default function DocumentChat({ userName }: { userName: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [indexing, setIndexing] = useState<ChatResponse["indexing"] | null>(null);
  const conversationDocument = useRef<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);

  useEffect(() => { if (open && !busy) input.current?.focus(); }, [open, busy]);
  useEffect(() => {
    if (open && messageList.current) {
      messageList.current.scrollTop = messages.length ? messageList.current.scrollHeight : 0;
    }
  }, [messages, open, busy, error]);
  useEffect(() => () => pending.current?.abort(), []);

  function close() {
    setOpen(false);
    launcher.current?.focus();
  }

  function reset() {
    pending.current?.abort();
    pending.current = null;
    conversationDocument.current = null;
    setBusy(false); setMessages([]); setDraft(""); setError(""); setIndexing(null);
    input.current?.focus();
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const userMessage: Message = { id: nextId.current++, role: "user", text };
    const history = messages.slice(-4).map((message) => ({ role: message.role, content: Array.from(message.text).slice(0, 1000).join("") }));
    // Respect the endpoint's body limit even with multibyte text.
    while (history.length && new TextEncoder().encode(JSON.stringify({ question: text, history, contextBillId: conversationDocument.current })).length > 8000) history.shift();
    const controller = new AbortController();
    pending.current = controller;
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setError(""); setBusy(true);
    input.current?.focus();
    try {
      const response = await fetch("/api/chat", { method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, history, contextBillId: conversationDocument.current }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to answer. Please try again.");
      if (pending.current !== controller || controller.signal.aborted) return;
      const answer = result as ChatResponse;
      const reply: Message = { id: nextId.current++, role: "assistant", text: answer.answer, sources: answer.sources };
      setMessages((current) => [...current, reply]);
      setIndexing(answer.indexing);
      conversationDocument.current = answer.contextBillId ?? null;
    } catch (error) {
      if (pending.current === controller && !controller.signal.aborted) {
        setError(error instanceof Error ? error.message : "Unable to answer. Please try again.");
        setMessages((current) => current.filter((message) => message.id !== userMessage.id));
        setDraft(text);
      }
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return (
    <>
      {open && (
        <section id="document-chat" role="dialog" aria-modal="false" aria-labelledby="document-chat-title" onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.stopPropagation(); close(); }
        }} className="document-chat-panel fixed right-3 bottom-[calc(5.25rem_+_env(safe-area-inset-bottom))] z-40 flex h-[560px] max-h-[calc(100dvh_-_7rem_-_env(safe-area-inset-bottom))] w-[calc(100vw_-_1.5rem)] max-w-[370px] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel bg-[radial-gradient(ellipse_at_bottom_right,var(--accent-soft),transparent_75%)] text-foreground shadow-[0_20px_80px_#0009] sm:right-6 sm:bottom-[calc(6rem_+_env(safe-area-inset-bottom))]">
          <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-ink"><ChatIcon name="chat" className="size-4" /></span>
            <div className="min-w-0 flex-1"><h2 id="document-chat-title" className="text-[13px] font-semibold">Document assistant</h2><p className="mt-0.5 text-[10px] text-subtle">Here to help with your bills</p></div>
            <button type="button" title="New chat" aria-label="New chat" disabled={!messages.length && !draft && !error} onClick={reset} className="rounded-full p-1.5 text-subtle transition-colors hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-30"><ChatIcon name="new" className="size-4" /></button>
            <button type="button" title="Close chat" aria-label="Close chat" onClick={close} className="flex size-7 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80"><ChatIcon name="close" className="size-3.5" /></button>
          </header>

          <div ref={messageList} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-transparent px-3.5 py-5">
            {messages.length === 0 ? (
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><ChatIcon name="chat" className="size-3.5" /></span>
                <div className="min-w-0 max-w-[85%]"><p className="mb-1.5 text-[10px] font-medium text-muted">Assistant</p><p className="rounded-2xl rounded-tl-sm border border-line bg-surface px-3 py-2.5 text-[13px] leading-5 text-body">Hi{userName.trim() ? `, ${userName.trim()}` : ""}! Ask me about an invoice or explore your saved bills.</p></div>
              </div>
            ) : (
              <div role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions" className="space-y-4">
                {messages.map((message) => <div key={message.id} className={`flex items-start gap-2.5 ${message.role === "user" ? "flex-row-reverse" : ""}`}>
                  <span aria-hidden="true" className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${message.role === "user" ? "bg-raised text-muted" : "bg-accent-soft text-accent"}`}><ChatIcon name={message.role === "user" ? "user" : "chat"} className="size-3.5" /></span>
                  <div className="min-w-0 max-w-[85%]"><p className={`mb-1.5 text-[10px] font-medium text-muted ${message.role === "user" ? "text-right" : ""}`}>{message.role === "user" ? "You" : "Assistant"}</p><div className={`rounded-2xl px-3 py-2.5 text-[13px] leading-5 [overflow-wrap:anywhere] ${message.role === "user" ? "rounded-tr-sm bg-accent-selected text-foreground" : "rounded-tl-sm border border-line bg-surface text-body"}`}>{message.role === "assistant" ? <ChatAnswer text={message.text} /> : <p className="whitespace-pre-wrap">{message.text}</p>}
                  {!!message.sources?.length && <DocumentSources sources={message.sources} />}</div>
                </div></div>)}
              </div>
            )}
            {busy && <p role="status" className="mt-4 text-sm leading-6 text-muted">Thinking<span aria-hidden="true" className="ml-1 inline-flex items-center gap-1 align-middle"><span className="chat-loading-dot" /><span className="chat-loading-dot" /><span className="chat-loading-dot" /></span><span className="sr-only">…</span></p>}
            {error && <p role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-xs leading-5 text-red-300">{error}</p>}
            {indexing && indexing.readyBills < indexing.totalBills && <p className="mt-3 text-xs leading-5 text-subtle">{indexing.readyBills} of {indexing.totalBills} saved bills are ready for search.</p>}
          </div>

          <footer className="shrink-0 bg-transparent p-2.5 pt-0">
            <form onSubmit={send} className="document-chat-composer rounded-xl border border-line-strong bg-transparent p-2.5 transition-[border-color,box-shadow]">
              <label htmlFor="document-chat-message" className="sr-only">Message the document assistant</label>
              <textarea ref={input} id="document-chat-message" rows={1} maxLength={1000} value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} placeholder="Type a message…" aria-describedby="document-chat-keyboard-hint" onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
              }} className="document-chat-input block max-h-28 min-h-7 w-full min-w-0 resize-none bg-transparent px-1 py-1 text-base leading-5 text-foreground placeholder:text-subtle sm:text-[13px]" />
              <div className="mt-1 flex items-center justify-between"><span className="inline-flex items-center gap-1.5 px-1 text-[10px] text-subtle"><ChatIcon name="document" className="size-3" />Your saved bills</span><button type="submit" disabled={busy || !draft.trim()} aria-label="Send message" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-ink transition-colors hover:bg-accent-hover disabled:cursor-default disabled:bg-raised disabled:text-subtle"><ChatIcon name="send" className="size-3.5" /></button></div>
            </form>
            <span id="document-chat-keyboard-hint" className="sr-only">Enter to send. Shift + Enter for a new line. History clears on reload.</span>
          </footer>
        </section>
      )}
      <button ref={launcher} type="button" title={open ? "Close chat" : "Ask your docs"} aria-label={open ? "Close document assistant" : "Open document assistant"} aria-haspopup="dialog" aria-controls="document-chat" aria-expanded={open} onClick={() => { if (open) close(); else setOpen(true); }} className="document-chat-launcher fixed right-3 bottom-[calc(1rem_+_env(safe-area-inset-bottom))] z-40 inline-flex size-12 items-center justify-center gap-2 rounded-2xl border border-accent/30 bg-accent text-[13px] font-semibold text-ink sm:right-6 sm:bottom-[calc(1.5rem_+_env(safe-area-inset-bottom))] sm:h-11 sm:w-[152px] sm:rounded-xl sm:px-3">
        <span aria-hidden="true" className="relative size-5 shrink-0">
          <span className={`document-chat-launcher-icon absolute inset-0 ${open ? "scale-75 rotate-45 opacity-0" : "scale-100 rotate-0 opacity-100"}`}><ChatIcon name="chat" /></span>
          <span className={`document-chat-launcher-icon absolute inset-0 ${open ? "scale-100 rotate-0 opacity-100" : "scale-75 -rotate-45 opacity-0"}`}><ChatIcon name="close" /></span>
        </span>
        <span className="hidden whitespace-nowrap sm:inline">{open ? "Close chat" : "Ask your docs"}</span>
      </button>
    </>
  );
}
