// ---------------------------------------------------------------------------
// pipeline — declarative workflow builder
// ---------------------------------------------------------------------------
// Compose workflow steps into a declarative DAG. Steps declare deps, and
// pipeline() auto-wires them in topological order with reactive status tracking.
//
// Usage:
//   const wf = pipeline({
//     trigger: step(fromTrigger<string>()),
//     fetch:   task(["trigger"], async (signal, [v]) => fetchData(v)),
//     process: task(["fetch"], async (signal, [data]) => transform(data)),
//   });
//   wf.steps.trigger.fire("hello");
//   wf.status.get(); // "idle" → "active" → "completed"
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { Inspector } from "../core/inspector";
import type { Subscription } from "../core/protocol";
import { RESET, TEARDOWN } from "../core/protocol";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";
import { ON_FAILURE_ROLE } from "./onFailure";
import type { TaskState } from "./types";
import { TASK_STATE } from "./types";

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

/** Expert-level internals — stream lifecycle details. */
export interface PipelineInner<S extends Record<string, StepDef>> {
	/** Stream lifecycle status derived from step data and termination events. */
	streamStatus: Store<PipelineStatus>;
	/** Per-step reactive metadata (stream-level counts and lifecycle status). */
	stepMeta: { [K in keyof S]: Store<StepMeta> };
	/** Topologically sorted step names. */
	order: string[];
}

export interface PipelineResult<S extends Record<string, StepDef>> {
	/** Access individual step stores by name. */
	steps: { [K in keyof S]: Store<any> };
	/** Overall pipeline status: idle → active → completed/errored. Derived from task() steps automatically. */
	status: Store<PipelineStatus>;
	/** Reset all steps and tasks to idle. Call before re-triggering. */
	reset(opts?: { resetExternalTasks?: boolean }): void;
	/** Dispose all internal subscriptions. */
	destroy(): void;
	/** Expert-level stream internals. Most users don't need this. */
	inner: PipelineInner<S>;
}

const IDLE_STEP_META: StepMeta = Object.freeze({ status: "idle", count: 0 });

/**
 * @internal
 *
 * Low-level step definition for `pipeline()`. Most users should use
 * `source()` for event sources and `task()` for work steps instead.
 *
 * `step()` is internal plumbing — it creates a raw reactive step without
 * lifecycle tracking, skip detection, retry, or timeout. Using it for work
 * steps bypasses pipeline's automatic status management.
 *
 * @category orchestrate
 */
export function step<T>(
	factory: ((...deps: Store<any>[]) => Store<T>) | Store<T>,
	opts?: { name?: string },
): StepDef<T>;
export function step<T>(
	deps: string[],
	factory: (...deps: Store<any>[]) => Store<T>,
	opts?: { name?: string },
): StepDef<T>;
export function step<T>(
	depsOrFactory: string[] | ((...deps: Store<any>[]) => Store<T>) | Store<T>,
	factoryOrOpts?: ((...deps: Store<any>[]) => Store<T>) | Store<T> | { name?: string },
	opts?: { name?: string },
): StepDef<T> {
	// Deps-first: step(["a"], factory, opts?)
	if (Array.isArray(depsOrFactory)) {
		if (factoryOrOpts == null) {
			throw new Error(
				"step(): deps-first form requires a factory function or Store as second argument",
			);
		}
		return {
			factory: factoryOrOpts as ((...deps: Store<any>[]) => Store<T>) | Store<T>,
			deps: depsOrFactory,
			name: opts?.name,
		};
	}
	// No-deps: step(factory, opts?)
	return {
		factory: depsOrFactory,
		deps: [],
		name: (factoryOrOpts as { name?: string } | undefined)?.name,
	};
}

/** @internal Symbol key for explicit source role tagging. */
export const SOURCE_ROLE: unique symbol = Symbol.for("callbag-recharge:sourceRole");

/**
 * Declares an event source step for `pipeline()`. Sources are long-lived emitters
 * (triggers, cron, WebSocket, etc.) that never block pipeline completion.
 *
 * Use `source()` for entry points and `task()` for work steps. Together they
 * cover all pipeline node types — `step()` is internal plumbing.
 *
 * @param store - A reactive store (e.g., `fromTrigger()`, `fromCron()`, `interval()`).
 * @param opts - Optional configuration.
 *
 * @returns `StepDef<T>` — step definition tagged as a source for pipeline().
 *
 * @example
 * ```ts
 * import { source, task, fromTrigger, pipeline } from 'callbag-recharge/orchestrate';
 *
 * const wf = pipeline({
 *   trigger: source(fromTrigger<string>()),
 *   fetch:   task(["trigger"], async (signal, [v]) => fetchData(v)),
 * });
 * ```
 *
 * @category orchestrate
 */
export function source<T>(store: Store<T>, opts?: { name?: string }): StepDef<T> {
	const def = step(store, opts);
	(def as any)[SOURCE_ROLE] = true;
	return def;
}

/**
 * Declarative workflow builder. Wire steps into a DAG with automatic status tracking.
 *
 * Use `task()` for work steps and `step()` only for source steps (triggers, cron).
 * Status is automatically derived from `task()` steps — no manual wiring needed.
 *
 * @param steps - Record of step name → StepDef. Use `task()` for work, `step()` for sources.
 * @param opts - Optional configuration: `name` (Inspector prefix), `tasks` (extra `TaskState` instances to fold into aggregate `status` when they are not attached to a `task()` step).
 *
 * @returns `PipelineResult<S>` — step stores, status, reset/destroy, and inner callbag details.
 *
 * @returnsTable steps | Record | Access step stores by name.
 * status | Store\<PipelineStatus\> | Pipeline status: idle → active → completed/errored.
 * reset(opts?) | (opts?: \{ resetExternalTasks?: boolean \}) => void | Reset all steps and tasks to idle. External tasks reset by default; pass `{ resetExternalTasks: false }` to skip.
 * destroy() | () => void | Dispose subscriptions and destroy auto-detected task states.
 * inner | PipelineInner | Expert-level stream internals (streamStatus, stepMeta, order).
 *
 * @remarks **Auto-wiring:** Step deps are resolved by name. Factory functions receive dep stores in declared order.
 * @remarks **Topological sort:** Steps are wired in dependency order. Cycles are detected and throw.
 * @remarks **Auto status:** When using `task()` steps, `status` automatically tracks work execution (idle → active → completed/errored). Falls back to stream lifecycle tracking when no tasks are detected.
 * @remarks **Skip propagation:** When a task's upstream deps all reach terminal states (success/error/skipped) with at least one non-success, the pipeline automatically marks the idle downstream task as "skipped". This cascades transitively through the DAG.
 * @remarks **opts.tasks:** Pass additional `TaskState` stores so `status` reflects work outside `task()`-wrapped steps (e.g. UI demos that run `taskState` manually). Duplicates are deduped with auto-detected task states. Note: `destroy()` does NOT destroy externally provided `opts.tasks` — the caller owns their lifecycle.
 * @remarks **Destroy ownership:** `destroy()` tears down subscriptions, destroys auto-detected `task()` states, and invalidates approval controls. Externally provided `opts.tasks` are left alive since the caller owns them.
 * @remarks **Branch support:** Use `branch()` steps with compound deps like `"validate.fail"` for conditional routing.
 *
 * @example
 * ```ts
 * import { pipeline, step, task, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * const wf = pipeline({
 *   trigger: step(fromTrigger<string>()),
 *   fetch:   task(["trigger"], async (signal, [v]) => fetchData(v), { retry: 3 }),
 *   process: task(["fetch"], async (signal, [data]) => transform(data)),
 * });
 *
 * wf.steps.trigger.fire("go");
 * wf.status.get(); // "idle" → "active" → "completed"
 * ```
 *
 * @seeAlso [task](./task) — value-level step, [branch](./branch) — conditional routing, [step](./pipeline) — expert-level step
 *
 * @category orchestrate
 */
export function pipeline<S extends Record<string, StepDef>>(
	steps: S,
	opts?: { name?: string; tasks?: Record<string, TaskState<any>> },
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
			// Support compound deps like "validate.fail" → resolve to parent "validate"
			const baseDep = dep.includes(".") ? dep.split(".")[0] : dep;
			if (!inDegree.has(baseDep)) {
				throw new Error(`pipeline: step "${name}" depends on unknown step "${dep}"`);
			}
			adj.get(baseDep)!.push(name);
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
	const counts = new Map<string, number>();
	const unsubs: Subscription[] = [];
	const stepSubs: Subscription[] = [];

	// Wrap wiring in try/catch — on factory throw, clean up already-wired subscriptions
	try {
		for (const name of order) {
			const def = steps[name];
			const stepName = def.name ?? name;

			// Resolve dep stores (supports compound names like "validate.fail")
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

			// Auto-register task error companion stores (e.g., "fetch" → "fetch.error")
			if ((def as any)[TASK_STATE]) {
				storeMap.set(`${name}.error`, (def as any)[TASK_STATE].error);
			}

			// Auto-register branch fail stores (e.g., "validate" → "validate.fail")
			if ((def as any)._failStore && depStores.length === 1) {
				const failStore = (def as any)._failStore(depStores[0]);
				storeMap.set(`${name}.fail`, failStore);
			}

			// Create meta store for this step
			const meta = state<StepMeta>(
				{ ...IDLE_STEP_META },
				{ name: `${baseName}:${stepName}:meta`, equals: () => false },
			);
			metaMap.set(name, meta);

			// Track step values — count stored in map so reset() can zero it
			counts.set(name, 0);
			const stepKey = name;
			const unsub = subscribe(
				store,
				() => {
					const c = (counts.get(stepKey) ?? 0) + 1;
					counts.set(stepKey, c);
					meta.set({ status: "active", count: c });
				},
				{
					onEnd: (err) => {
						const c = counts.get(stepKey) ?? 0;
						if (err !== undefined) {
							meta.set({ status: "errored", count: c, error: err });
						} else {
							meta.set({ status: "completed", count: c });
						}
					},
				},
			);
			unsubs.push(unsub);
			stepSubs.push(unsub);

			// Register with Inspector
			Inspector.register(store, { kind: "pipeline-step", name: `${baseName}:${stepName}` });
		}
	} catch (err) {
		// Clean up already-wired subscriptions on failure
		for (const unsub of unsubs) unsub.unsubscribe();
		throw err;
	}

	// --- Stream status derived from all step metas (callbag lifecycle) ---
	// Source steps are long-lived event sources — they don't complete.
	// When a pipeline has downstream work steps, source steps are non-blocking
	// for completion (active or idle source steps are treated as "done").
	// Explicit source() tag takes precedence; falls back to deps.length === 0 for step() compat.
	const allMetas = order.map((n) => metaMap.get(n)!);
	const sourceStepIndices = new Set(
		order
			.map((n, i) =>
				(steps[n] as any)[SOURCE_ROLE] ||
				(steps[n].deps.length === 0 && !(steps[n] as any)[TASK_STATE])
					? i
					: -1,
			)
			.filter((i) => i >= 0),
	);
	const hasWorkSteps = sourceStepIndices.size < allMetas.length;
	const streamStatus = derived(allMetas, () => {
		let hasActive = false;
		let hasError = false;
		let allCompleted = true;
		let allIdle = true;

		for (let i = 0; i < allMetas.length; i++) {
			const s = allMetas[i].get().status;
			const isSource = sourceStepIndices.has(i);
			if (s === "errored") hasError = true;
			// Source steps in a pipeline with work steps: "active" or "idle" counts as done
			if (s === "active" && !(isSource && hasWorkSteps)) hasActive = true;
			if (s !== "completed" && !(isSource && hasWorkSteps && (s === "active" || s === "idle")))
				allCompleted = false;
			if (s !== "idle") allIdle = false;
		}

		if (hasError) return "errored" as PipelineStatus;
		if (hasActive) return "active" as PipelineStatus;
		if (allCompleted) return "completed" as PipelineStatus;
		if (allIdle) return "idle" as PipelineStatus;
		return "active" as PipelineStatus; // mix of completed + idle = in progress
	});

	// Subscribe to streamStatus to keep it connected, track for cleanup
	const streamStatusUnsub = subscribe(streamStatus, () => {});
	unsubs.push(streamStatusUnsub);

	Inspector.register(streamStatus, {
		kind: "pipeline-stream-status",
		name: `${baseName}:streamStatus`,
	});

	// --- Task status derived from taskState instances ---
	// Auto-detect task states from task() step defs (via TASK_STATE symbol), merge with explicitly provided tasks.
	const autoDetectedTasks: TaskState<any>[] = [];
	const taskStateByName = new Map<string, TaskState<any>>();
	// Steps tagged as error handlers (onFailure) are excluded from skip propagation
	const errorHandlerSteps = new Set<string>();
	for (const name of stepNames) {
		const def = steps[name] as any;
		if (def[TASK_STATE]) {
			autoDetectedTasks.push(def[TASK_STATE]);
			taskStateByName.set(name, def[TASK_STATE]);
		}
		if (def[ON_FAILURE_ROLE]) {
			errorHandlerSteps.add(name);
		}
	}
	const externalTasks: TaskState<any>[] = [];
	const externalTasksByName = new Map<string, TaskState<any>>();
	if (opts?.tasks) {
		for (const [name, ts] of Object.entries(opts.tasks)) {
			externalTasks.push(ts);
			externalTasksByName.set(name, ts);
		}
	}
	// Deduplicate (auto + external merged)
	const dedupedTasks = [...new Set([...autoDetectedTasks, ...externalTasks])];

	// Merged name→taskState map for skip propagation (includes external tasks)
	const allTasksByName = new Map<string, TaskState<any>>([
		...taskStateByName,
		...externalTasksByName,
	]);

	// Primary status: if tasks exist, derive from taskState. Otherwise fall back to stream status.
	let status: Store<PipelineStatus>;
	if (dedupedTasks.length > 0) {
		const taskStatusStores = dedupedTasks.map((ts) => ts.status);

		// --- Skip propagation (two-phase: pure compute + deferred mutation) ---
		// Phase 1 (pure): Compute which idle tasks should be skipped based on
		// upstream terminal states. Uses a virtual set to handle cascading without
		// mutating stores. onFailure steps are excluded — they activate on error.
		const computeSkips = (): Map<string, string[]> => {
			const skipped = new Map<string, string[]>();
			const maxIter = allTasksByName.size;
			let changed = true;
			let iter = 0;
			while (changed) {
				if (++iter > maxIter) break; // safety: max cascading depth = number of tasks
				changed = false;
				for (const [name, ts] of allTasksByName) {
					if (skipped.has(name)) continue;
					if (errorHandlerSteps.has(name)) continue;
					if (ts.status.get() !== "idle") continue;

					const depNames = steps[name]
						? steps[name].deps.map((d) => (d.includes(".") ? d.split(".")[0] : d))
						: [];
					const taskDeps = depNames.filter((d) => allTasksByName.has(d));
					if (taskDeps.length === 0) continue;

					const allTerminal = taskDeps.every((d) => {
						if (skipped.has(d)) return true;
						const s = allTasksByName.get(d)!.status.get();
						return s === "success" || s === "error" || s === "skipped";
					});
					const anyFailed = taskDeps.some((d) => {
						if (skipped.has(d)) return true;
						const s = allTasksByName.get(d)!.status.get();
						return s === "error" || s === "skipped";
					});

					if (allTerminal && anyFailed) {
						const failedDeps = taskDeps.filter((d) => {
							if (skipped.has(d)) return true;
							const s = allTasksByName.get(d)!.status.get();
							return s === "error" || s === "skipped";
						});
						skipped.set(name, failedDeps);
						changed = true;
					}
				}
			}
			return skipped;
		};

		// Phase 2 (side effect): Apply markSkipped() mutations. Called from a
		// subscriber AFTER the derived settles — no re-entrant derived evaluation.
		const applySkips = () => {
			const toSkip = computeSkips();
			for (const [name, failedDeps] of toSkip) {
				const ts = allTasksByName.get(name)!;
				if (ts.status.get() !== "idle") continue;
				Inspector.annotate(
					ts.status,
					`skipped: upstream [${failedDeps.join(", ")}] failed/skipped`,
				);
				ts.markSkipped();
			}
		};

		status = derived(
			taskStatusStores,
			() => {
				// Pure: compute virtual skips for accurate status aggregation
				const virtualSkips = computeSkips();
				const virtualSkipStores = new Set<Store<any>>();
				for (const [name] of virtualSkips) {
					const ts = allTasksByName.get(name);
					if (ts) virtualSkipStores.add(ts.status);
				}

				let anyRunning = false;
				let anyError = false;
				let allDone = true;
				let allIdle = true;

				for (const statusStore of taskStatusStores) {
					let s = statusStore.get() as string;
					if (virtualSkipStores.has(statusStore)) s = "skipped";
					if (s === "running") anyRunning = true;
					if (s === "error") anyError = true;
					if (s !== "success" && s !== "skipped") allDone = false;
					if (s !== "idle" && s !== "skipped") allIdle = false;
				}

				if (anyRunning) return "active" as PipelineStatus;
				if (anyError) return "errored" as PipelineStatus;
				if (allDone) return "completed" as PipelineStatus;
				if (allIdle) return "idle" as PipelineStatus;
				return "active" as PipelineStatus;
			},
			{ equals: Object.is },
		);
		// Subscribe to keep status connected + trigger deferred skip mutations
		const statusUnsub = subscribe(status, () => applySkips());
		unsubs.push(statusUnsub);
		Inspector.register(status, { kind: "pipeline-status", name: `${baseName}:status` });
	} else {
		// No task() steps — fall back to stream lifecycle status
		status = streamStatus;
	}

	// --- Build result ---
	const stepsResult = {} as { [K in keyof S]: Store<any> };
	const stepMetaResult = {} as { [K in keyof S]: Store<StepMeta> };

	for (const name of stepNames) {
		(stepsResult as any)[name] = storeMap.get(name)!;
		(stepMetaResult as any)[name] = metaMap.get(name)!;
	}

	// Include compound stores (e.g., "validate.fail" from branch steps)
	for (const [key, store] of storeMap) {
		if (key.includes(".") && !(key in stepsResult)) {
			(stepsResult as any)[key] = store;
		}
	}

	let _destroyed = false;

	return {
		steps: stepsResult,
		status,
		reset(resetOpts?: { resetExternalTasks?: boolean }) {
			if (_destroyed) return;
			// Reset step metas (stream-level tracking in inner)
			for (const meta of allMetas) {
				(meta as any).set({ ...IDLE_STEP_META });
			}
			for (const key of counts.keys()) {
				counts.set(key, 0);
			}
			// Signal cascades through graph — each step handles its own RESET
			// (task() intercepts RESET and calls ts.reset(), etc.)
			for (const sub of stepSubs) {
				sub.signal(RESET);
			}
			// Reset externally-provided tasks (not wired to stepSubs, so RESET won't reach them).
			if (resetOpts?.resetExternalTasks !== false) {
				for (const ts of externalTasks) {
					ts.reset();
				}
			}
		},
		destroy() {
			if (_destroyed) return;
			_destroyed = true;
			// TEARDOWN cascades through graph — each step handles its own teardown
			// (task() intercepts TEARDOWN and calls ts.destroy(), etc.)
			for (const sub of stepSubs) {
				sub.signal(TEARDOWN);
			}
			// Defensive cleanup: unsubscribe all subscriptions even though TEARDOWN
			// should have completed them. Handles edge cases where steps don't propagate
			// TEARDOWN correctly (e.g., raw step() stores without onSignal handlers).
			for (const unsub of unsubs) unsub.unsubscribe();
			unsubs.length = 0;
			stepSubs.length = 0;
			// Invalidate approval controls so stale calls throw
			for (const name of stepNames) {
				const def = steps[name] as any;
				if (typeof def._destroy === "function") def._destroy();
			}
		},
		inner: {
			streamStatus,
			stepMeta: stepMetaResult,
			order,
		},
	};
}
