// ---------------------------------------------------------------------------
// Protocol — DIRTY symbol and propagation batching
// ---------------------------------------------------------------------------
// Push phase: state.set() pushes DIRTY through callbag sinks
// Pull phase: .get() lazily recomputes dirty nodes
// Effects run after all DIRTY has propagated (depth reaches 0)
// ---------------------------------------------------------------------------

/** Sentinel value pushed via type 1 to indicate invalidation, not data */
export const DIRTY = Symbol('DIRTY');

/** Callbag signal types */
export const START = 0;
export const DATA = 1;
export const END = 2;

// Propagation batching
let depth = 0;
const pending: Array<() => void> = [];
let flushing = false;

/**
 * Push DIRTY to all sinks in a set.
 * Effects are deferred until the outermost propagation completes.
 */
export function pushDirty(sinks: Set<any>): void {
  depth++;
  for (const sink of sinks) sink(DATA, DIRTY);
  depth--;
  if (depth === 0) flush();
}

/**
 * Schedule a callback (effect/subscriber) to run after DIRTY propagation.
 * If not inside a propagation, runs immediately.
 */
export function enqueueEffect(run: () => void): void {
  if (depth === 0 && !flushing) {
    run();
  } else {
    pending.push(run);
  }
}

function flush(): void {
  if (flushing) return;
  flushing = true;
  // Process queue — effects may trigger new state changes
  // which enqueue more effects, so loop until empty
  while (pending.length > 0) {
    const effect = pending.shift()!;
    effect();
  }
  flushing = false;
}
