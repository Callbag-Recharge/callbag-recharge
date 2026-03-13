// ---------------------------------------------------------------------------
// derived(fn) — a computed store, no cache, always pulls fresh
// ---------------------------------------------------------------------------
// - .get() always runs fn() — no cached value, always fresh
// - Connects to upstream lazily (on first .get())
// - Propagates DIRTY downstream so effects/subscribers know to re-run
// ---------------------------------------------------------------------------

import { Inspector } from "./inspector";
import { DATA, DIRTY, END, pushDirty, START } from "./protocol";
import { registerRead, tracked } from "./tracking";
import type { Store, StoreOptions } from "./types";

function sameSet(a: Set<unknown>, b: Set<unknown>): boolean {
	if (a.size !== b.size) return false;
	for (const item of a) {
		if (!b.has(item)) return false;
	}
	return true;
}

export function derived<T>(fn: () => T, opts?: StoreOptions<T>): Store<T> {
	const sinks = new Set<any>();
	let upstreamTalkbacks: Array<(type: number) => void> = [];
	let currentDeps = new Set<Store<unknown>>();
	let cachedValue: T | undefined;
	let hasCached = false;
	const eqFn = opts?.equals;

	function connectUpstream(deps: Set<Store<unknown>>): void {
		if (sameSet(currentDeps, deps)) return;

		// Disconnect old
		for (const tb of upstreamTalkbacks) tb(END);
		upstreamTalkbacks = [];
		currentDeps = deps;

		// Connect new
		for (const dep of deps) {
			dep.source(START, (type: number, data: any) => {
				if (type === START) upstreamTalkbacks.push(data);
				if (type === DATA && data === DIRTY) {
					pushDirty(sinks);
				}
			});
		}
	}

	const store: Store<T> = {
		get() {
			registerRead(store);
			const [result, newDeps] = tracked(fn);
			connectUpstream(newDeps);
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
				sinks.add(sink);
				sink(START, (t: number) => {
					if (t === DATA) sink(DATA, store.get());
					if (t === END) sinks.delete(sink);
				});
			}
		},
	};

	Inspector.register(store, { kind: "derived", ...opts });
	return store;
}
