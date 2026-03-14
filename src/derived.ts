// ---------------------------------------------------------------------------
// derived(deps, fn) — a computed store with explicit dependencies
// ---------------------------------------------------------------------------
// v2: Two-phase push with caching and dirty dep tracking
// - Phase 1 (DIRTY): track which deps are dirty, forward DIRTY on first
// - Phase 2 (value): wait for all dirty deps, recompute, cache, emit
// - get(): returns cache if settled, recomputes if not connected
// ---------------------------------------------------------------------------

import { Inspector } from "./inspector";
import { DATA, DIRTY, END, START } from "./protocol";
import type { Store, StoreOptions } from "./types";

export function derived<T>(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>): Store<T> {
	const sinks = new Set<any>();
	let upstreamTalkbacks: Array<(type: number) => void> = [];
	let cachedValue: T | undefined;
	let hasCached = false;
	let connected = false;
	const dirtyDeps = new Set<number>();
	const eqFn = opts?.equals;

	function recompute(): void {
		const result = fn();
		if (eqFn && hasCached && eqFn(cachedValue as T, result)) {
			// Value unchanged — keep cached reference
			// Still emit so downstream can resolve their dirty dep counts
			for (const sink of sinks) sink(DATA, cachedValue);
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
				if (type === DATA) {
					if (data === DIRTY) {
						// Phase 1: track dirty dep, forward DIRTY inline on first
						const wasEmpty = dirtyDeps.size === 0;
						dirtyDeps.add(depIndex);
						if (wasEmpty) {
							for (const sink of sinks) sink(DATA, DIRTY);
						}
					} else {
						// Phase 2: value arrived from dep
						if (dirtyDeps.has(depIndex)) {
							dirtyDeps.delete(depIndex);
							if (dirtyDeps.size === 0) {
								// All dirty deps resolved — recompute and emit
								recompute();
							}
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
				// Connected + settled → return cache
				return cachedValue as T;
			}
			// Not connected, or connected but pending — recompute on demand.
			// Pending case: deps' get() recursively resolves (states are always
			// settled, pending deriveds recompute here too). The result is NOT
			// cached — phase 2 will handle proper cache update and sink emission.
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
