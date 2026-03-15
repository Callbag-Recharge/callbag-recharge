import { Inspector } from "../core/inspector";
import { DATA, DIRTY, deferEmission, END, isBatching, START, STATE } from "../core/protocol";
import type { Store } from "../core/types";

/**
 * Multicast primitive. A subject is both a source and a manual emitter.
 * `next(value)` pushes to all current sinks. `complete()` sends END to all.
 *
 * Stateful: maintains currentValue. get() returns the last value passed
 * to next(), or undefined before first emission. Object.is dedup on next()
 * only when sinks are connected (matches original semantics — values set
 * without sinks are always accepted).
 *
 * v3: next() sends DIRTY on type 3 then value on type 1. Batching-aware
 * (defers type 1 emissions during batch). No upstream deps — manually driven.
 *
 * Note: subject cannot use producer() because producer's equals guard runs
 * unconditionally (whenever _value !== undefined), while subject only deduplicates
 * when sinks are connected. This semantic difference requires manual implementation.
 */
export interface Subject<T> extends Store<T | undefined> {
	next(value: T): void;
	error(err: unknown): void;
	complete(): void;
}

export function subject<T>(): Subject<T> {
	let currentValue: T | undefined;
	let completed = false;
	const sinks = new Set<(type: number, data?: unknown) => void>();

	const store: Subject<T> = {
		get() {
			return currentValue;
		},

		next(value: T) {
			if (completed) return;
			if (sinks.size > 0 && Object.is(currentValue, value)) return;
			currentValue = value;
			if (sinks.size === 0) return;
			for (const sink of sinks) sink(STATE, DIRTY);
			if (isBatching()) {
				deferEmission(() => {
					for (const sink of sinks) sink(DATA, currentValue);
				});
			} else {
				for (const sink of sinks) sink(DATA, currentValue);
			}
		},

		error(err: unknown) {
			if (completed) return;
			completed = true;
			const snapshot = [...sinks];
			sinks.clear();
			for (const sink of snapshot) sink(END, err);
		},

		complete() {
			if (completed) return;
			completed = true;
			const snapshot = [...sinks];
			sinks.clear();
			for (const sink of snapshot) sink(END);
		},

		source(type: number, payload?: unknown) {
			if (type === START) {
				const sink = payload as (type: number, data?: unknown) => void;
				if (completed) {
					sink(START, () => {});
					sink(END);
					return;
				}
				sinks.add(sink);
				sink(START, (t: number) => {
					if (t === DATA) sink(DATA, currentValue);
					if (t === END) {
						sinks.delete(sink);
					}
				});
			}
		},
	};

	Inspector.register(store, { kind: "subject" });
	return store;
}
