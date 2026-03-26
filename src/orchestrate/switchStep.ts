// ---------------------------------------------------------------------------
// switchStep — N-way conditional routing as pipeline step
// ---------------------------------------------------------------------------
// High-level N-way split for pipeline(). Creates N implicit steps:
//   "name.caseName" for each case in the cases array.
// The dispatcher function maps each value to a case name.
//
// Usage:
//   const wf = pipeline({
//     input:    step(fromTrigger<string>()),
//     route:    switchStep("input", v => v.startsWith("A") ? "groupA" : "groupB", ["groupA", "groupB"]),
//     handleA:  task(["route.groupA"], async (signal, [v]) => { ... }),
//     handleB:  task(["route.groupB"], async (signal, [v]) => { ... }),
//   });
// ---------------------------------------------------------------------------

import { operator } from "../core/operator";
import { DATA, END, RESOLVED, STATE } from "../core/protocol";
import type { Store } from "../core/types";
import type { StepDef } from "./pipeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extended StepDef that carries per-case output stores for pipeline auto-wiring. */
export interface SwitchStepDef<T = any> extends StepDef<T | undefined> {
	/** @internal Case stores keyed by case name, for pipeline auto-wiring. */
	_caseStores: Map<string, (depStore: Store<T>) => Store<T | undefined>>;
	/** The case names this switch routes to. */
	cases: readonly string[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates an N-way conditional routing step in a pipeline. Each case becomes
 * a compound step accessible as `"stepName.caseName"`.
 *
 * @param dep - Name of the upstream step to route on.
 * @param dispatcher - Function that maps a value to a case name (must be one of `cases`).
 *   Return `undefined` to suppress the value (no case receives it).
 * @param cases - Array of case name strings.
 * @param opts - Optional configuration.
 *
 * @returns `SwitchStepDef<T>` — step definition for pipeline(). Each case is
 * accessible as `"stepName.caseName"` in downstream step deps.
 *
 * @remarks **Diamond-safe:** All case outputs use `operator()` with RESOLVED signaling
 * on inactive branches to prevent blocking downstream diamond joins.
 *
 * @example
 * ```ts
 * import { pipeline, source, task, switchStep, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * const wf = pipeline({
 *   input:   source(fromTrigger<number>()),
 *   route:   switchStep("input", v => v > 0 ? "positive" : v < 0 ? "negative" : "zero",
 *                       ["positive", "negative", "zero"]),
 *   pos:     task(["route.positive"], async (signal, [v]) => `pos: ${v}`),
 *   neg:     task(["route.negative"], async (signal, [v]) => `neg: ${v}`),
 *   zero:    task(["route.zero"], async (signal, [v]) => `zero: ${v}`),
 * });
 * ```
 *
 * @category orchestrate
 */
export function switchStep<T>(
	dep: string,
	dispatcher: (value: T) => string | undefined,
	cases: readonly string[],
	opts?: { name?: string },
): SwitchStepDef<T> {
	if (cases.length === 0) {
		throw new Error("switchStep: cases array must not be empty");
	}
	const caseSet = new Set(cases);
	if (caseSet.size !== cases.length) {
		throw new Error("switchStep: duplicate case names detected");
	}

	const baseName = opts?.name ?? "switch";

	// Per-case store factories — lazily created when pipeline wires the step.
	// Each case store receives the dep store and returns an operator that
	// emits only when dispatcher returns that case name.
	const caseStoreRefs = new Map<string, Store<T | undefined>>();

	const factory = (depStore: Store<T>): Store<T | undefined> => {
		if (caseStoreRefs.size > 0) {
			throw new Error("switchStep: factory already wired — cannot wire the same switchStep twice");
		}
		// Create all case stores from the single dep
		for (const caseName of cases) {
			const caseStore = operator<T | undefined>(
				[depStore],
				({ emit, signal, complete, error }) => {
					return (_depIndex, type, data) => {
						if (type === STATE) signal(data);
						else if (type === DATA) {
							try {
								const target = dispatcher(data as T);
								if (target === caseName) emit(data as T);
								else if (target === undefined || caseSet.has(target)) signal(RESOLVED);
								else
									error(
										new Error(
											`switchStep: dispatcher returned unknown case "${target}". Valid cases: ${cases.join(", ")}`,
										),
									);
							} catch (e) {
								error(e);
							}
						} else if (type === END) {
							if (data !== undefined) error(data);
							else complete();
						}
					};
				},
				{
					name: `${baseName}:${caseName}`,
					kind: "switch-case",
					getter: () => {
						try {
							const v = depStore.get();
							return dispatcher(v) === caseName ? v : undefined;
						} catch {
							return undefined;
						}
					},
				},
			);
			caseStoreRefs.set(caseName, caseStore);
		}

		// The "main" step store returns the first case output as a default.
		// In practice, users should depend on "stepName.caseName", not "stepName" directly.
		// Return the first case's store as the step's own store for basic compatibility.
		return caseStoreRefs.get(cases[0])!;
	};

	const caseStoreFactories = new Map<string, (depStore: Store<T>) => Store<T | undefined>>();
	for (const caseName of cases) {
		caseStoreFactories.set(caseName, (_depStore: Store<T>) => {
			const ref = caseStoreRefs.get(caseName);
			if (ref) return ref;
			throw new Error(
				`switchStep: case "${caseName}" store accessed before pipeline wired the step. ` +
					`Ensure the switch step is declared before any step that depends on it.`,
			);
		});
	}

	const def: SwitchStepDef<T> = {
		factory: factory as any,
		deps: [dep],
		name: opts?.name,
		_caseStores: caseStoreFactories,
		cases,
	};

	return def;
}
