import { getUser } from "@/lib/server/auth/session";
import { listDocumentFiles } from "@/lib/server/documents/store";
import { DOCUMENT_TYPES } from "@/lib/classification/document";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
    const params = new URL(request.url).searchParams;
    const rawOffset = params.get("offset") || "0";
    const offset = Number(rawOffset);
    const query = (params.get("q") || "").trim().toLowerCase();
    const folder = params.get("folder") || "";
    if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(offset) || offset > 1_000_000
      || query.length > 200 || (folder && !DOCUMENT_TYPES.some((type) => type === folder))) {
      return Response.json({ error: "Invalid document search or page." }, { status: 400, headers });
    }
    return Response.json(await listDocumentFiles(user.id, offset, query, folder), { headers });
  } catch {
    return Response.json({ error: "Unable to load documents. Please retry." }, { status: 503, headers });
  }
}
