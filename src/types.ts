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

/** Actions API for producer and operator init functions */
export type Actions<T> = {
	emit: (value: T) => void;
	signal: (s: Signal) => void;
	complete: () => void;
	error: (e: unknown) => void;
	disconnect: (dep?: number) => void;
};

export type StoreOperator<A, B> = (input: Store<A>) => Store<B>;
