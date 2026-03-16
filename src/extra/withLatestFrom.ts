import { Bitmask } from "../core/bitmask";
import { operator } from "../core/operator";
import { DATA, DIRTY, END, RESOLVED, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * When the source emits, grabs the current values from other stores
 * and passes all values through a combiner function.
 *
 * Tier 2 hybrid: all stores (source + others) are wired as deps, so they
 * participate in diamond resolution and stay connected. However, only
 * the primary source (dep 0) drives emissions — changes to "others" deps
 * alone produce RESOLVED (no re-emission).
 *
 * This "primary + secondary deps" pattern ensures:
 * - No diamond glitch: bitmask waits for all deps to settle before computing
 * - No stale reads: others are real deps, always up-to-date
 * - Source-driven semantics: only source changes trigger output
 */
export function withLatestFrom<A, Others extends Store<unknown>[], R>(
	...args: [
		...Others,
		(...values: [A, ...{ [K in keyof Others]: Others[K] extends Store<infer T> ? T : never }]) => R,
	]
): StoreOperator<A, R> {
	const fn = args[args.length - 1] as (...values: any[]) => R;
	const others = args.slice(0, -1) as unknown as Store<unknown>[];

	return (source: Store<A>) => {
		const allDeps = [source, ...others] as Store<unknown>[];
		const compute = () => fn(source.get(), ...others.map((s) => s.get()));

		return operator<R>(
			allDeps,
			({ emit, signal, complete, error }) => {
				const dirtyDeps = new Bitmask(allDeps.length);
				let sourceReceivedData = false;

				return (dep, type, data) => {
					if (type === STATE) {
						if (data === DIRTY) {
							const wasClean = dirtyDeps.empty();
							dirtyDeps.set(dep);
							if (wasClean) {
								sourceReceivedData = false;
								signal(DIRTY);
							}
						} else if (data === RESOLVED) {
							if (dirtyDeps.test(dep)) {
								dirtyDeps.clear(dep);
								if (dirtyDeps.empty()) {
									if (sourceReceivedData) {
										emit(compute());
									} else {
										signal(RESOLVED);
									}
								}
							}
						} else {
							signal(data); // Forward unknown STATE signals (v4 forward-compat)
						}
					}
					if (type === DATA) {
						if (dep === 0) sourceReceivedData = true;
						if (dirtyDeps.test(dep)) {
							dirtyDeps.clear(dep);
							if (dirtyDeps.empty()) {
								if (sourceReceivedData) {
									emit(compute());
								} else {
									// Only "others" changed, source didn't — suppress
									signal(RESOLVED);
								}
							}
						} else {
							// DATA without prior DIRTY (raw callbag source)
							if (dep === 0) {
								if (dirtyDeps.empty()) {
									signal(DIRTY);
									emit(compute());
								} else {
									// Wait for other dirty deps
								}
							} else if (dirtyDeps.empty()) {
								// Only secondary dep changed, no source change
								signal(DIRTY);
								signal(RESOLVED);
							}
						}
					}
					if (type === END) {
						if (data !== undefined) error(data);
						else complete();
					}
				};
			},
			{
				kind: "withLatestFrom",
				name: "withLatestFrom",
				initial: compute(),
				getter: () => compute(),
			},
		);
	};
}
