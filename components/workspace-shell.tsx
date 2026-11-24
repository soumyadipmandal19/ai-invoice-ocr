"use client";

import { Activity, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Dashboard from "@/components/dashboard";
import { WorkspaceScope } from "@/components/workspace-provider";
import type { AuthUser } from "@/types/auth/user";

/** Shared layout lifetime, independent of the router's page cache/eviction. */
export default function WorkspaceShell({ user, children }: { user: AuthUser; children: ReactNode }) {
  const dashboardVisible = usePathname() === "/workspace/dashboard";
  return <>
    <Activity mode={dashboardVisible ? "visible" : "hidden"}>
      <WorkspaceScope ownerId={user.id} namespace="dashboard"><Dashboard user={user} /></WorkspaceScope>
    </Activity>
    {/* Always render the router slot, including the dashboard's empty page.
        Hiding it in Activity drops the segment during Next's validation. */}
    <WorkspaceScope ownerId={user.id} namespace="library">{children}</WorkspaceScope>
  </>;
}
