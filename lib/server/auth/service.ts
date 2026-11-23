import "server-only";

import { authenticateUser, createSession, createUser, deleteSession } from "@/lib/server/auth/store";
import type { AuthUser } from "@/types/auth/user";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const attempts = new Map<string, { count: number; reset: number }>();
let active = 0;
export type AuthMode = "signup" | "signin";

export async function signInOrUp(mode: AuthMode, input: Record<string, unknown>, previousToken?: string): Promise<{ user: AuthUser; token: string }> {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("Enter a valid email address.", 400);
  if (password.length < 8 || password.length > 128) throw new AuthError("Use a password between 8 and 128 characters.", 400);
  if (mode === "signup" && (name.length < 2 || name.length > 80)) throw new AuthError("Enter your name (2–80 characters).", 400);
  if (mode === "signup" && input.confirmPassword !== undefined && input.confirmPassword !== password) throw new AuthError("Your passwords do not match.", 400);

  const now = Date.now();
  for (const [key, value] of attempts) if (value.reset <= now) attempts.delete(key);
  const attempt = attempts.get(email) || { count: 0, reset: now + 15 * 60 * 1000 };
  if (attempt.count >= 10 || (!attempts.has(email) && attempts.size >= 10000)) throw new AuthError("Too many attempts. Try again in 15 minutes.", 429);
  if (active >= 2) throw new AuthError("Authentication is busy. Try again shortly.", 503);
  attempt.count++;
  attempts.set(email, attempt);
  active++;
  try {
    const user = mode === "signup" ? await createUser(name, email, password) : await authenticateUser(email, password);
    if (!user) throw new AuthError(mode === "signup" ? "An account with this email already exists. Sign in instead." : "Email or password is incorrect.", mode === "signup" ? 409 : 401);
    const token = await createSession(user);
    try {
      if (previousToken) await deleteSession(previousToken);
    } catch (error) {
      await deleteSession(token);
      throw error;
    }
    attempts.delete(email);
    return { user, token };
  } finally {
    active--;
  }
}
