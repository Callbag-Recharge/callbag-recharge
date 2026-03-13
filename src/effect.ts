// ---------------------------------------------------------------------------
// effect(fn) — run side effects when tracked stores change
// ---------------------------------------------------------------------------
// Connects as a callbag sink to each dependency.
// When DIRTY arrives, schedules re-run after propagation completes.
// ---------------------------------------------------------------------------

import { DATA, DIRTY, END, enqueueEffect, START } from "./protocol";
import { tracked } from "./tracking";

export function effect(fn: () => undefined | (() => void)): () => void {
	let cleanupEffect: undefined | (() => void);
	let talkbacks: Array<(type: number) => void> = [];
	let disposed = false;
	let pending = false;

	function run(): void {
		if (disposed) return;
		pending = false;

		// Cleanup previous effect
		if (cleanupEffect) cleanupEffect();

		// Disconnect from previous deps
		for (const tb of talkbacks) tb(END);
		talkbacks = [];

		// Run fn in tracking context — discovers deps via .get() calls
		const [result, deps] = tracked(fn);
		cleanupEffect = result;

		// Connect to each dep's callbag source
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
	}

	// Initial run
	run();

	return () => {
		disposed = true;
		if (cleanupEffect) cleanupEffect();
		for (const tb of talkbacks) tb(END);
		talkbacks = [];
	};
}
