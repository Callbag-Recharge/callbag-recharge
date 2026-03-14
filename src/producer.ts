// ---------------------------------------------------------------------------
// producer(fn?, opts?) — general-purpose source primitive
// ---------------------------------------------------------------------------
// Can emit values, send control signals, and complete.
// Lazy start: producer function runs on first sink connection.
// Auto-cleanup: producer cleanup runs when last sink disconnects.
// autoDirty (default true): emit() sends signal(DIRTY) before the value.
// ---------------------------------------------------------------------------

import { Inspector } from "./inspector";
import type { Signal } from "./protocol";
import { DATA, DIRTY, deferEmission, deferStart, END, isBatching, START, STATE } from "./protocol";
import type { ProducerStore, StoreOptions } from "./types";

export function producer<T>(
	fn?: (actions: {
		emit: (value: T) => void;
		signal: (s: Signal) => void;
		complete: () => void;
	}) => (() => void) | undefined,
	opts?: StoreOptions<T> & { initial?: T; autoDirty?: boolean },
): ProducerStore<T> {
	let currentValue: T | undefined = opts?.initial;
	let started = false;
	let completed = false;
	let cleanup: (() => void) | undefined;
	const sinks = new Set<any>();
	const autoDirty = opts?.autoDirty !== false;
	let pendingEmission = false;

	function doEmit(value: T): void {
		if (completed) return;
		currentValue = value;
		if (sinks.size === 0) return;
		if (isBatching()) {
			// Coalesce: send DIRTY and register deferred DATA only once per batch cycle.
			// Subsequent emit() calls just update currentValue; the deferred closure
			// reads it at drain time, so only the latest value is emitted.
			if (!pendingEmission) {
				pendingEmission = true;
				if (autoDirty) {
					for (const sink of sinks) sink(STATE, DIRTY);
				}
				deferEmission(() => {
					pendingEmission = false;
					for (const sink of sinks) sink(DATA, currentValue);
				});
			}
		} else {
			if (autoDirty) {
				for (const sink of sinks) sink(STATE, DIRTY);
			}
			for (const sink of sinks) sink(DATA, currentValue);
		}
	}

	function doSignal(s: Signal): void {
		if (completed) return;
		for (const sink of sinks) sink(STATE, s);
	}

	function doComplete(): void {
		if (completed) return;
		completed = true;
		for (const sink of sinks) sink(END);
		sinks.clear();
		stopProducer();
	}

	function startProducer(): void {
		if (started || !fn) return;
		started = true;
		const result = fn({ emit: doEmit, signal: doSignal, complete: doComplete });
		cleanup = typeof result === "function" ? result : undefined;
	}

	function stopProducer(): void {
		if (!started) return;
		started = false;
		if (cleanup) cleanup();
		cleanup = undefined;
	}

	const store: ProducerStore<T> = {
		get() {
			return currentValue;
		},

		emit: doEmit,
		signal: doSignal,
		complete: doComplete,

		source(type: number, payload?: any) {
			if (type === START) {
				const sink = payload;
				if (completed) {
					sink(START, (_t: number) => {});
					sink(END);
					return;
				}
				sinks.add(sink);
				sink(START, (t: number) => {
					if (t === DATA) sink(DATA, currentValue);
					if (t === END) {
						sinks.delete(sink);
						if (sinks.size === 0) stopProducer();
					}
				});
				deferStart(startProducer);
			}
		},
	};

	Inspector.register(store, { kind: "producer", ...opts });
	return store;
}
