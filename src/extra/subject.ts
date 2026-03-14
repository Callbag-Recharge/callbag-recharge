import { Inspector } from "../inspector";
import { DATA, END, pushChange, START } from "../protocol";
import type { Store } from "../types";

/**
 * Multicast primitive. A subject is both a source and a manual emitter.
 * `next(value)` pushes to all current sinks. `complete()` sends END to all.
 * Tests verify all sinks are removed on completion/error.
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
			if (sinks.size > 0) pushChange(sinks, () => currentValue);
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
