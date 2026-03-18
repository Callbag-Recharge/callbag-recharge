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

import { Bitmask } from "./bitmask";
import { Inspector } from "./inspector";
import {
	beginDeferredStart,
	DATA,
	DIRTY,
	END,
	endDeferredStart,
	RESOLVED,
	SINGLE_DEP,
	START,
	STATE,
} from "./protocol";
import type { Store } from "./types";

/**
 * Runs a side effect when all dependencies have resolved after a change; returns `dispose()`.
 * Eagerly subscribes to deps on creation. Not a store — no `get()` or `source()`.
 *
 * @param deps - Stores to watch; effect runs when dirty tracking shows all deps settled.
 * @param fn - Called on each run; may return a cleanup function run before the next run or on dispose.
 * @param opts - Optional `{ name }` for Inspector.
 *
 * @returns `() => void` — call to unsubscribe and run final cleanup.
 *
 * @remarks **Immediate first run:** `fn()` runs once right after wiring deps.
 * @remarks **RESOLVED skip:** If deps send RESOLVED without value changes, the effect may not re-run.
 * @remarks **Cleanup:** Return a function from `fn` to tear down listeners before the next run.
 *
 * @example
 * ```ts
 * import { state, effect } from 'callbag-recharge';
 *
 * const count = state(0);
 * let runs = 0;
 * const stop = effect([count], () => {
 *   runs++;
 * });
 * // runs === 1
 * count.set(1);
 * // runs === 2
 * stop();
 * ```
 *
 * @seeAlso [derived](./derived), [state](./state), [subscribe](/api/subscribe)
 */
export function effect(
	deps: Store<unknown>[],
	fn: () => undefined | (() => void),
	opts?: { name?: string },
): () => void {
	let cleanup: (() => void) | undefined;
	const talkbacks: Array<(type: number) => void> = [];
	let disposed = false;
	const dirtyDeps = new Bitmask(deps.length);
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
		const depIndex = i;
		deps[depIndex].source(START, (type: number, data: any) => {
			if (type === START) {
				talkbacks.push(data);
				if (deps.length === 1) data(STATE, SINGLE_DEP);
				return;
			}
			if (disposed) return;
			if (type === STATE) {
				if (data === DIRTY) {
					if (dirtyDeps.empty()) anyDataReceived = false;
					dirtyDeps.set(depIndex);
				} else if (data === RESOLVED) {
					if (dirtyDeps.test(depIndex)) {
						dirtyDeps.clear(depIndex);
						if (dirtyDeps.empty()) {
							if (anyDataReceived) run();
							// else: all deps RESOLVED, skip
						}
					}
				}
			}
			if (type === DATA) {
				if (dirtyDeps.test(depIndex)) {
					dirtyDeps.clear(depIndex);
					anyDataReceived = true;
					if (dirtyDeps.empty()) {
						run();
					}
				} else {
					// DATA without prior DIRTY: raw callbag source or batch
					// edge case. Match derived's behavior — treat as immediate.
					if (dirtyDeps.empty()) {
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

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		if (cleanup) cleanup();
		cleanup = undefined;
		for (const tb of talkbacks) tb(END);
		talkbacks.length = 0;
	};

	Inspector.register(dispose, { kind: "effect", ...opts, deps });
	for (const dep of deps) Inspector.registerEdge(dep, dispose);

	return dispose;
}
