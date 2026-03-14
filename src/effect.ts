// ---------------------------------------------------------------------------
// effect(deps, fn) — run side effects when deps change
// ---------------------------------------------------------------------------
// Connects once to all deps on creation. When DIRTY arrives, schedules
// re-run after propagation completes. Uses beginDeferredStart/endDeferredStart
// so that stream producers only start after all deps are connected.
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
	let pending = false;

	function run(): void {
		if (disposed) return;
		pending = false;

		// Cleanup previous effect
		if (cleanupEffect) cleanupEffect();

		cleanupEffect = fn();
	}

	// Initial setup: run fn, then connect to deps
	beginDeferredStart();

	run();

	for (const dep of deps) {
		dep.source(START, (type: number, data: any) => {
			if (type === START) talkbacks.push(data);
			if (type === DATA && data === DIRTY) {
				if (!pending && !disposed) {
					pending = true;
					enqueueEffect(run);
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
