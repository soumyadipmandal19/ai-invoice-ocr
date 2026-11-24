import DocumentBrowser from "@/components/document-browser";

// Authentication and scoped state are provided by the shared workspace layout.
// The documents API validates ownership when loading private data.
export default function DocumentsPage() {
  return <DocumentBrowser />;
}
