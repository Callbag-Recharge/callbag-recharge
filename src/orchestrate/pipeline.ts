// ---------------------------------------------------------------------------
// pipeline — declarative workflow builder
// ---------------------------------------------------------------------------
// Compose orchestration operators into a declarative workflow. Steps declare
// their deps, and pipeline() auto-wires derived + operators. Each step gets
// reactive status tracking via track().
//
// Usage:
//   const wf = pipeline({
//     trigger: step(fromTrigger<string>()),
//     upper:   step(s => pipe(s, map(v => v.toUpperCase())), ["trigger"]),
//     output:  step(s => pipe(s, track()), ["upper"]),
//   });
//   wf.steps.trigger.fire("hello");
//   wf.status.get(); // { trigger: "active", upper: "active", output: "active" }
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { Inspector } from "../core/inspector";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineStatus = "idle" | "active" | "completed" | "errored";

export interface StepDef<T = any> {
	/** Creates the step's store. Receives deps as args (in declared order). */
	factory: ((...deps: Store<any>[]) => Store<T>) | Store<T>;
	/** Names of steps this step depends on (topological wiring). */
	deps: string[];
	/** Optional name override for Inspector. */
	name?: string;
}

export interface StepMeta {
	/** Current step status. */
	status: PipelineStatus;
	/** Number of values emitted by this step. */
	count: number;
	/** Last error (if errored). */
	error?: unknown;
}

export interface PipelineResult<S extends Record<string, StepDef>> {
	/** Access individual step stores by name. */
	steps: { [K in keyof S]: Store<any> };
	/** Per-step reactive metadata. */
	stepMeta: { [K in keyof S]: Store<StepMeta> };
	/** Overall pipeline status: derived from all step statuses. */
	status: Store<PipelineStatus>;
	/** Topologically sorted step names. */
	order: string[];
	/** Dispose all internal subscriptions. */
	destroy(): void;
}

const IDLE_STEP_META: StepMeta = Object.freeze({ status: "idle", count: 0 });

/**
 * Creates a step definition for use in `pipeline()`.
 *
 * @param factory - A store, or a function that receives dependency stores and returns a store.
 * @param deps - Names of steps this step depends on (default: []).
 * @param opts - Optional configuration.
 *
 * @returns `StepDef<T>` — step definition for pipeline().
 *
 * @example
 * ```ts
 * import { step } from 'callbag-recharge/orchestrate';
 * import { fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * // Source step (no deps)
 * const trigger = step(fromTrigger<string>());
 *
 * // Transform step (depends on trigger)
 * const upper = step(s => pipe(s, map(v => v.toUpperCase())), ["trigger"]);
 * ```
 *
 * @category orchestrate
 */
export function step<T>(
	factory: ((...deps: Store<any>[]) => Store<T>) | Store<T>,
	deps?: string[],
	opts?: { name?: string },
): StepDef<T> {
	return {
		factory,
		deps: deps ?? [],
		name: opts?.name,
	};
}

/**
 * Declarative workflow builder. Steps declare deps, auto-wires stores. Reactive status per step (Tier 2).
 *
 * @param steps - Record of step name → StepDef. Use `step()` to create definitions.
 * @param opts - Optional configuration.
 *
 * @returns `PipelineResult<S>` — step stores, per-step metadata, overall status, topological order, and destroy().
 *
 * @returnsTable steps | Record | Access step stores by name.
 * stepMeta | Record | Per-step reactive metadata (status, count, error).
 * status | Store\<PipelineStatus\> | Overall pipeline status derived from all steps.
 * order | string[] | Topologically sorted step names.
 * destroy() | () => void | Dispose all internal subscriptions.
 *
 * @remarks **Auto-wiring:** Step deps are resolved by name. Factory functions receive dep stores in declared order.
 * @remarks **Topological sort:** Steps are wired in dependency order. Cycles are detected and throw.
 * @remarks **Reactive status:** Each step has a `StepMeta` store. Overall status is derived from all step statuses.
 *
 * @example
 * ```ts
 * import { pipe } from 'callbag-recharge';
 * import { map, subscribe } from 'callbag-recharge/extra';
 * import { pipeline, step, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * const wf = pipeline({
 *   trigger: step(fromTrigger<number>()),
 *   doubled: step(s => pipe(s, map(x => x * 2)), ["trigger"]),
 * });
 *
 * subscribe(wf.steps.doubled, v => console.log(v));
 * (wf.steps.trigger as any).fire(5); // logs 10
 * ```
 *
 * @seeAlso [step](./pipeline) — step definition, [dag](./dag) — DAG validation, [track](./track) — per-stream tracking
 *
 * @category orchestrate
 */
export function pipeline<S extends Record<string, StepDef>>(
	steps: S,
	opts?: { name?: string },
): PipelineResult<S> {
	const baseName = opts?.name ?? "pipeline";
	const stepNames = Object.keys(steps);

	// --- Topological sort (Kahn's algorithm) ---
	const inDegree = new Map<string, number>();
	const adj = new Map<string, string[]>();

	for (const name of stepNames) {
		inDegree.set(name, 0);
		adj.set(name, []);
	}

	for (const name of stepNames) {
		const def = steps[name];
		for (const dep of def.deps) {
			if (!inDegree.has(dep)) {
				throw new Error(`pipeline: step "${name}" depends on unknown step "${dep}"`);
			}
			adj.get(dep)!.push(name);
			inDegree.set(name, inDegree.get(name)! + 1);
		}
	}

	// Use index-based iteration to avoid O(n) shift()
	const queue: string[] = [];
	for (const [name, deg] of inDegree) {
		if (deg === 0) queue.push(name);
	}

	const order: string[] = [];
	let queueHead = 0;
	while (queueHead < queue.length) {
		const name = queue[queueHead++];
		order.push(name);
		for (const next of adj.get(name)!) {
			const newDeg = inDegree.get(next)! - 1;
			inDegree.set(next, newDeg);
			if (newDeg === 0) queue.push(next);
		}
	}

	if (order.length !== stepNames.length) {
		const inCycle = stepNames.filter((n) => !order.includes(n));
		throw new Error(`pipeline: cycle detected involving: ${inCycle.join(", ")}`);
	}

	// --- Wire stores in topological order ---
	const storeMap = new Map<string, Store<any>>();
	const metaMap = new Map<string, Store<StepMeta>>();
	const unsubs: (() => void)[] = [];

	// Wrap wiring in try/catch — on factory throw, clean up already-wired subscriptions
	try {
		for (const name of order) {
			const def = steps[name];
			const stepName = def.name ?? name;

			// Resolve dep stores
			const depStores = def.deps.map((dep) => {
				const s = storeMap.get(dep);
				if (!s) {
					throw new Error(
						`pipeline: dep "${dep}" not yet resolved for step "${name}" — this should not happen`,
					);
				}
				return s;
			});

			// Create step store
			let store: Store<any>;
			if (typeof def.factory === "function") {
				store = (def.factory as (...args: any[]) => Store<any>)(...depStores);
			} else {
				store = def.factory;
			}

			storeMap.set(name, store);

			// Create meta store for this step
			const meta = state<StepMeta>(
				{ ...IDLE_STEP_META },
				{ name: `${baseName}:${stepName}:meta`, equals: () => false },
			);
			metaMap.set(name, meta);

			// Track step values
			let count = 0;
			const unsub = subscribe(
				store,
				() => {
					count++;
					meta.set({ status: "active", count });
				},
				{
					onEnd: (err) => {
						if (err !== undefined) {
							meta.set({ status: "errored", count, error: err });
						} else {
							meta.set({ status: "completed", count });
						}
					},
				},
			);
			unsubs.push(unsub);

			// Register with Inspector
			Inspector.register(store, { kind: "pipeline-step", name: `${baseName}:${stepName}` });
		}
	} catch (err) {
		// Clean up already-wired subscriptions on failure
		for (const unsub of unsubs) unsub();
		throw err;
	}

	// --- Overall status derived from all step metas ---
	const allMetas = order.map((n) => metaMap.get(n)!);
	const overallStatus = derived(allMetas, () => {
		let hasActive = false;
		let hasError = false;
		let allCompleted = true;
		let allIdle = true;

		for (const m of allMetas) {
			const s = m.get().status;
			if (s === "errored") hasError = true;
			if (s === "active") hasActive = true;
			if (s !== "completed") allCompleted = false;
			if (s !== "idle") allIdle = false;
		}

		if (hasError) return "errored" as PipelineStatus;
		if (hasActive) return "active" as PipelineStatus;
		if (allCompleted) return "completed" as PipelineStatus;
		if (allIdle) return "idle" as PipelineStatus;
		return "active" as PipelineStatus; // mix of completed + idle = in progress
	});

	// Subscribe to overallStatus to keep it connected, track for cleanup
	const statusUnsub = subscribe(overallStatus, () => {});
	unsubs.push(statusUnsub);

	Inspector.register(overallStatus, { kind: "pipeline-status", name: `${baseName}:status` });

	// --- Build result ---
	const stepsResult = {} as { [K in keyof S]: Store<any> };
	const stepMetaResult = {} as { [K in keyof S]: Store<StepMeta> };

	for (const name of stepNames) {
		(stepsResult as any)[name] = storeMap.get(name)!;
		(stepMetaResult as any)[name] = metaMap.get(name)!;
	}

	return {
		steps: stepsResult,
		stepMeta: stepMetaResult,
		status: overallStatus,
		order,
		destroy() {
			for (const unsub of unsubs) unsub();
			unsubs.length = 0;
		},
	};
}
