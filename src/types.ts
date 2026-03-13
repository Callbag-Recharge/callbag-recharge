// ---------------------------------------------------------------------------
// Minimal store types — stores are plain objects
// ---------------------------------------------------------------------------

/** Read-only store */
export interface Store<T> {
  get(): T;
  source: (type: number, payload?: any) => void;
}

/** Writable store */
export interface WritableStore<T> extends Store<T> {
  set(value: T): void;
  update(fn: (current: T) => T): void;
}

/** Stream store — may support .pull() */
export interface StreamStore<T> extends Store<T | undefined> {
  /** Request the producer to emit the next value.
   *  Throws if the producer is not pullable. */
  pull(): void;
}

export interface StoreOptions {
  name?: string;
}

/**
 * Stream producer function.
 * @param emit  — push a value downstream
 * @param request — register a pull handler (makes the stream pullable)
 * @returns optional cleanup function
 */
export interface StreamProducer<T> {
  (
    emit: (value: T) => void,
    request: (handler: () => void) => void,
  ): (() => void) | void;
}

export type StoreOperator<A, B> = (input: Store<A>) => Store<B>;
