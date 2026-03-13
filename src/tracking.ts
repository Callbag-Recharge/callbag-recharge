// ---------------------------------------------------------------------------
// Dependency tracking context
// ---------------------------------------------------------------------------
// When a derived store's computation runs, any store.get() call
// registers that store as a dependency. Same mechanism as Signals/MobX.
// ---------------------------------------------------------------------------

import type { Store } from './types';

let currentTracker: Set<Store<unknown>> | null = null;

/**
 * Run `fn` while tracking which stores are read via .get().
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
