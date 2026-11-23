import { Suspense } from "react";
import Loading from "@/app/loading";
import { redirect } from "next/navigation";
import Dashboard from "@/components/dashboard";
import { getUser } from "@/lib/server/auth/session";

export default function DashboardPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AuthenticatedDashboard />
    </Suspense>
  );
}

async function AuthenticatedDashboard() {
  const user = await getUser();
  if (!user) redirect("/signin");
  return <Dashboard user={user} />;
}
