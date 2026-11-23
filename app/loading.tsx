export default function Loading() {
  return (
    <main className="app-shell flex min-h-dvh items-center justify-center bg-background text-foreground">
      <p role="status" className="flex items-center gap-3 text-sm text-muted"><span className="size-2 animate-pulse rounded-full bg-accent" />Opening your workspace…</p>
    </main>
  );
}
