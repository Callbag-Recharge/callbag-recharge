import { Inspector } from "../inspector";
import { DATA, DIRTY, END, START } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Filters out consecutive duplicate values using the provided equality
 * function (default: Object.is). When the upstream value hasn't changed,
 * emits the cached value to resolve downstream dirty deps without
 * triggering further computation (downstream subscribe dedup handles it).
 *
 * Raw-callbag two-phase node: forwards DIRTY in phase 1, checks equality
 * and emits in phase 2. Glitch-free in diamond topologies.
 */
export function distinctUntilChanged<A>(eq?: (a: A, b: A) => boolean): StoreOperator<A, A> {
	const eqFn = eq ?? Object.is;
	return (input: Store<A>) => {
		let currentValue: A = input.get();
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let connected = false;
		let talkback: ((type: number) => void) | null = null;
		let dirty = false;

		function connectUpstream(): void {
			currentValue = input.get();
			input.source(START, (type: number, data: any) => {
				if (type === START) {
					talkback = data;
					return;
				}
				if (type === DATA) {
					if (data === DIRTY) {
						if (!dirty) {
							dirty = true;
							for (const sink of sinks) sink(DATA, DIRTY);
						}
					} else if (dirty) {
						dirty = false;
						if (!eqFn(currentValue, data as A)) {
							currentValue = data as A;
						}
						// Always emit (possibly cached) to resolve downstream dirty deps
						for (const sink of sinks) sink(DATA, currentValue);
					}
				}
				if (type === END) {
					talkback = null;
					connected = false;
					dirty = false;
					for (const sink of sinks) sink(END, data);
				}
			});
		}

		function disconnectUpstream(): void {
			if (talkback) {
				talkback(END);
				talkback = null;
			}
			connected = false;
			dirty = false;
		}

		const store: Store<A> = {
			get() {
				// Delegate to input when not active so get() is always live
				return connected ? currentValue : input.get();
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					const sink = payload as (type: number, data?: unknown) => void;
					const wasEmpty = sinks.size === 0;
					sinks.add(sink);
					if (wasEmpty) {
						connectUpstream();
						connected = true;
					}
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, currentValue);
						if (t === END) {
							sinks.delete(sink);
							if (sinks.size === 0 && connected) {
								disconnectUpstream();
							}
						}
					});
				}
			},
		};

		Inspector.register(store, { kind: "distinctUntilChanged" });
		return store;
	};
}
