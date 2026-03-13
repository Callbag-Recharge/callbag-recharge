// ---------------------------------------------------------------------------
// Dependency tracking context
// ---------------------------------------------------------------------------
// When a derived store's computation runs, we set a global context so that
// any store read via `store()` during that computation is automatically
// registered as a dependency. This is the same trick Signals/MobX/Solid use.
// ---------------------------------------------------------------------------

import type { Store } from './types';

let currentTracker: Set<Store<unknown>> | null = null;

/**
 * Run `fn` while tracking which stores are read.
 * Returns [result, Set of stores that were read].
 */
export function tracked<T>(fn: () => T): [T, Set<Store<unknown>>] {
  const prev = currentTracker;
  const deps = new Set<Store<unknown>>();
  currentTracker = deps;
  try {
    const result = fn();
    return [result, deps];
  } finally {
    currentTracker = prev;
  }
}

/** Register a store as read in the current tracking context (if any). */
export function registerRead(store: Store<unknown>): void {
  if (currentTracker) {
    currentTracker.add(store);
  }
}
