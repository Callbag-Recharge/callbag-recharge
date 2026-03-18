import { Inspector } from "../core/inspector";
import type { NodeStatus } from "../core/protocol";
import { DATA, DIRTY, deferEmission, END, isBatching, START, STATE } from "../core/protocol";
import type { Store } from "../core/types";

/** Manual multicast source: `next` / `error` / `complete` drive the stream. */
export interface Subject<T> extends Store<T | undefined> {
	next(value: T): void;
	error(err: unknown): void;
	complete(): void;
}

/**
 * Creates a `Subject` — imperative push API plus `get()` / `source()` like any store.
 *
 * @returns `Subject<T>` with `next`, `error`, `complete`, batch-aware emissions, and optional dedup when sinks exist.
 *
 * @remarks **Dedup:** `Object.is` guard on `next` applies only while subscribers are connected.
 *
 * @category extra
 */
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
