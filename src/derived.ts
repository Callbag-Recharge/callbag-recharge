// ---------------------------------------------------------------------------
// derived(deps, fn) — computed store with dirty tracking and caching
// ---------------------------------------------------------------------------
// Type 3 DIRTY/RESOLVED for diamond resolution.
// Type 1 DATA carries only real values.
// get(): returns cache when settled, recomputes when pending or unconnected.
// equals: push-phase memoization via RESOLVED (skip entire subtree).
//
// Note: derived is implemented as a standalone primitive rather than on top of
// operator() because it needs a custom get() (pull-fallback recompute when
// unconnected) that operator does not support. Sharing the operator abstraction
// would require either a getOverride hook in operator or double Inspector
// registration, both of which add more complexity than they remove.
// ---------------------------------------------------------------------------

import { Inspector } from "./inspector";
import { DATA, DIRTY, END, RESOLVED, START, STATE } from "./protocol";
import type { Store, StoreOptions } from "./types";

export function derived<T>(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>): Store<T> {
	const sinks = new Set<any>();
	let upstreamTalkbacks: Array<(type: number) => void> = [];
	let cachedValue: T | undefined;
	let hasCached = false;
	let connected = false;
	const dirtyDeps = new Set<number>();
	const eqFn = opts?.equals;
	let anyDataReceived = false;

	function recompute(): void {
		const result = fn();
		if (eqFn && hasCached && eqFn(cachedValue as T, result)) {
			// Value unchanged — send RESOLVED (subtree skipping)
			for (const sink of sinks) sink(STATE, RESOLVED);
			return;
		}
		cachedValue = result;
		hasCached = true;
		for (const sink of sinks) sink(DATA, cachedValue);
	}

	function connectUpstream(): void {
		upstreamTalkbacks = [];
		for (let i = 0; i < deps.length; i++) {
			const depIndex = i;
			deps[depIndex].source(START, (type: number, data: any) => {
				if (type === START) {
					upstreamTalkbacks.push(data);
					return;
				}
				if (type === STATE) {
					if (data === DIRTY) {
						const wasEmpty = dirtyDeps.size === 0;
						dirtyDeps.add(depIndex);
						if (wasEmpty) {
							anyDataReceived = false;
							for (const sink of sinks) sink(STATE, DIRTY);
						}
					} else if (data === RESOLVED) {
						if (dirtyDeps.has(depIndex)) {
							dirtyDeps.delete(depIndex);
							if (dirtyDeps.size === 0) {
								if (anyDataReceived) {
									recompute();
								} else {
									// All deps resolved without value change — skip fn()
									for (const sink of sinks) sink(STATE, RESOLVED);
								}
							}
						}
					}
				}
				if (type === DATA) {
					if (dirtyDeps.has(depIndex)) {
						dirtyDeps.delete(depIndex);
						anyDataReceived = true;
						if (dirtyDeps.size === 0) {
							recompute();
						}
					} else {
						// DATA without prior DIRTY: dep bypasses the control channel
						// (e.g. a raw callbag source). Treat as immediate trigger.
						if (dirtyDeps.size === 0) {
							// No other dirty deps — signal and recompute immediately.
							for (const sink of sinks) sink(STATE, DIRTY);
							recompute();
						} else {
							// Other deps already dirty — mark that real data arrived
							// so we don't skip recompute when they resolve.
							anyDataReceived = true;
						}
					}
				}
			});
		}
	}

	function disconnectUpstream(): void {
		for (const tb of upstreamTalkbacks) tb(END);
		upstreamTalkbacks = [];
		connected = false;
		dirtyDeps.clear();
	}

	const store: Store<T> = {
		get() {
			if (connected && dirtyDeps.size === 0) {
				// Connected + settled — return cache
				return cachedValue as T;
			}
			// Not connected or pending — recompute on demand
			const result = fn();
			if (eqFn && hasCached && eqFn(cachedValue as T, result)) {
				return cachedValue as T;
			}
			if (eqFn) {
				cachedValue = result;
				hasCached = true;
			}
			return result;
		},

		source(type: number, payload?: any) {
			if (type === START) {
				const sink = payload;
				const wasEmpty = sinks.size === 0;
				sinks.add(sink);
				if (wasEmpty) {
					// Compute initial value before connecting upstream
					cachedValue = fn();
					hasCached = true;
					connectUpstream();
					connected = true;
				}
				sink(START, (t: number) => {
					if (t === DATA) sink(DATA, cachedValue);
					if (t === END) {
						sinks.delete(sink);
						if (sinks.size === 0) disconnectUpstream();
					}
				});
			}
		},
	};

	Inspector.register(store, { kind: "derived", ...opts });
	return store;
}
