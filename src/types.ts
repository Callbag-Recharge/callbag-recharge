// ---------------------------------------------------------------------------
// Minimal store types — stores are plain objects
// ---------------------------------------------------------------------------

import type { Signal } from "./protocol";

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

/** Producer store — general-purpose source with emit/signal/complete/error */
export interface ProducerStore<T> extends Store<T | undefined> {
	emit(value: T): void;
	signal(s: Signal): void;
	complete(): void;
	error(e: unknown): void;
}

export interface StoreOptions<T = unknown> {
	name?: string;
	equals?: (a: T, b: T) => boolean;
}

// ---------------------------------------------------------------------------
// Shared options for store primitives (producer, operator)
//
// Precedence flow for get():
//   1. If `getter` is defined AND the store is disconnected (no sinks):
//      → getter(cached) is called, result is cached in _value, returned.
//      This provides pull-based recompute when not subscribed.
//   2. Otherwise: return _value (last emitted/seeded value).
//
// Precedence flow for teardown (last sink disconnects):
//   1. `resetOnTeardown: true` → _value is reset to `initial`.
//   2. getter on next get() will recompute from deps, overriding the reset.
//      This is intentional: resetOnTeardown clears the cache so get()
//      returns initial (or undefined) immediately after teardown, while
//      getter re-derives on the next pull.
// ---------------------------------------------------------------------------

/**
 * Options shared by producer() and operator() — the two source primitives.
 * Extends user-facing StoreOptions (name, equals) with internal behavior.
 */
export interface SourceOptions<T = unknown> extends StoreOptions<T> {
	/** Baseline value before first emission. Reset target for resetOnTeardown. */
	initial?: T;
	/**
	 * Pull-based get() when disconnected. Called with current _value,
	 * result is cached back into _value. Only runs when no sinks are connected.
	 */
	getter?: (cached: T | undefined) => T;
	/** Reset _value to `initial` when last sink disconnects. */
	resetOnTeardown?: boolean;
	/**
	 * Allow re-subscription after completion/error when no sinks remain.
	 * Matches RxJS/callbag semantics where re-subscribing re-executes the
	 * source factory. Used by retry/rescue/repeat to restart upstream sources.
	 */
	resubscribable?: boolean;
	/** Inspector kind override (default: "producer" or "operator"). */
	kind?: string;
}

/** Actions API for producer and operator init functions */
export type Actions<T> = {
	/** Set _value and push DATA to all sinks. */
	emit: (value: T) => void;
	/** Set _value without pushing DATA. Safe to call during init. */
	seed: (value: T) => void;
	/** Push a Signal (DIRTY/RESOLVED) on the STATE channel. */
	signal: (s: Signal) => void;
	/** Send END to all sinks, mark completed. */
	complete: () => void;
	/** Send END with error payload to all sinks, mark completed. */
	error: (e: unknown) => void;
	/** Disconnect one or all upstream deps by sending END on their talkbacks. */
	disconnect: (dep?: number) => void;
};

export type StoreOperator<A, B> = (input: Store<A>) => Store<B>;
