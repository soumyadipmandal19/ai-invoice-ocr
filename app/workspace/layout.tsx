import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import Loading from "@/app/loading";
import { getUser } from "@/lib/server/auth/session";
import WorkspaceShell from "@/components/workspace-shell";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}><AuthenticatedWorkspace>{children}</AuthenticatedWorkspace></Suspense>;
}

async function AuthenticatedWorkspace({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/signin");
  return <WorkspaceShell key={user.id} user={user}>{children}</WorkspaceShell>;
}
