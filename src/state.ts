// ---------------------------------------------------------------------------
// state(initialValue) — a writable store
// ---------------------------------------------------------------------------

import { START, DATA, END } from './types';
import type {
  WritableStore,
  Store,
  StoreOptions,
  Source,
  Sink,
} from './types';
import { registerRead } from './tracking';
import { register, notifyUpdate } from './registry';
import { defineStore } from './store-utils';

export function state<T>(initial: T, opts?: StoreOptions): WritableStore<T> {
  let currentValue = initial;
  const sinks = new Set<Sink<T>>();
  const subscribers = new Set<(value: T, prev: T | undefined) => void>();
  const dependents = new Set<Store<unknown>>();

  // The callbag source: sinks greet us, we push data to them
  const source: Source<T> = ((type: number, payload?: unknown) => {
    if (type === START) {
      const sink = payload as Sink<T>;
      sinks.add(sink);

      // Greet back with a talkback
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

  // We need a level of indirection because `store` is referenced in the read fn
  const store: WritableStore<T> = defineStore(
    function (this: unknown) {
      registerRead(store);
      return currentValue;
    } as unknown as WritableStore<T>,
    {
      name: opts?.name,
      kind: 'state',
      source,

      get value() {
        return currentValue;
      },

      get deps() {
        return [] as ReadonlyArray<Store<unknown>>;
      },

      get subs() {
        return Array.from(dependents);
      },

      subscribe(cb: (value: T, prev: T | undefined) => void) {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },

      set(value: T) {
        if (Object.is(currentValue, value)) return;
        const prev = currentValue;
        currentValue = value;
        notifyUpdate(store, value, prev);
        // Snapshot before iterating — subscribers may add/remove during notification
        for (const sink of Array.from(sinks)) {
          sink(DATA, value);
        }
        for (const cb of Array.from(subscribers)) {
          cb(value, prev);
        }
      },

      update(fn: (current: T) => T) {
        store.set(fn(currentValue));
      },

      _addDependent(dep: Store<unknown>) {
        dependents.add(dep);
      },

      _removeDependent(dep: Store<unknown>) {
        dependents.delete(dep);
      },
    },
  );

  register(store);
  return store;
}
