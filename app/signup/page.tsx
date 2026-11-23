import { Suspense } from "react";
import Loading from "@/app/loading";
import { redirect } from "next/navigation";
import AuthForm from "@/components/auth-form";
import { getUser } from "@/lib/server/auth/session";

export const metadata = { title: "Create an account | Paper to text" };

export default function SignUpPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SignUpContent />
    </Suspense>
  );
}

async function SignUpContent() {
  if (await getUser()) redirect("/dashboard");
  return <AuthForm mode="signup" />;
}
