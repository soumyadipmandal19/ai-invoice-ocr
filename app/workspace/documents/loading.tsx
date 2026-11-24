import Link from "next/link";

export default function DocumentsLoading() {
  return <main className="flex h-dvh flex-col bg-background text-foreground">
    <header className="flex items-center gap-4 border-b border-line bg-panel px-5 py-4"><Link href="/workspace/dashboard" className="text-sm text-muted hover:text-accent">← Dashboard</Link><h1 className="text-sm font-semibold">Bills library</h1></header>
    <p role="status" className="p-5 text-sm text-muted">Opening your bills…</p>
  </main>;
}
