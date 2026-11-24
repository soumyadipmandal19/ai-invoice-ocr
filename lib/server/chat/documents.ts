import "server-only";

import { getUser } from "@/lib/server/auth/session";
import { RequestError } from "@/lib/server/http/request";
import { listChatDocuments } from "@/lib/server/chat/records";

const headers = { "Cache-Control": "no-store" };

export async function handleChatDocuments(request: Request) {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
    const value = new URL(request.url).searchParams.get("offset") ?? "0";
    const offset = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new RequestError("Invalid document offset.", 400);
    return Response.json(await listChatDocuments(user.id, null, offset), { headers });
  } catch (error) {
    if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Unable to load saved documents. Please retry." }, { status: 503, headers });
  }
}
