export type StateUpdate<T> = T | ((current: T) => T);

/** One tab's in-memory workspace. No browser storage or server cache is involved. */
export function createWorkspaceStore() {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  let owner: string | null = null;
  return {
    read<T>(key: string, initial: () => T): T {
      if (!values.has(key)) values.set(key, initial());
      return values.get(key) as T;
    },
    write<T>(key: string, update: StateUpdate<T>, initial: () => T, notify = true) {
      const current = this.read(key, initial);
      const next = typeof update === "function" ? (update as (value: T) => T)(current) : update;
      if (Object.is(current, next)) return;
      values.set(key, next);
      // React may unsubscribe/re-subscribe while handling a notification.
      // Iterate a snapshot so new subscriptions cannot extend this dispatch.
      if (notify) [...(listeners.get(key) || [])].forEach((listener) => listener());
    },
    subscribe(key: string, listener: () => void) {
      const subscribers = listeners.get(key) || new Set();
      subscribers.add(listener); listeners.set(key, subscribers);
      return () => { subscribers.delete(listener); if (!subscribers.size) listeners.delete(key); };
    },
    update<T>(key: string, action: StateUpdate<T>) {
      // Ignore late async completions after a sign-out/cache clear.
      if (values.has(key)) this.write(key, action, () => values.get(key) as T);
    },
    clear() {
      values.clear();
      [...listeners.values()].flatMap((subscribers) => [...subscribers]).forEach((listener) => listener());
    },
    activateOwner(next: string | null) {
      if (owner !== next) { owner = next; this.clear(); }
    },
  };
}
export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
