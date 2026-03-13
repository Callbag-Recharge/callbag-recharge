// ---------------------------------------------------------------------------
// stream(producer) — a store backed by an event source
// ---------------------------------------------------------------------------
// Push-based: producer calls emit() on its own schedule
// Pull-based: producer calls request(handler), .pull() invokes the handler
// ---------------------------------------------------------------------------

import type { StreamStore, StoreOptions, StreamProducer } from './types';
import { START, DATA, END, DIRTY, pushDirty } from './protocol';
import { registerRead } from './tracking';
import { Inspector } from './inspector';

export function stream<T>(
  producer: StreamProducer<T>,
  opts?: StoreOptions & { initial?: T },
): StreamStore<T> {
  let currentValue: T | undefined = opts?.initial;
  let started = false;
  let cleanup: (() => void) | void;
  let pullHandler: (() => void) | null = null;
  const sinks = new Set<any>();

  function emit(value: T): void {
    if (Object.is(currentValue, value)) return;
    currentValue = value;
    pushDirty(sinks);
  }

  function request(handler: () => void): void {
    pullHandler = handler;
  }

  function startProducer(): void {
    if (started) return;
    started = true;
    cleanup = producer(emit, request);
  }

  function stopProducer(): void {
    if (!started) return;
    started = false;
    if (cleanup) cleanup();
  }

  const store: StreamStore<T> = {
    get() {
      registerRead(store);
      return currentValue;
    },

    pull() {
      if (!pullHandler) {
        throw new Error(
          `Store${opts?.name ? ` "${opts.name}"` : ''} is not pullable. ` +
          'The producer must call request(handler) to enable pulling.',
        );
      }
      pullHandler();
    },

    source(type: number, payload?: any) {
      if (type === START) {
        const sink = payload;
        sinks.add(sink);
        sink(START, (t: number) => {
          if (t === DATA) sink(DATA, currentValue);
          if (t === END) {
            sinks.delete(sink);
            if (sinks.size === 0) stopProducer();
          }
        });
        startProducer();
      }
    },
  };

  Inspector.register(store, { kind: 'stream', ...opts });
  return store;
}
