import { Bitmask } from "../core/bitmask";
import { operator } from "../core/operator";
import { DATA, DIRTY, END, RESOLVED, STATE } from "../core/protocol";
import type { Store, StoreOperator, StoreOptions } from "../core/types";

// Overloads
export function cached<T>(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>): Store<T>;
export function cached<A>(eq?: (a: A, b: A) => boolean): StoreOperator<A, A>;
/**
 * **Factory:** `cached(deps, fn)` — like `derived` but skips `fn()` on disconnected `get()` when dep snapshots match.
 * **Pipe:** `cached(eq?)` — output dedup + cached pull (similar to `distinctUntilChanged` + getter cache).
 *
 * @param depsOrEq - Deps array (factory form) or optional equality (pipe form).
 * @param fn - Compute function (factory form only).
 * @param opts - `StoreOptions` (factory form).
 *
 * @returns `Store<T>` or `StoreOperator<A, A>` depending on overload.
 *
 * @seeAlso [derived](/api/derived), [distinctUntilChanged](/api/distinctUntilChanged)
 *
 * @category extra
 */
export function cached(...args: any[]): any {
	if (Array.isArray(args[0])) {
		return cachedFactory(args[0], args[1], args[2]);
	}
	return cachedPipe(args[0]);
}

function cachedFactory<T>(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>): Store<T> {
	const eqFn = opts?.equals;
	const lastInputs: unknown[] = new Array(deps.length);
	let lastOutput: T | undefined;
	let hasOutput = false;

	// Initial compute + capture inputs
	lastOutput = fn();
	hasOutput = true;
	for (let i = 0; i < deps.length; i++) lastInputs[i] = deps[i].get();

	return operator<T>(
		deps,
		({ emit, signal, complete, error }) => {
			const dirtyDeps = new Bitmask(deps.length);
			let anyDataReceived = false;

			function recompute() {
				const result = fn();
				for (let i = 0; i < deps.length; i++) lastInputs[i] = deps[i].get();
				if (eqFn && hasOutput && eqFn(lastOutput!, result)) {
					signal(RESOLVED);
				} else {
					lastOutput = result;
					hasOutput = true;
					emit(result);
				}
			}

			return (dep, type, data) => {
				if (type === STATE) {
					if (data === DIRTY) {
						if (dirtyDeps.empty()) anyDataReceived = false;
						dirtyDeps.set(dep);
					} else if (data === RESOLVED) {
						if (dirtyDeps.test(dep)) {
							dirtyDeps.clear(dep);
							if (dirtyDeps.empty()) {
								if (anyDataReceived) recompute();
								else signal(RESOLVED);
							}
						}
					}
					signal(data);
				}
				if (type === DATA) {
					if (dirtyDeps.test(dep)) {
						dirtyDeps.clear(dep);
						anyDataReceived = true;
						if (dirtyDeps.empty()) recompute();
					} else {
						// DATA without prior DIRTY (unbatched single-dep or raw source)
						if (dirtyDeps.empty()) {
							recompute();
						} else {
							anyDataReceived = true;
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
			...opts,
			kind: "cached",
			initial: lastOutput,
			getter: () => {
				if (hasOutput) {
					let unchanged = true;
					for (let i = 0; i < deps.length; i++) {
						if (!Object.is(deps[i].get(), lastInputs[i])) {
							unchanged = false;
							break;
						}
					}
					if (unchanged) return lastOutput!;
				}
				const result = fn();
				for (let i = 0; i < deps.length; i++) lastInputs[i] = deps[i].get();
				lastOutput = result;
				hasOutput = true;
				return result;
			},
		},
	);
}

function cachedPipe<A>(eq?: (a: A, b: A) => boolean): StoreOperator<A, A> {
	return (input: Store<A>) => {
		const eqFn = eq ?? (Object.is as (a: A, b: A) => boolean);
		let lastValue: A = input.get();

		return operator<A>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error }) => {
				return (_dep, type, data) => {
					if (type === STATE) {
						signal(data);
					}
					if (type === DATA) {
						if (eqFn(lastValue, data as A)) {
							signal(RESOLVED);
						} else {
							lastValue = data as A;
							emit(data as A);
						}
					}
					if (type === END) {
						if (data !== undefined) error(data);
						else complete();
					}
				};
			},
			{
				kind: "cached",
				initial: lastValue,
				getter: () => {
					const current = input.get();
					if (eqFn(lastValue, current)) return lastValue;
					lastValue = current;
					return current;
				},
			},
		);
	};
}
