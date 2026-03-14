// ---------------------------------------------------------------------------
// derived(deps, fn) — a computed store with explicit dependencies
// ---------------------------------------------------------------------------
// - .get() always runs fn() — no cached value, always fresh
// - Connects to upstream lazily in source() (on first sink)
// - Disconnects when last sink leaves
// - Propagates DIRTY downstream so effects/subscribers know to re-run
// ---------------------------------------------------------------------------

import { Inspector } from "./inspector";
import { DATA, DIRTY, END, pushDirty, START } from "./protocol";
import type { Store, StoreOptions } from "./types";

export function derived<T>(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>): Store<T> {
	const sinks = new Set<any>();
	let upstreamTalkbacks: Array<(type: number) => void> = [];
	let cachedValue: T | undefined;
	let hasCached = false;
	const eqFn = opts?.equals;

	function connectUpstream(): void {
		upstreamTalkbacks = [];
		for (const dep of deps) {
			dep.source(START, (type: number, data: any) => {
				if (type === START) upstreamTalkbacks.push(data);
				if (type === DATA && data === DIRTY) {
					pushDirty(sinks);
				}
			});
		}
	}

	function disconnectUpstream(): void {
		for (const tb of upstreamTalkbacks) tb(END);
		upstreamTalkbacks = [];
	}

	const store: Store<T> = {
		get() {
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
				if (wasEmpty) connectUpstream();
				sink(START, (t: number) => {
					if (t === DATA) sink(DATA, store.get());
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
