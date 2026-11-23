"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AuthUser } from "@/types/auth/user";

export default function ProfileMenu({ user }: { user: AuthUser }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const profileDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const deleting = useRef(false);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const initial = Array.from(user.name.trim())[0]?.toLocaleUpperCase() || "?";
  const dialogClass = "m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-auto rounded-2xl border border-line-strong bg-panel p-6 text-foreground shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm";
  const buttonClass = "rounded-xl border border-line-strong px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";

  useEffect(() => {
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && menu.current && !menu.current.contains(event.target)) menu.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  function openDialog(kind: "profile" | "delete") {
    if (menu.current) menu.current.open = false;
    trigger.current?.focus();
    if (kind === "profile") profileDialog.current?.showModal();
    else {
      setConfirmation("");
      setError("");
      deleteDialog.current?.showModal();
    }
  }

  async function removeProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleting.current || confirmation !== "DELETE") return;
    deleting.current = true;
    setPending(true);
    setError("");
    let removed = false;
    try {
      const response = await fetch("/api/auth/me", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const data: { success?: boolean; error?: string } | null = await response.json().catch(() => null);
      if (!response.ok || data?.success !== true) {
        setError(typeof data?.error === "string" ? data.error : "We could not delete your profile. Please try again.");
        return;
      }
      removed = true;
      window.location.replace("/signin");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      if (!removed) {
        deleting.current = false;
        setPending(false);
      }
    }
  }

  return (
    <>
      <details ref={menu} className="relative">
        <summary ref={trigger} aria-label={`Profile options for ${user.name}`} aria-controls="profile-options" title={user.name} className="flex size-8 cursor-pointer list-none items-center justify-center rounded-full border border-accent/30 bg-accent-soft text-sm font-semibold text-accent transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">{initial}</summary>
        <div id="profile-options" className="absolute right-0 z-40 mt-3 w-52 rounded-xl border border-line-strong bg-panel p-1.5 shadow-2xl">
          <button type="button" onClick={() => openDialog("profile")} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-foreground hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent">Profile details</button>
          <button type="button" onClick={() => openDialog("delete")} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-300 hover:bg-red-400/10 focus-visible:outline-2 focus-visible:outline-red-300">Delete profile</button>
        </div>
      </details>

      <dialog ref={profileDialog} aria-labelledby="profile-details-title" className={dialogClass}>
        <h2 id="profile-details-title" className="text-lg font-semibold">Profile details</h2>
        <div aria-hidden="true" className="mt-5 flex size-14 items-center justify-center rounded-full border border-accent/30 bg-accent-soft text-xl font-semibold text-accent">{initial}</div>
        <dl className="mt-5 space-y-4 text-sm">
          <div><dt className="text-xs text-muted">Name</dt><dd className="mt-1 break-words text-foreground">{user.name}</dd></div>
          <div><dt className="text-xs text-muted">Email</dt><dd className="mt-1 break-all text-foreground">{user.email}</dd></div>
        </dl>
        <div className="mt-6 flex justify-end"><button type="button" onClick={() => profileDialog.current?.close()} className={buttonClass}>Close</button></div>
      </dialog>

      <dialog ref={deleteDialog} aria-labelledby="delete-profile-title" aria-describedby="delete-profile-description" onCancel={(event) => { if (deleting.current) event.preventDefault(); }} className={dialogClass}>
        <h2 id="delete-profile-title" className="text-lg font-semibold">Delete your account?</h2>
        <p id="delete-profile-description" className="mt-3 text-sm leading-6 text-muted">This permanently deletes your account and signs you out on every device. This action cannot be undone.</p>
        <form onSubmit={removeProfile} aria-busy={pending} className="mt-5">
          <label htmlFor="delete-profile-confirmation" className="text-sm text-body">Type <strong className="font-mono text-foreground">DELETE</strong> to confirm.</label>
          <input id="delete-profile-confirmation" name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required pattern="DELETE" autoComplete="off" spellCheck={false} disabled={pending} className="mt-2 w-full rounded-xl border border-line-strong bg-background px-3 py-2.5 text-sm text-foreground focus:border-red-300 focus:outline-none disabled:opacity-50" />
          {error && <p role="alert" className="mt-3 rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-3 text-sm text-red-200">{error}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button type="button" disabled={pending} onClick={() => deleteDialog.current?.close()} className={buttonClass}>Cancel</button>
            <button type="submit" disabled={pending || confirmation !== "DELETE"} className="rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Deleting…" : "Delete account"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
