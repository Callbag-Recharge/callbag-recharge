// ---------------------------------------------------------------------------
// branch — conditional routing as pipeline step
// ---------------------------------------------------------------------------
// High-level binary split for pipeline(). Creates two implicit steps:
//   "name" (matching/pass) and "name.fail" (non-matching).
// Built on route() internally.
//
// Usage:
//   const wf = pipeline({
//     input:    step(fromTrigger<number>()),
//     validate: branch("input", v => v > 0),
//     process:  task(["validate"], async (v) => { ... }),
//     reject:   task(["validate.fail"], async (v) => { ... }),
//   });
// ---------------------------------------------------------------------------

import type { Store } from "../core/types";
import { route } from "../extra/route";
import type { StepDef } from "./pipeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extended StepDef that carries the "fail" branch store for pipeline auto-wiring. */
export interface BranchStepDef<T = any> extends StepDef<T | undefined> {
	_failStore: (depStore: Store<T>) => Store<T | undefined>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a binary conditional branch in a pipeline. The step itself outputs
 * matching values; the `.fail` branch is accessible as `"stepName.fail"`.
 *
 * @param dep - Name of the upstream step to branch on.
 * @param predicate - Function that returns `true` for matching (pass) values.
 * @param opts - Optional configuration.
 *
 * @returns `BranchStepDef<T>` — step definition for pipeline(). The matching branch
 * is the step itself; `"stepName.fail"` is auto-registered by pipeline().
 *
 * @remarks **Diamond-safe:** Both outputs use `route()` internally, with suppression signaling
 * on the inactive branch to prevent blocking downstream diamond joins.
 *
 * @example
 * ```ts
 * import { pipeline, step, task, branch, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * const wf = pipeline({
 *   input:    step(fromTrigger<number>()),
 *   check:    branch("input", v => v > 0),
 *   positive: task(["check"], async (v) => `good: ${v}`),
 *   negative: task(["check.fail"], async (v) => `bad: ${v}`),
 * });
 * ```
 *
 * @category orchestrate
 */
export function branch<T>(
	dep: string,
	predicate: (value: T) => boolean,
	opts?: { name?: string },
): BranchStepDef<T> {
	const baseName = opts?.name ?? "branch";

	// The factory receives the dep store and returns the "pass" store.
	// The "fail" store is attached to the StepDef for pipeline to pick up.
	const factory = (depStore: Store<T>): Store<T | undefined> => {
		const [pass, _fail] = route(depStore, predicate, { name: baseName });
		// Stash the fail store on a closure-scoped variable for _failStore
		failStoreRef = _fail;
		return pass;
	};

	let failStoreRef: Store<T | undefined> | null = null;

	const def: BranchStepDef<T> = {
		factory: factory as any,
		deps: [dep],
		name: opts?.name,
		_failStore: (_depStore: Store<T>) => {
			if (failStoreRef) return failStoreRef;
			throw new Error(
				`branch: .fail store accessed before pipeline wired the step. ` +
					`Ensure the branch step is declared before any step that depends on "${dep}.fail".`,
			);
		},
	};

	return def;
}
