// ---------------------------------------------------------------------------
// state(initial) — a writable store
// ---------------------------------------------------------------------------

import type { WritableStore, StoreOptions } from './types';
import { START, DATA, END, DIRTY, pushDirty } from './protocol';
import { registerRead } from './tracking';
import { Inspector } from './inspector';

export function state<T>(initial: T, opts?: StoreOptions): WritableStore<T> {
  let currentValue = initial;
  const sinks = new Set<any>();

  const store: WritableStore<T> = {
    get() {
      registerRead(store);
      return currentValue;
    },

    set(value: T) {
      if (Object.is(currentValue, value)) return;
      currentValue = value;
      pushDirty(sinks);
    },

    update(fn: (current: T) => T) {
      store.set(fn(currentValue));
    },

    source(type: number, payload?: any) {
      if (type === START) {
        const sink = payload;
        sinks.add(sink);
        // Send talkback — supports pull (type 1) and disconnect (type 2)
        sink(START, (t: number) => {
          if (t === DATA) sink(DATA, currentValue);
          if (t === END) sinks.delete(sink);
        });
      }
    },
  };

  Inspector.register(store, { kind: 'state', ...opts });
  return store;
}
