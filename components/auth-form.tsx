"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import type { AuthUser } from "@/types/auth/user";

export default function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const signup = mode === "signup";
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [showPassword, setShowPassword] = useState(false);
  const inputClass = "mt-2 w-full rounded-xl border border-line-strong bg-background px-4 py-3 text-sm text-foreground placeholder:text-subtle transition focus:border-accent disabled:opacity-50";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (signup && password !== form.get("confirmPassword")) {
      setError("Your passwords do not match.");
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      const response = await fetch(signup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") || ""),
          password,
          ...(signup ? { name: String(form.get("name") || ""), confirmPassword: String(form.get("confirmPassword") || "") } : {}),
        }),
      });
      const data: { user?: AuthUser; error?: string } | null = await response.json().catch(() => null);
      if (!response.ok || typeof data?.user?.id !== "string") {
        setError(typeof data?.error === "string" ? data.error : "We could not complete your request. Please try again.");
        return;
      }
      // Load the dashboard with the new cookie and a fresh client router cache.
      window.location.replace("/workspace/dashboard");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <main className="app-shell flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 px-6 py-6 sm:px-10">
        <Link href="/" aria-label="Paper to text home" className="flex items-center gap-3 text-sm font-semibold tracking-tight"><span className="neon-mark flex size-9 items-center justify-center rounded-xl bg-accent font-mono text-lg font-bold text-ink">p.</span><span>paper<span className="mx-1 text-accent">/</span>text</span></Link>
        <span className="hidden text-xs text-subtle sm:block">A little less paperwork.</span>
      </header>
      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-14 px-6 py-10 sm:px-10 lg:grid-cols-2 lg:gap-24 lg:py-16">
        <section className="hidden lg:block" aria-labelledby="auth-intro">
          <p className="mb-6 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-accent"><span className="size-2 rounded-full bg-accent" />Your document workspace</p>
          <h1 id="auth-intro" className="max-w-lg text-6xl font-semibold leading-[1.08] tracking-[-0.055em]">Less typing.<br />More <span className="text-accent">doing.</span></h1>
          <p className="mt-6 max-w-sm text-base leading-7 text-muted">Turn your PDFs, scans, and images into text and structured data you can actually use.</p>
          <div className="mt-10 max-w-sm rounded-2xl border border-line bg-panel p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line pb-4"><span className="flex items-center gap-2 text-xs text-muted"><svg aria-hidden="true" width="18" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 3h10l6 6v12H4zM14 3v6h6M8 13h8M8 17h5" /></svg>From paper to possibility</span><span className="rounded-full bg-accent-soft px-2.5 py-1 font-mono text-[10px] text-accent">READY</span></div>
            <div aria-hidden="true" className="space-y-3 py-6"><div className="h-2 w-3/4 rounded bg-raised" /><div className="h-2 w-full rounded bg-raised" /><div className="h-2 w-1/2 rounded bg-raised" /></div>
            <ol className="flex items-center justify-between gap-2 border-t border-line pt-4 text-xs text-muted">{["Upload", "Extract", "Review"].map((step, index) => <li key={step} className="flex items-center gap-2"><span className="font-mono text-accent">0{index + 1}</span>{step}</li>)}</ol>
          </div>
          <p className="mt-6 text-xs text-subtle">PDF, PNG, JPG, WebP, BMP. One place to make sense of it all.</p>
        </section>
        <section aria-labelledby="auth-title" className="mx-auto w-full max-w-md rounded-3xl border border-line bg-panel p-6 shadow-2xl sm:p-9">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-accent">{signup ? "Start something simpler" : "Your workspace awaits"}</p>
          <h2 id="auth-title" className="text-3xl font-semibold tracking-[-0.04em]">{signup ? "Create your account." : "Welcome back."}</h2>
          <p className="mt-3 text-sm leading-6 text-muted">{signup ? "A few details, and you’re ready to turn documents into data." : "Sign in to get back to your documents."}</p>
          <form onSubmit={submit} aria-busy={pending} className="mt-7 space-y-5" aria-label={signup ? "Create account" : "Sign in"}>
            <fieldset disabled={pending} className="space-y-5">
              {signup && <div><label htmlFor="name" className="text-xs font-medium text-body">Full name</label><input id="name" name="name" autoComplete="name" required minLength={2} maxLength={80} placeholder="Your name" className={inputClass} /></div>}
              <div><label htmlFor="email" className="text-xs font-medium text-body">Email address</label><input id="email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" className={inputClass} /></div>
              <div><div className="flex items-center justify-between"><label htmlFor="password" className="text-xs font-medium text-body">Password</label><button type="button" aria-controls="password" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className="rounded text-xs text-muted hover:text-accent">{showPassword ? "Hide password" : "Show password"}</button></div><input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"} required minLength={8} maxLength={128} aria-describedby={signup ? "password-hint" : undefined} placeholder={signup ? "Create a password" : "Enter your password"} className={inputClass} />{signup && <p id="password-hint" className="mt-2 text-xs text-subtle">Use at least 8 characters.</p>}</div>
              {signup && <div><label htmlFor="confirm-password" className="text-xs font-medium text-body">Confirm password</label><input id="confirm-password" name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} placeholder="Re-enter your password" className={inputClass} /></div>}
            </fieldset>
            {error && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-3 text-sm text-red-200">{error}</p>}
            <button type="submit" disabled={pending} className="neon-button flex w-full items-center justify-center gap-3 rounded-xl bg-accent px-4 py-3.5 text-sm font-semibold text-ink transition hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60">{pending ? (signup ? "Creating account…" : "Signing in…") : (signup ? "Create account" : "Sign in")}<span aria-hidden="true">→</span></button>
          </form>
          <p className="mt-7 border-t border-line pt-6 text-center text-sm text-muted">{signup ? "Already have an account?" : "New to Paper to text?"}{" "}<Link href={signup ? "/signin" : "/signup"} className="rounded font-medium text-accent hover:underline">{signup ? "Sign in" : "Create an account"}</Link></p>
        </section>
      </div>
      <footer className="px-6 py-6 text-center text-xs text-subtle">Less busywork. More clarity. Paper to text.</footer>
    </main>
  );
}
