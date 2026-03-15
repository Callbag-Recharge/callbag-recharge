/**
 * General-purpose source primitive. Can emit values, send control signals,
 * complete, and error. Lazy start on first sink, auto-cleanup on last
 * sink disconnect.
 *
 * Stateful: maintains currentValue. get() returns currentValue (or
 * getter(currentValue) when getter option is provided).
 *
 * v3: autoDirty (default true) sends DIRTY on type 3 before each type 1
 * DATA. equals option guards emit(); resetOnTeardown resets value on stop.
 */

import { Inspector } from "./inspector";
import type { Signal } from "./protocol";
import { DATA, DIRTY, deferEmission, deferStart, END, isBatching, START, STATE } from "./protocol";
import type { ProducerStore, StoreOptions } from "./types";

export function producer<T>(
	fn?: (actions: {
		emit: (value: T) => void;
		signal: (s: Signal) => void;
		complete: () => void;
		error: (e: unknown) => void;
	}) => (() => void) | undefined,
	opts?: StoreOptions<T> & {
		initial?: T;
		autoDirty?: boolean;
		resetOnTeardown?: boolean;
		getter?: (cached: T | undefined) => T;
		_skipInspect?: boolean;
	},
): ProducerStore<T> {
	let currentValue: T | undefined = opts?.initial;
	let started = false;
	let completed = false;
	let cleanup: (() => void) | undefined;
	const sinks = new Set<any>();
	const autoDirty = opts?.autoDirty !== false;
	const eqFn = opts?.equals;
	const getterFn = opts?.getter;
	const resetOnTeardown = opts?.resetOnTeardown === true;
	let pendingEmission = false;

	function doEmit(value: T): void {
		if (completed) return;
		if (eqFn && currentValue !== undefined && eqFn(currentValue as T, value)) return;
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

	function doError(e: unknown): void {
		if (completed) return;
		completed = true;
		for (const sink of sinks) sink(END, e);
		sinks.clear();
		stopProducer();
	}

	function startProducer(): void {
		if (started || !fn) return;
		started = true;
		const result = fn({
			emit: doEmit,
			signal: doSignal,
			complete: doComplete,
			error: doError,
		});
		cleanup = typeof result === "function" ? result : undefined;
	}

	function stopProducer(): void {
		if (!started) return;
		started = false;
		if (cleanup) cleanup();
		cleanup = undefined;
		if (resetOnTeardown) currentValue = opts?.initial;
	}

	const store: ProducerStore<T> = {
		get() {
			return getterFn ? getterFn(currentValue) : currentValue;
		},

		emit: doEmit,
		signal: doSignal,
		complete: doComplete,
		error: doError,

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

	if (!opts?._skipInspect) Inspector.register(store, { kind: "producer", ...opts });
	return store;
}
