// ---------------------------------------------------------------------------
// pipe() — connects stores through operators, each step is a store
// ---------------------------------------------------------------------------

import { START, DATA, END } from './types';
import type { Store, StoreOptions, Source, Sink } from './types';
import { registerRead } from './tracking';
import { register, notifyUpdate } from './registry';
import { defineStore } from './store-utils';

/** An operator transforms a store into a new store */
export type StoreOperator<A, B> = (input: Store<A>) => Store<B>;

// ---------------------------------------------------------------------------
// pipe overloads for type inference
// ---------------------------------------------------------------------------

export function pipe<A>(source: Store<A>): Store<A>;
export function pipe<A, B>(source: Store<A>, op1: StoreOperator<A, B>): Store<B>;
export function pipe<A, B, C>(
  source: Store<A>,
  op1: StoreOperator<A, B>,
  op2: StoreOperator<B, C>,
): Store<C>;
export function pipe<A, B, C, D>(
  source: Store<A>,
  op1: StoreOperator<A, B>,
  op2: StoreOperator<B, C>,
  op3: StoreOperator<C, D>,
): Store<D>;
export function pipe<A, B, C, D, E>(
  source: Store<A>,
  op1: StoreOperator<A, B>,
  op2: StoreOperator<B, C>,
  op3: StoreOperator<C, D>,
  op4: StoreOperator<D, E>,
): Store<E>;
export function pipe(
  source: Store<unknown>,
  ...ops: Array<StoreOperator<any, any>>
): Store<unknown>;

export function pipe(
  source: Store<unknown>,
  ...ops: Array<StoreOperator<any, any>>
): Store<unknown> {
  let current = source;
  for (const op of ops) {
    current = op(current);
  }
  return current;
}

// ---------------------------------------------------------------------------
// Helper to create an operator store (reduces boilerplate)
// ---------------------------------------------------------------------------

function operatorStore<A, B>(
  input: Store<A>,
  initialValue: B,
  onUpstream: (
    value: A,
    push: (value: B) => void,
    getCurrentValue: () => B,
  ) => void,
  storeName: string,
): Store<B> {
  let currentValue: B = initialValue;
  const sinks = new Set<Sink<B>>();
  const subscribers = new Set<(value: B, prev: B | undefined) => void>();

  function push(value: B): void {
    const prev = currentValue;
    currentValue = value;
    if (!Object.is(currentValue, prev)) {
      notifyUpdate(store, currentValue, prev);
      for (const sink of sinks) sink(DATA, currentValue);
      for (const cb of subscribers) cb(currentValue, prev);
    }
  }

  input.subscribe((value) => {
    onUpstream(value, push, () => currentValue);
  });

  const source: Source<B> = ((type: number, payload?: unknown) => {
    if (type === START) {
      const sink = payload as Sink<B>;
      sinks.add(sink);
      const talkback = ((t: number) => {
        if (t === DATA) sink(DATA, currentValue);
        if (t === END) sinks.delete(sink);
      }) as Source<B>;
      sink(START, talkback);
      sink(DATA, currentValue);
    }
  }) as Source<B>;

  const store: Store<B> = defineStore(
    function (this: unknown) {
      registerRead(store);
      return currentValue;
    } as unknown as Store<B>,
    {
      name: storeName,
      kind: 'derived',
      source,

      get value() {
        return currentValue;
      },

      get deps() {
        return [input] as ReadonlyArray<Store<unknown>>;
      },

      get subs() {
        return [] as ReadonlyArray<Store<unknown>>;
      },

      subscribe(cb: (value: B, prev: B | undefined) => void) {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
    },
  );

  register(store);
  return store;
}

// ---------------------------------------------------------------------------
// Built-in operators — each produces a new inspectable store
// ---------------------------------------------------------------------------

export function map<A, B>(
  fn: (value: A) => B,
  opts?: StoreOptions,
): StoreOperator<A, B> {
  return (input) => {
    const name = opts?.name ?? `map(${input.name ?? '?'})`;
    return operatorStore(input, fn(input.value), (value, push) => {
      push(fn(value));
    }, name);
  };
}

export function filter<A>(
  predicate: (value: A) => boolean,
  opts?: StoreOptions,
): StoreOperator<A, A> {
  return (input) => {
    const name = opts?.name ?? `filter(${input.name ?? '?'})`;
    return operatorStore(input, input.value, (value, push) => {
      if (predicate(value)) push(value);
    }, name);
  };
}

export function scan<A, B>(
  reducer: (acc: B, value: A) => B,
  seed: B,
  opts?: StoreOptions,
): StoreOperator<A, B> {
  return (input) => {
    const name = opts?.name ?? `scan(${input.name ?? '?'})`;
    return operatorStore(input, seed, (value, push, getCurrent) => {
      push(reducer(getCurrent(), value));
    }, name);
  };
}
