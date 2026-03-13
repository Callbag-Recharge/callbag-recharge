// ---------------------------------------------------------------------------
// effect(fn) — run side effects when tracked stores change
// ---------------------------------------------------------------------------

import { tracked } from './tracking';

/**
 * Runs `fn` immediately and re-runs it whenever any store read
 * inside `fn` changes. Returns a dispose function.
 */
export function effect(fn: () => void | (() => void)): () => void {
  let cleanupEffect: void | (() => void);
  let cleanupSubs: Array<() => void> = [];
  let disposed = false;
  let running = false;

  function run(): void {
    if (disposed || running) return;
    running = true;

    // Cleanup previous effect return value
    if (cleanupEffect) cleanupEffect();

    // Cleanup previous subscriptions
    for (const unsub of cleanupSubs) unsub();
    cleanupSubs = [];

    // Run in tracking context
    const [result, deps] = tracked(fn);
    cleanupEffect = result;

    // Subscribe to all deps so we re-run when they change
    for (const dep of deps) {
      const unsub = dep.subscribe(() => {
        run();
      });
      cleanupSubs.push(unsub);
    }

    running = false;
  }

  run();

  return () => {
    disposed = true;
    if (cleanupEffect) cleanupEffect();
    for (const unsub of cleanupSubs) unsub();
    cleanupSubs = [];
  };
}
