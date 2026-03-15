/**
 * Side-effect runner. Connects eagerly to deps on creation, runs fn() inline
 * when all dirty deps resolve. Returns a dispose function.
 *
 * Stateless: does not produce a store. No cached value or get().
 *
 * v3: type 3 dirty tracking across deps. Skips execution when all deps sent
 * RESOLVED (no value changed). Effects run as part of the callbag signal
 * flow — no enqueueEffect.
 *
 * Pure closure implementation — no class needed. All handler state lives in
 * closure-local variables for fastest V8 access. No instanceof usage in the
 * library, so the class shell provided no benefit.
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
	let cleanup: (() => void) | undefined;
	const talkbacks: Array<(type: number) => void> = [];
	let disposed = false;
	let dirtyDeps = 0;
	let anyDataReceived = false;

	function run(): void {
		if (disposed) return;
		if (cleanup) cleanup();
		cleanup = fn();
	}

	beginDeferredStart();

	run();

	for (let i = 0; i < deps.length; i++) {
		if (disposed) break;
		const depBit = 1 << i;
		deps[i].source(START, (type: number, data: any) => {
			if (type === START) {
				talkbacks.push(data);
				return;
			}
			if (disposed) return;
			if (type === STATE) {
				if (data === DIRTY) {
					if (dirtyDeps === 0) anyDataReceived = false;
					dirtyDeps |= depBit;
				} else if (data === RESOLVED) {
					if (dirtyDeps & depBit) {
						dirtyDeps &= ~depBit;
						if (dirtyDeps === 0) {
							if (anyDataReceived) run();
							// else: all deps RESOLVED, skip
						}
					}
				}
			}
			if (type === DATA) {
				if (dirtyDeps & depBit) {
					dirtyDeps &= ~depBit;
					anyDataReceived = true;
					if (dirtyDeps === 0) {
						run();
					}
				} else {
					// DATA without prior DIRTY: raw callbag source or batch
					// edge case. Match derived's behavior — treat as immediate.
					if (dirtyDeps === 0) {
						run();
					} else {
						anyDataReceived = true;
					}
				}
			}
			if (type === END) {
				// Dep completed or errored — dispose the effect.
				disposed = true;
				if (cleanup) cleanup();
				cleanup = undefined;
				for (const tb of talkbacks) tb(END);
				talkbacks.length = 0;
			}
		});
	}

	endDeferredStart();

	return () => {
		if (disposed) return;
		disposed = true;
		if (cleanup) cleanup();
		cleanup = undefined;
		for (const tb of talkbacks) tb(END);
		talkbacks.length = 0;
	};
}
