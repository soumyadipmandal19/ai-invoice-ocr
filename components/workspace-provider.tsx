"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useId, useLayoutEffect, useState, useSyncExternalStore,
  type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { usePathname } from "next/navigation";
import { createWorkspaceStore, type WorkspaceStore } from "@/lib/workspace/store";

const StoreContext = createContext<WorkspaceStore | null>(null);
const ScopeContext = createContext<string | null>(null);

function ClearSignedOutWorkspace({ store }: { store: WorkspaceStore }) {
  const pathname = usePathname();
  useEffect(() => { if (pathname === "/signin" || pathname === "/signup") store.activateOwner(null); }, [pathname, store]);
  return null;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createWorkspaceStore);
  return <StoreContext.Provider value={store}><Suspense fallback={null}><ClearSignedOutWorkspace store={store} /></Suspense>{children}</StoreContext.Provider>;
}

export function WorkspaceScope({ ownerId, namespace, children }: { ownerId: string; namespace: string; children: ReactNode }) {
  const store = useContext(StoreContext);
  useLayoutEffect(() => { store?.activateOwner(ownerId); }, [store, ownerId]);
  return <ScopeContext.Provider value={`${ownerId}:${namespace}`}>{children}</ScopeContext.Provider>;
}

function useStoreKey(key: string) {
  const shared = useContext(StoreContext);
  const scope = useContext(ScopeContext);
  const id = useId();
  const [local] = useState(createWorkspaceStore);
  return { store: scope && shared ? shared : local, key: `${scope || id}:${key}` };
}

export function useWorkspaceState<T>(name: string, initialValue: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const { store, key } = useStoreKey(name);
  const initial = useCallback(() => typeof initialValue === "function" ? (initialValue as () => T)() : initialValue, [initialValue]);
  const snapshot = useCallback(() => store.read(key, initial), [store, key, initial]);
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [store, key]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const set = useCallback<Dispatch<SetStateAction<T>>>((update) => store.update(key, update), [store, key]);
  return [value, set];
}

/** Native scroll events save silently, without re-rendering a large spreadsheet. */
export function useWorkspaceScroll(ref: RefObject<HTMLElement | null>, name: string, contentReady: unknown = true) {
  const { store, key } = useStoreKey(`scroll:${name}`);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const empty = () => ({ top: 0, left: 0 });
    const saved = store.read(key, empty);
    const restore = () => { element.scrollTop = saved.top; element.scrollLeft = saved.left; };
    restore();
    const frame = requestAnimationFrame(restore);
    const capture = () => {
      if (element.clientHeight > 0) store.write(key, { top: element.scrollTop, left: element.scrollLeft }, empty, false);
    };
    element.addEventListener("scroll", capture, { passive: true });
    return () => { cancelAnimationFrame(frame); capture(); element.removeEventListener("scroll", capture); };
  }, [store, key, ref, contentReady]);
}
