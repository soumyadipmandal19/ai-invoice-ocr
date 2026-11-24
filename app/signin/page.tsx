import { Suspense } from "react";
import Loading from "@/app/loading";
import { redirect } from "next/navigation";
import AuthForm from "@/components/auth-form";
import { getUser } from "@/lib/server/auth/session";

export const metadata = { title: "Sign in | Paper to text" };

export default function SignInPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SignInContent />
    </Suspense>
  );
}

async function SignInContent() {
  if (await getUser()) redirect("/workspace/dashboard");
  return <AuthForm mode="signin" />;
}
