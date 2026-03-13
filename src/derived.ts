// ---------------------------------------------------------------------------
// derived(fn) — a computed store, no cache, always pulls fresh
// ---------------------------------------------------------------------------
// - .get() always runs fn() — no cached value, always fresh
// - Connects to upstream lazily (on first .get())
// - Propagates DIRTY downstream so effects/subscribers know to re-run
// ---------------------------------------------------------------------------

import type { Store, StoreOptions } from './types';
import { START, DATA, END, DIRTY, pushDirty } from './protocol';
import { tracked, registerRead } from './tracking';
import { Inspector } from './inspector';

function sameSet(a: Set<unknown>, b: Set<unknown>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export function derived<T>(fn: () => T, opts?: StoreOptions): Store<T> {
  const sinks = new Set<any>();
  let upstreamTalkbacks: Array<(type: number) => void> = [];
  let currentDeps = new Set<Store<unknown>>();

  function connectUpstream(deps: Set<Store<unknown>>): void {
    if (sameSet(currentDeps, deps)) return;

    // Disconnect old
    for (const tb of upstreamTalkbacks) tb(END);
    upstreamTalkbacks = [];
    currentDeps = deps;

    // Connect new
    for (const dep of deps) {
      dep.source(START, (type: number, data: any) => {
        if (type === START) upstreamTalkbacks.push(data);
        if (type === DATA && data === DIRTY) {
          pushDirty(sinks);
        }
      });
    }
  }

  const store: Store<T> = {
    get() {
      registerRead(store);
      // Always run fn — no cache. fn() calls deps' .get() which are passive reads.
      const [result, newDeps] = tracked(fn);
      connectUpstream(newDeps);
      return result;
    },

    source(type: number, payload?: any) {
      if (type === START) {
        const sink = payload;
        sinks.add(sink);
        sink(START, (t: number) => {
          if (t === DATA) sink(DATA, store.get());
          if (t === END) sinks.delete(sink);
        });
      }
    },
  };

  Inspector.register(store, { kind: 'derived', ...opts });
  return store;
}
