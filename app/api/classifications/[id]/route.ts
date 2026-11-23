import { getUser } from "@/lib/server/auth/session";
import { readClassificationJob } from "@/lib/server/classification/store";

export async function GET(_request: Request, context: RouteContext<"/api/classifications/[id]">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await context.params;
  try {
    const job = await readClassificationJob(id);
    if (!job || job.ownerUserId !== user.id) return Response.json({ error: "Classification not found or expired." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json({ ...job, ownerUserId: undefined, uploadKey: undefined }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Unable to check document type." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
