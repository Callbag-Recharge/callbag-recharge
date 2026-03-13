// ---------------------------------------------------------------------------
// derived(fn) — a computed store that auto-tracks dependencies
// ---------------------------------------------------------------------------

import { START, DATA, END } from './types';
import type { Store, StoreOptions, Source, Sink } from './types';
import { tracked, registerRead } from './tracking';
import { register, notifyUpdate } from './registry';
import { defineStore } from './store-utils';

export function derived<T>(fn: () => T, opts?: StoreOptions): Store<T> {
  let currentValue: T;
  let trackedDeps = new Set<Store<unknown>>();
  let depUnsubs: Array<() => void> = [];
  const sinks = new Set<Sink<T>>();
  const subscribers = new Set<(value: T, prev: T | undefined) => void>();
  let storeRef: Store<T> | null = null;
  let notifying = false;

  function compute(): T {
    const [result, newDeps] = tracked(fn);
    trackedDeps = newDeps;
    return result;
  }

  function teardownSubs(): void {
    for (const unsub of depUnsubs) unsub();
    depUnsubs = [];
  }

  function setupSubscriptions(): void {
    teardownSubs();

    for (const dep of trackedDeps) {
      if (storeRef && '_addDependent' in dep) {
        (dep as any)._addDependent(storeRef);
      }
      const unsub = dep.subscribe(() => {
        // Guard against re-entrant notifications
        if (notifying) return;

        const prev = currentValue;
        currentValue = compute();

        if (!Object.is(currentValue, prev)) {
          notifying = true;
          if (storeRef) notifyUpdate(storeRef, currentValue, prev);
          for (const sink of sinks) {
            sink(DATA, currentValue);
          }
          for (const cb of subscribers) {
            cb(currentValue, prev);
          }
          notifying = false;
        }
      });
      depUnsubs.push(() => {
        unsub();
        if (storeRef && '_removeDependent' in dep) {
          (dep as any)._removeDependent(storeRef);
        }
      });
    }
  }

  // Initial computation
  currentValue = compute();

  const source: Source<T> = ((type: number, payload?: unknown) => {
    if (type === START) {
      const sink = payload as Sink<T>;
      sinks.add(sink);

      const talkback = ((t: number) => {
        if (t === DATA) {
          sink(DATA, currentValue);
        }
        if (t === END) {
          sinks.delete(sink);
        }
      }) as Source<T>;

      sink(START, talkback);
      sink(DATA, currentValue);
    }
  }) as Source<T>;

  const store: Store<T> = defineStore(
    function (this: unknown) {
      registerRead(store);
      return currentValue;
    } as unknown as Store<T>,
    {
      name: opts?.name,
      kind: 'derived',
      source,

      get value() {
        return currentValue;
      },

      get deps() {
        return Array.from(trackedDeps);
      },

      get subs() {
        return [] as ReadonlyArray<Store<unknown>>;
      },

      subscribe(cb: (value: T, prev: T | undefined) => void) {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
    },
  );

  storeRef = store;
  setupSubscriptions();
  register(store);
  return store;
}
