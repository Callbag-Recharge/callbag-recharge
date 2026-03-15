/**
 * Side-effect runner. Connects eagerly to deps on creation, runs fn() inline
 * when all dirty deps resolve. Returns a dispose function.
 *
 * Stateless: does not produce a store. No cached value or get().
 *
 * v3: type 3 dirty tracking across deps. Skips execution when all deps sent
 * RESOLVED (no value changed). Effects run as part of the callbag signal
 * flow — no enqueueEffect.
 */

import {
	beginDeferredStart,
	DATA,
	DIRTY,
	END,
	endDeferredStart,
	RESOLVED,
	START,
	STATE,
} from "./protocol";
import type { Store } from "./types";

export function effect(deps: Store<unknown>[], fn: () => undefined | (() => void)): () => void {
	let cleanupEffect: undefined | (() => void);
	const talkbacks: Array<(type: number) => void> = [];
	let disposed = false;
	const dirtyDeps = new Set<number>();
	let anyDataReceived = false;

	function run(): void {
		if (disposed) return;
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
			if (type === STATE) {
				if (data === DIRTY) {
					if (!disposed) {
						if (dirtyDeps.size === 0) anyDataReceived = false;
						dirtyDeps.add(depIndex);
					}
				} else if (data === RESOLVED) {
					if (dirtyDeps.has(depIndex)) {
						dirtyDeps.delete(depIndex);
						if (dirtyDeps.size === 0 && !disposed) {
							if (anyDataReceived) run();
							// else: all deps RESOLVED, skip
						}
					}
				}
			}
			if (type === DATA) {
				if (dirtyDeps.has(depIndex)) {
					dirtyDeps.delete(depIndex);
					anyDataReceived = true;
					if (dirtyDeps.size === 0 && !disposed) {
						run();
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
