// ---------------------------------------------------------------------------
// stream(producer) — a store backed by an event source
// ---------------------------------------------------------------------------

import { START, DATA, END } from './types';
import type { Store, StoreOptions, Source, Sink, StreamProducer } from './types';
import { registerRead } from './tracking';
import { register, notifyUpdate } from './registry';
import { defineStore } from './store-utils';

export function stream<T>(
  producer: StreamProducer<T>,
  opts?: StoreOptions & { initial?: T },
): Store<T | undefined> {
  let currentValue: T | undefined = opts?.initial;
  let started = false;
  let cleanup: (() => void) | void;
  const sinks = new Set<Sink<T | undefined>>();
  const subscribers = new Set<
    (value: T | undefined, prev: T | undefined) => void
  >();
  const dependents = new Set<Store<unknown>>();

  function emit(value: T): void {
    const prev = currentValue;
    currentValue = value;
    if (!Object.is(prev, value)) {
      notifyUpdate(store, value, prev);
    }
    for (const sink of sinks) {
      sink(DATA, value);
    }
    for (const cb of subscribers) {
      cb(value, prev);
    }
  }

  function startProducer(): void {
    if (started) return;
    started = true;
    cleanup = producer(emit);
  }

  function stopProducer(): void {
    if (!started) return;
    started = false;
    if (cleanup) cleanup();
  }

  const source: Source<T | undefined> = ((
    type: number,
    payload?: unknown,
  ) => {
    if (type === START) {
      const sink = payload as Sink<T | undefined>;
      sinks.add(sink);

      const talkback = ((t: number) => {
        if (t === DATA) {
          sink(DATA, currentValue);
        }
        if (t === END) {
          sinks.delete(sink);
          if (sinks.size === 0 && subscribers.size === 0) {
            stopProducer();
          }
        }
      }) as Source<T | undefined>;

      sink(START, talkback);
      startProducer();

      if (currentValue !== undefined) {
        sink(DATA, currentValue);
      }
    }
  }) as Source<T | undefined>;

  const store: Store<T | undefined> = defineStore(
    function (this: unknown) {
      registerRead(store);
      return currentValue;
    } as unknown as Store<T | undefined>,
    {
      name: opts?.name,
      kind: 'stream',
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

      subscribe(
        cb: (value: T | undefined, prev: T | undefined) => void,
      ) {
        subscribers.add(cb);
        startProducer();
        return () => {
          subscribers.delete(cb);
          if (sinks.size === 0 && subscribers.size === 0) {
            stopProducer();
          }
        };
      },

      _addDependent(dep: Store<unknown>) {
        dependents.add(dep);
      },

      _removeDependent(dep: Store<unknown>) {
        dependents.delete(dep);
      },

      start() {
        startProducer();
      },

      stop() {
        stopProducer();
      },
    },
  );

  register(store);
  return store;
}
