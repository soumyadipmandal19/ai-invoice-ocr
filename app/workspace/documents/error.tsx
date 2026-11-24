"use client";

import Link from "next/link";

export default function DocumentsError({ reset }: { reset: () => void }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-foreground"><h2 className="text-lg font-semibold">Could not load this document</h2><p className="text-sm text-muted">The saved data is temporarily unavailable.</p><div className="flex gap-3"><button type="button" className="result-button" onClick={reset}>Try again</button><Link href="/workspace/documents" className="result-button">Back to documents</Link></div></div>;
}
