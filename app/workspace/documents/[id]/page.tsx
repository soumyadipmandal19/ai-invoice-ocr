import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import Loading from "@/app/loading";
import { getUser } from "@/lib/server/auth/session";
import { readBillOutputs } from "@/lib/server/bills/store";
import DocumentDetail from "@/components/document-detail";
import { WorkspaceScope } from "@/components/workspace-provider";

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<Loading />}><OwnedDocument params={params} /></Suspense>;
}
async function OwnedDocument({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/signin");
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) notFound();
  const saved = await readBillOutputs(id, user.id);
  if (!saved) notFound();
  return <WorkspaceScope ownerId={user.id} namespace={`document:${id}`}><DocumentDetail saved={saved} /></WorkspaceScope>;
}
