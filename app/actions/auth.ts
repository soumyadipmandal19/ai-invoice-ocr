"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { deleteSession } from "@/lib/server/auth/store";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth/session";

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  redirect("/signin");
}
