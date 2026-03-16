import { Inspector } from "../core/inspector";
import type { NodeStatus } from "../core/protocol";
import { DATA, DIRTY, END, RESOLVED, START, STATE } from "../core/protocol";
import type { Store } from "../core/types";

/**
 * Splits a source into two based on a predicate. Returns a tuple of
 * `[matching, notMatching]` stores. Values where predicate returns true
 * go to the first store; others go to the second.
 *
 * Both branches share a single upstream subscription (refcounted).
 * Upstream connects when the first branch subscribes, disconnects when
 * the last sink across both branches leaves.
 *
 * Stateful: each branch maintains its own last value via its cached value.
 * get() returns the last value that went to that branch, or undefined.
 *
 * v4: type 3 DIRTY is forwarded to both branches. On DATA, the matching
 * branch receives DATA while the non-matching branch receives RESOLVED
 * (since it was marked dirty but its value didn't change). Both branches
 * receive END when upstream completes. Late subscribers after completion
 * receive END immediately. Unknown STATE signals forwarded for v4
 * forward-compat. _status tracked per branch for Inspector.
 */
export function partition<A>(
	predicate: (value: A) => boolean,
): (input: Store<A>) => [Store<A | undefined>, Store<A | undefined>] {
	return (input: Store<A>) => {
		let trueValue: A | undefined;
		let falseValue: A | undefined;
		let trueStatus: NodeStatus = "DISCONNECTED";
		let falseStatus: NodeStatus = "DISCONNECTED";
		const trueSinks = new Set<(type: number, data?: unknown) => void>();
		const falseSinks = new Set<(type: number, data?: unknown) => void>();
		let talkback: ((type: number) => void) | null = null;
		let connected = false;
		let completed = false;

		function connectUpstream(): void {
			input.source(START, (type: number, data: any) => {
				if (type === START) {
					talkback = data;
					return;
				}
				if (type === STATE) {
					if (data === DIRTY) {
						trueStatus = "DIRTY";
						falseStatus = "DIRTY";
					} else if (data === RESOLVED) {
						trueStatus = "RESOLVED";
						falseStatus = "RESOLVED";
					}
					for (const sink of trueSinks) sink(STATE, data);
					for (const sink of falseSinks) sink(STATE, data);
				}
				if (type === DATA) {
					if (predicate(data)) {
						trueValue = data;
						trueStatus = "SETTLED";
						falseStatus = "RESOLVED";
						for (const sink of trueSinks) sink(DATA, trueValue);
						// Non-matching branch got DIRTY but value didn't change
						for (const sink of falseSinks) sink(STATE, RESOLVED);
					} else {
						falseValue = data;
						falseStatus = "SETTLED";
						trueStatus = "RESOLVED";
						for (const sink of falseSinks) sink(DATA, falseValue);
						// Non-matching branch got DIRTY but value didn't change
						for (const sink of trueSinks) sink(STATE, RESOLVED);
					}
				}
				if (type === END) {
					talkback = null;
					connected = false;
					completed = true;
					if (data !== undefined) {
						trueStatus = "ERRORED";
						falseStatus = "ERRORED";
					} else {
						trueStatus = "COMPLETED";
						falseStatus = "COMPLETED";
					}
					// Snapshot before clearing — prevents reentrancy issues if a
					// sink's END handler causes another sink to unsubscribe.
					const trueSnapshot = [...trueSinks];
					const falseSnapshot = [...falseSinks];
					trueSinks.clear();
					falseSinks.clear();
					for (const sink of trueSnapshot) sink(END, data);
					for (const sink of falseSnapshot) sink(END, data);
				}
			});
		}

		function disconnectUpstream(): void {
			if (talkback) {
				talkback(END);
				talkback = null;
			}
			connected = false;
			trueStatus = "DISCONNECTED";
			falseStatus = "DISCONNECTED";
		}

		function totalSinks(): number {
			return trueSinks.size + falseSinks.size;
		}

		const trueStore: Store<A | undefined> = {
			get() {
				return trueValue;
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					const sink = payload as (type: number, data?: unknown) => void;
					if (completed) {
						sink(START, (_t: number) => {});
						sink(END);
						return;
					}
					const wasEmpty = totalSinks() === 0;
					trueSinks.add(sink);
					if (wasEmpty) {
						connectUpstream();
						connected = true;
					}
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, trueValue);
						if (t === END) {
							trueSinks.delete(sink);
							if (totalSinks() === 0 && connected) {
								disconnectUpstream();
							}
						}
					});
				}
			},
		};

		const falseStore: Store<A | undefined> = {
			get() {
				return falseValue;
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					const sink = payload as (type: number, data?: unknown) => void;
					if (completed) {
						sink(START, (_t: number) => {});
						sink(END);
						return;
					}
					const wasEmpty = totalSinks() === 0;
					falseSinks.add(sink);
					if (wasEmpty) {
						connectUpstream();
						connected = true;
					}
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, falseValue);
						if (t === END) {
							falseSinks.delete(sink);
							if (totalSinks() === 0 && connected) {
								disconnectUpstream();
							}
						}
					});
				}
			},
		};

		// Use defineProperty so _status reads live from closure variables
		Object.defineProperty(trueStore, "_status", {
			get: () => trueStatus,
			enumerable: true,
		});
		Object.defineProperty(falseStore, "_status", {
			get: () => falseStatus,
			enumerable: true,
		});

		Inspector.register(trueStore, { kind: "partition(true)" });
		Inspector.register(falseStore, { kind: "partition(false)" });
		return [trueStore, falseStore];
	};
}
