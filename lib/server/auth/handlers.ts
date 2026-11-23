import "server-only";

import { cookies } from "next/headers";
import { connection } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth/session";
import { deleteAccount, deleteSession, readSession } from "@/lib/server/auth/store";
import { AuthError, signInOrUp, type AuthMode } from "@/lib/server/auth/service";
import { checkOrigin, readInput, RequestError } from "@/lib/server/http/request";

const headers = { "Cache-Control": "no-store" };

function failure(error: unknown) {
  if (error instanceof AuthError || error instanceof RequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers });
  }
  // Do not expose driver errors, credentials, or submitted values.
  console.error("Authentication backend request failed.");
  return Response.json({ error: "Authentication is temporarily unavailable. Please try again." }, { status: 503, headers });
}

export async function handleCredentials(request: Request, mode: AuthMode) {
  try {
    checkOrigin(request);
    const input = await readInput(request);
    const jar = await cookies();
    const { user, token } = await signInOrUp(mode, input, jar.get(SESSION_COOKIE)?.value);
    jar.set(SESSION_COOKIE, token, sessionCookieOptions);
    return Response.json({ user }, { status: mode === "signup" ? 201 : 200, headers });
  } catch (error) {
    return failure(error);
  }
}

export async function handleLogout(request: Request) {
  try {
    checkOrigin(request);
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token) await deleteSession(token);
    jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
    return Response.json({ success: true }, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function handleCurrentUser() {
  // Keep Next.js request-time cookie access outside the database error handler.
  await connection();
  const jar = await cookies();
  try {
    const user = await readSession(jar.get(SESSION_COOKIE)?.value);
    if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
    return Response.json({ user }, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function handleDeleteAccount(request: Request) {
  try {
    checkOrigin(request);
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) throw new AuthError("Sign in to continue.", 401);
    const input = await readInput(request);
    if (input.confirmation !== "DELETE") {
      throw new AuthError("Type DELETE to confirm account deletion.", 400);
    }
    if (!(await deleteAccount(token))) throw new AuthError("Sign in to continue.", 401);
    jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
    return Response.json({ success: true }, { headers });
  } catch (error) {
    return failure(error);
  }
}
