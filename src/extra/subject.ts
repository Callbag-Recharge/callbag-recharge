import { Inspector } from "../core/inspector";
import type { NodeStatus } from "../core/protocol";
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
 * v4: next() sends DIRTY on type 3 then value on type 1. Batching-aware
 * (defers type 1 emissions during batch). No upstream deps — manually driven.
 * Output slot model: null → fn → Set. _status tracked for Inspector.
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
	let _status: NodeStatus = "DISCONNECTED";
	// Output slot: null (no sinks), fn (single), Set (multi)
	let _output: ((type: number, data?: any) => void) | Set<any> | null = null;
	let _multi = false;

	function dispatch(type: number, data?: any): void {
		if (!_output) return;
		if (_multi) {
			for (const sink of _output as Set<any>) sink(type, data);
		} else {
			(_output as (type: number, data?: any) => void)(type, data);
		}
	}

	function hasSinks(): boolean {
		return _output !== null;
	}

	const store: Subject<T> = {
		get() {
			return currentValue;
		},

		next(value: T) {
			if (completed) return;
			if (hasSinks() && Object.is(currentValue, value)) return;
			currentValue = value;
			if (!hasSinks()) return;
			_status = "DIRTY";
			dispatch(STATE, DIRTY);
			// Guard: sinks may have disconnected during DIRTY dispatch
			if (!hasSinks()) return;
			if (isBatching()) {
				deferEmission(() => {
					if (!hasSinks()) return;
					_status = "SETTLED";
					dispatch(DATA, currentValue);
				});
			} else {
				_status = "SETTLED";
				dispatch(DATA, currentValue);
			}
		},

		error(err: unknown) {
			if (completed) return;
			completed = true;
			_status = "ERRORED";
			// Snapshot-free completion: move output ref, null before notify
			const output = _output;
			const wasMulti = _multi;
			_output = null;
			_multi = false;
			if (output) {
				if (wasMulti) {
					for (const sink of output as Set<any>) sink(END, err);
				} else {
					(output as (type: number, data?: any) => void)(END, err);
				}
			}
		},

		complete() {
			if (completed) return;
			completed = true;
			_status = "COMPLETED";
			// Snapshot-free completion: move output ref, null before notify
			const output = _output;
			const wasMulti = _multi;
			_output = null;
			_multi = false;
			if (output) {
				if (wasMulti) {
					for (const sink of output as Set<any>) sink(END);
				} else {
					(output as (type: number, data?: any) => void)(END);
				}
			}
		},

		source(type: number, payload?: unknown) {
			if (type === START) {
				const sink = payload as (type: number, data?: unknown) => void;
				if (completed) {
					sink(START, () => {});
					sink(END);
					return;
				}
				// Output slot transitions: null → SINGLE → MULTI
				if (_output === null) {
					_output = sink;
				} else if (!_multi) {
					const set = new Set<any>();
					set.add(_output);
					set.add(sink);
					_output = set;
					_multi = true;
				} else {
					(_output as Set<any>).add(sink);
				}
				sink(START, (t: number) => {
					if (t === DATA) sink(DATA, currentValue);
					if (t === END) {
						// Remove from output slot
						if (_output === null) return;
						if (_multi) {
							const set = _output as Set<any>;
							set.delete(sink);
							if (set.size === 1) {
								_output = set.values().next().value;
								_multi = false;
							} else if (set.size === 0) {
								_output = null;
								_multi = false;
								_status = "DISCONNECTED";
							}
						} else if (_output === sink) {
							_output = null;
							_status = "DISCONNECTED";
						}
					}
				});
			}
		},
	};

	// Use defineProperty so _status reads live from closure variable
	Object.defineProperty(store, "_status", {
		get: () => _status,
		enumerable: true,
	});

	Inspector.register(store, { kind: "subject" });
	return store;
}
