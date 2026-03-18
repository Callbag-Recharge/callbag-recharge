import { Inspector } from "../core/inspector";
import type { NodeStatus } from "../core/protocol";
import {
	beginDeferredStart,
	DATA,
	DIRTY,
	END,
	endDeferredStart,
	RESOLVED,
	START,
	STATE,
} from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Mirrors upstream until the notifier becomes dirty, then completes and tears down input (Tier 1-style wiring).
 *
 * @param notifier - First DIRTY from notifier ends the stream (before notifier DATA in the same batch).
 *
 * @returns `StoreOperator<A, A>` — frozen last value after completion.
 *
 * @category extra
 */
export function takeUntil<A>(notifier: Store<unknown>): StoreOperator<A, A> {
	return (input: Store<A>) => {
		let frozenValue: A | undefined;
		let completed = false;
		let _status: NodeStatus = "DISCONNECTED";
		// Output slot: null (no sinks), fn (single), Set (multi)
		let _output: ((type: number, data?: any) => void) | Set<any> | null = null;
		let _multi = false;
		let started = false;
		let inputTalkback: ((type: number) => void) | null = null;
		let notifierTalkback: ((type: number) => void) | null = null;

		function dispatch(type: number, data?: any): void {
			if (!_output) return;
			if (_multi) {
				for (const sink of _output as Set<any>) sink(type, data);
			} else {
				(_output as (type: number, data?: any) => void)(type, data);
			}
		}

		function doComplete(endData?: unknown) {
			if (completed) return;
			frozenValue = input.get();
			completed = true;
			_status = endData !== undefined ? "ERRORED" : "COMPLETED";
			if (inputTalkback) {
				inputTalkback(END);
				inputTalkback = null;
			}
			if (notifierTalkback) {
				notifierTalkback(END);
				notifierTalkback = null;
			}
			started = false;
			// Snapshot-free completion: move output ref, null before notify
			const output = _output;
			const wasMulti = _multi;
			_output = null;
			_multi = false;
			if (output) {
				if (wasMulti) {
					for (const sink of output as Set<any>) sink(END, endData);
				} else {
					(output as (type: number, data?: any) => void)(END, endData);
				}
			}
		}

		function start() {
			if (started) return;
			started = true;

			beginDeferredStart();

			// Input: raw callbag — forwards STATE and DATA to downstream sinks
			input.source(START, (type: number, data: unknown) => {
				if (type === START) {
					inputTalkback = data as (type: number) => void;
					return;
				}
				if (completed) return;
				if (type === STATE) {
					if (data === DIRTY) _status = "DIRTY";
					else if (data === RESOLVED) _status = "RESOLVED";
					dispatch(STATE, data);
				}
				if (type === DATA) {
					_status = "SETTLED";
					dispatch(DATA, data);
				}
				if (type === END) {
					inputTalkback = null;
					doComplete(data);
				}
			});

			// Notifier: raw callbag so STATE(DIRTY) is detected in-band during
			// DIRTY propagation, before type 1 DATA emissions flush in the same batch.
			notifier.source(START, (type: number, data: unknown) => {
				if (type === START) notifierTalkback = data as (type: number) => void;
				if (type === STATE && data === DIRTY) doComplete();
				if (type === END) notifierTalkback = null;
			});

			endDeferredStart();
		}

		const store: Store<A> = {
			get() {
				return completed ? (frozenValue as A) : input.get();
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
					if (!started) start();
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, store.get());
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
								}
							} else if (_output === sink) {
								_output = null;
							}
							if (_output === null && !completed) {
								if (inputTalkback) {
									inputTalkback(END);
									inputTalkback = null;
								}
								if (notifierTalkback) {
									notifierTalkback(END);
									notifierTalkback = null;
								}
								started = false;
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

		Inspector.register(store, { kind: "takeUntil" });
		return store;
	};
}
