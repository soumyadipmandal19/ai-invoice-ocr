import { Suspense } from "react";
import Loading from "@/app/loading";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/server/auth/session";

export default function Home() {
  return (
    <Suspense fallback={<Loading />}>
      <SessionRedirect />
    </Suspense>
  );
}

async function SessionRedirect() {
  return redirect((await getUser()) ? "/dashboard" : "/signin");
}
