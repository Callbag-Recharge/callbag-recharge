// ---------------------------------------------------------------------------
// Callbag protocol types
// ---------------------------------------------------------------------------

/** Callbag signal types */
export const START = 0;
export const DATA = 1;
export const END = 2;

export type StartType = typeof START;
export type DataType = typeof DATA;
export type EndType = typeof END;

/** A callbag: the universal primitive of the spec */
export type Callbag<I, O> = {
  (type: StartType, payload: Callbag<O, I>): void;
  (type: DataType, payload: I): void;
  (type: EndType, payload?: unknown): void;
};

export type Source<T> = Callbag<void, T>;
export type Sink<T> = Callbag<T, void>;
export type Operator<A, B> = (source: Source<A>) => Source<B>;

// ---------------------------------------------------------------------------
// Store types
// ---------------------------------------------------------------------------

export interface StoreOptions {
  /** Name for debugging / observability */
  name?: string;
}

/** Read-only store — the fundamental reactive primitive */
export interface Store<T> {
  /** Read current value (also registers dependency when inside a tracked context) */
  (): T;

  /** Current value without tracking */
  readonly value: T;

  /** Debug name */
  readonly name: string | undefined;

  /** What kind of store this is */
  readonly kind: 'state' | 'derived' | 'stream';

  /** Stores that feed into this one */
  readonly deps: ReadonlyArray<Store<unknown>>;

  /** Stores that read from this one */
  readonly subs: ReadonlyArray<Store<unknown>>;

  /** Subscribe to value changes */
  subscribe(cb: (value: T, prev: T | undefined) => void): () => void;

  /** The underlying callbag source (for interop / piping) */
  readonly source: Source<T>;
}

/** A store you can write to */
export interface WritableStore<T> extends Store<T> {
  readonly kind: 'state';
  set(value: T): void;
  update(fn: (current: T) => T): void;
}

/** Info returned by inspect() */
export interface StoreInfo<T = unknown> {
  name: string | undefined;
  kind: Store<T>['kind'];
  value: T;
  deps: string[];
  subs: string[];
}

/** Producer for stream stores */
export interface StreamProducer<T> {
  (
    emit: (value: T) => void,
    onRequest?: (pull: () => void) => void,
  ): (() => void) | void;
}
