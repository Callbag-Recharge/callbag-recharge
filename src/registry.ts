// ---------------------------------------------------------------------------
// Global store registry — powers inspect(), graph(), and observability
// ---------------------------------------------------------------------------

import type { Store, StoreInfo } from './types';

const allStores = new Set<Store<unknown>>();

type StoreEvent = {
  type: 'create' | 'update' | 'subscribe' | 'dispose';
  store: Store<unknown>;
  value?: unknown;
  prev?: unknown;
};

type Observer = (event: StoreEvent) => void;
const observers = new Set<Observer>();

export function register(store: Store<unknown>): void {
  allStores.add(store);
  notify({ type: 'create', store, value: store.value });
}

export function unregister(store: Store<unknown>): void {
  allStores.delete(store);
  notify({ type: 'dispose', store });
}

export function notifyUpdate(
  store: Store<unknown>,
  value: unknown,
  prev: unknown,
): void {
  notify({ type: 'update', store, value, prev });
}

function notify(event: StoreEvent): void {
  for (const obs of observers) {
    obs(event);
  }
}

/** Inspect a single store */
export function inspect<T>(store: Store<T>): StoreInfo<T> {
  return {
    name: store.name,
    kind: store.kind,
    value: store.value,
    deps: store.deps.map((d) => d.name ?? '(anonymous)'),
    subs: store.subs.map((s) => s.name ?? '(anonymous)'),
  };
}

/** Get the entire reactive graph */
export function graph(): Map<string, StoreInfo> {
  const result = new Map<string, StoreInfo>();
  let i = 0;
  for (const store of allStores) {
    const key = store.name ?? `store_${i++}`;
    result.set(key, inspect(store));
  }
  return result;
}

/** Observe all store events globally */
export function observe(cb: Observer): () => void {
  observers.add(cb);
  return () => observers.delete(cb);
}

/** Trace a specific store's changes */
export function trace<T>(
  store: Store<T>,
  cb: (value: T, prev: T | undefined) => void,
): () => void {
  return store.subscribe(cb);
}
