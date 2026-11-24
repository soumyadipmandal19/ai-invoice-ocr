import Link from "next/link";

export default function DocumentNotFound() {
  return <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-foreground"><h1 className="text-lg font-semibold">Document not found</h1><p className="text-sm text-muted">This file is unavailable or does not belong to your library.</p><Link href="/workspace/documents" className="result-button">Back to documents</Link></div>;
}
