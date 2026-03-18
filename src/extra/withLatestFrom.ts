import { Bitmask } from "../core/bitmask";
import { operator } from "../core/operator";
import { DATA, DIRTY, END, RESOLVED, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * On primary source emission, combines with **latest** values from other deps via the trailing combiner (multi-dep Tier 1 hybrid).
 *
 * @param args - `...otherStores, (primary, ...others) => result` — primary is dep 0.
 *
 * @returns `StoreOperator` — only primary DATA triggers output; other deps alone yield RESOLVED.
 *
 * @category extra
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
