import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { readSession, SESSION_SECONDS } from "@/lib/server/auth/store";

export const SESSION_COOKIE = "paper-text-session";
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_SECONDS,
};

export async function getUser() {
  // Session expiry and database access must run for the real request, including
  // when development prerendering already has access to a session cookie.
  await connection();
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}
