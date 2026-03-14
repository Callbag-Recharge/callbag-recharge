// ---------------------------------------------------------------------------
// effect(deps, fn) — run side effects when deps change
// ---------------------------------------------------------------------------
// v2: Two-phase push with dirty dep tracking
// - Phase 1 (DIRTY): track dirty deps
// - Phase 2 (value): when all dirty deps resolve, enqueue effect run
// ---------------------------------------------------------------------------

import {
	beginDeferredStart,
	DATA,
	DIRTY,
	END,
	endDeferredStart,
	enqueueEffect,
	START,
} from "./protocol";
import type { Store } from "./types";

export function effect(deps: Store<unknown>[], fn: () => undefined | (() => void)): () => void {
	let cleanupEffect: undefined | (() => void);
	const talkbacks: Array<(type: number) => void> = [];
	let disposed = false;
	const dirtyDeps = new Set<number>();

	function run(): void {
		if (disposed) return;
		dirtyDeps.clear();

		// Cleanup previous effect
		if (cleanupEffect) cleanupEffect();

		cleanupEffect = fn();
	}

	// Initial setup: run fn, then connect to deps
	beginDeferredStart();

	run();

	for (let i = 0; i < deps.length; i++) {
		const depIndex = i;
		deps[depIndex].source(START, (type: number, data: any) => {
			if (type === START) talkbacks.push(data);
			if (type === DATA) {
				if (data === DIRTY) {
					// Phase 1: track dirty dep
					if (!disposed) {
						dirtyDeps.add(depIndex);
					}
				} else {
					// Phase 2: value arrived from dep
					if (dirtyDeps.has(depIndex)) {
						dirtyDeps.delete(depIndex);
						if (dirtyDeps.size === 0 && !disposed) {
							enqueueEffect(run);
						}
					}
				}
			}
		});
	}

	endDeferredStart();

	return () => {
		disposed = true;
		if (cleanupEffect) cleanupEffect();
		for (const tb of talkbacks) tb(END);
	};
}
