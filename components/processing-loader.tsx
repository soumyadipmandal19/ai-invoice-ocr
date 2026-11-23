type ProcessingStage = "extracting" | "organizing";

export default function ProcessingLoader({ stage }: { stage: ProcessingStage }) {
  const organizing = stage === "organizing";

  return (
    <section role="status" aria-live="polite" aria-atomic="true" className="flex min-h-[560px] flex-col items-center justify-center px-6 py-12 text-center">
      <div aria-hidden="true" className="processing-art relative mb-8 flex size-40 shrink-0 items-center justify-center">
        <div className="absolute inset-0 rounded-full border border-accent/10 bg-accent/5" />
        <div className="processing-orbit absolute inset-2 rounded-full border border-transparent border-t-accent/70 border-r-accent/20" />
        <div className="relative h-24 w-[72px] overflow-hidden rounded-xl border border-accent/30 bg-panel p-3 shadow-[0_0_40px_#bdff5412]">
          <svg className="mb-3 size-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 3h9l5 5v13H5zM14 3v6h5M9 13h6M9 17h4" /></svg>
          <div className="space-y-2"><div className="h-1 rounded-full bg-accent/40" /><div className="h-1 w-4/5 rounded-full bg-accent/25" /><div className="h-1 w-3/5 rounded-full bg-accent/15" /></div>
          <div className="processing-scan absolute inset-x-0 top-0 h-px bg-accent shadow-[0_0_12px_2px_#bdff5466]" />
        </div>
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">{organizing ? "Organizing your data" : "Reading your document"}</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">Good data takes a moment.</h2>
      <p className="mt-3 max-w-sm text-sm leading-6 text-muted">{organizing ? "Your text is extracted. We’re checking the document and arranging your fields and tables." : "We’re extracting text from your file, including scanned pages and images."}</p>
      <ol aria-label="Processing progress" className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-3 text-xs">
        <li className={`flex items-center gap-2 ${organizing ? "text-muted" : "text-accent"}`} aria-current={!organizing ? "step" : undefined}>
          <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full border border-accent/30 bg-accent-soft">{organizing ? "✓" : <span className="size-2 rounded-full bg-accent motion-safe:animate-pulse" />}</span>Extract text
        </li>
        <li className={`flex items-center gap-2 ${organizing ? "text-accent" : "text-subtle"}`} aria-current={organizing ? "step" : undefined}>
          <span aria-hidden="true" className={`flex size-5 items-center justify-center rounded-full border ${organizing ? "border-accent/30 bg-accent-soft" : "border-line"}`}>{organizing ? <span className="size-2 rounded-full bg-accent motion-safe:animate-pulse" /> : "2"}</span>Organize data
        </li>
      </ol>
      <p className="mt-7 text-xs leading-5 text-subtle">Please wait and keep this tab open.</p>
    </section>
  );
}
