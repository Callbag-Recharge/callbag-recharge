// ---------------------------------------------------------------------------
// subscribe(store, cb) — listen to value changes
// ---------------------------------------------------------------------------
// Connects as a callbag sink. Deferred like effects to avoid glitches.
// ---------------------------------------------------------------------------

import { START, DATA, END, DIRTY, enqueueEffect } from './protocol';
import type { Store } from './types';

export function subscribe<T>(
  store: Store<T>,
  cb: (value: T, prev: T | undefined) => void,
): () => void {
  let prev: T = store.get();
  let talkback: ((type: number) => void) | null = null;
  let pending = false;

  store.source(START, (type: number, data: any) => {
    if (type === START) talkback = data;
    if (type === DATA && data === DIRTY) {
      if (!pending) {
        pending = true;
        enqueueEffect(() => {
          pending = false;
          const next = store.get();
          if (!Object.is(next, prev)) {
            const p = prev;
            prev = next;
            cb(next, p);
          }
        });
      }
    }
  });

  return () => talkback?.(END);
}
