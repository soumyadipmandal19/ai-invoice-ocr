function Placeholder({ className = "" }: { className?: string }) {
  return <span className={`block animate-pulse rounded-md bg-raised ${className}`} />;
}

export function WorkspaceSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <span className="sr-only">Loading your saved documents and workbook…</span>
      <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid shrink-0 gap-3 sm:grid-cols-3 lg:grid-cols-[1.2fr_1fr_1fr]">
          {[0, 1, 2].map((card) => (
            <div key={card} className="workflow-card border-line bg-panel">
              <div className="flex items-center gap-3"><Placeholder className="size-8" /><Placeholder className="h-4 w-20" /><Placeholder className="ml-auto h-3 w-12" /></div>
              <Placeholder className="mt-4 h-10 w-full" />
              <Placeholder className="mt-3 h-3 w-3/4" />
            </div>
          ))}
        </div>
        <div className="flex min-h-[520px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel sm:min-h-[400px] lg:min-h-0">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4"><Placeholder className="h-4 w-36" /><Placeholder className="h-3 w-24" /></div>
          <div className="flex shrink-0 gap-3 border-b border-line bg-background/50 p-3"><Placeholder className="h-8 w-24" /><Placeholder className="h-8 w-32" /><Placeholder className="hidden h-8 w-28 sm:block" /></div>
          <div className="flex shrink-0 gap-3 border-b border-line p-4"><Placeholder className="h-8 w-40" /><Placeholder className="ml-auto h-8 w-20" /></div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="grid min-w-[480px] grid-cols-[2fr_1.5fr_1fr_1fr] gap-5 border-b border-line bg-surface/50 px-4 py-3">
              {[0, 1, 2, 3].map((column) => <Placeholder key={column} className="h-3 w-2/3" />)}
            </div>
            {Array.from({ length: 8 }, (_, row) => <div key={row} className="grid min-w-[480px] grid-cols-[2fr_1.5fr_1fr_1fr] gap-5 border-b border-line-soft px-4 py-4">{[0, 1, 2, 3].map((column) => <Placeholder key={column} className={`h-3 ${((row + column) % 3) === 0 ? "w-1/2" : "w-3/4"}`} />)}</div>)}
          </div>
          <div className="flex shrink-0 gap-4 border-t border-line p-3"><Placeholder className="h-5 w-16" /><Placeholder className="h-5 w-20" /><Placeholder className="h-5 w-24" /></div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardSkeleton() {
  return (
    <div className="app-shell flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <div aria-hidden="true" className="flex min-h-14 shrink-0 items-center gap-3 border-b border-line bg-panel/70 px-4 py-2 sm:px-5">
        <Placeholder className="size-8" /><Placeholder className="h-4 w-28" /><Placeholder className="ml-auto size-8 rounded-full" />
      </div>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 sm:p-4 lg:overflow-hidden"><WorkspaceSkeleton /></main>
    </div>
  );
}
