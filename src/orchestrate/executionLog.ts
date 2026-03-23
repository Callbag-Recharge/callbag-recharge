// ---------------------------------------------------------------------------
// executionLog — Phase 3b: reactive execution history
// ---------------------------------------------------------------------------
// A reactiveLog-backed execution history that pipeline() can auto-write to.
// Each step event (start, value, complete, error) is appended as an entry.
// Pluggable persistence via an optional adapter.
//
// Usage:
//   const log = executionLog({ maxSize: 1000 });
//   const wf = pipeline({ ... }, { executionLog: log });
//   // log.entries() → all execution events
//   // log.forStep("trigger") → events for a specific step
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { effect } from "../core/effect";
import { teardown } from "../core/protocol";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";
import { reactiveLog } from "../data/reactiveLog";
import type { ReactiveLog } from "../data/types";

export type ExecutionEventType = "start" | "value" | "complete" | "error";

export interface ExecutionEntry {
	/** Step name (or pipeline-level event). */
	step: string;
	/** Event type. */
	event: ExecutionEventType;
	/** Timestamp (ms since epoch). */
	timestamp: number;
	/** Value payload (for "value" events). */
	value?: unknown;
	/** Error payload (for "error" events). */
	error?: unknown;
	/** Run count at time of event. */
	runCount?: number;
}

export interface ExecutionLogPersistAdapter {
	/** Append an entry to persistent storage. May be sync or async. */
	append(entry: ExecutionEntry): void | Promise<void>;
	/** Load all persisted entries. */
	load(): ExecutionEntry[] | Promise<ExecutionEntry[]>;
	/** Clear all persisted entries. */
	clear(): void | Promise<void>;
}

export interface ExecutionLogOptions {
	/** Maximum number of entries to keep in memory. Default: unlimited. */
	maxSize?: number;
	/** Debug name. */
	name?: string;
	/** Optional persistence adapter. Entries are written through on append. */
	persist?: ExecutionLogPersistAdapter;
}

export interface ExecutionLogResult {
	/** The underlying reactive log. */
	log: ReactiveLog<ExecutionEntry>;
	/** Append an execution event. */
	append(entry: ExecutionEntry): number;
	/** Get all entries for a specific step. */
	forStep(step: string): ExecutionEntry[];
	/** Reactive store: latest entry. */
	latest: Store<ExecutionEntry | undefined>;
	/** Reactive store: entry count. */
	length: Store<number>;
	/** Reactive store: last persist error (null when healthy). */
	persistError: Store<unknown>;
	/** Clear the log. */
	clear(): void;
	/** Destroy the log and clean up. */
	destroy(): void;
	/**
	 * Connect to a pipeline's stepMeta stores for auto-logging.
	 * Returns an unsubscribe function.
	 */
	connectPipeline(stepMeta: Record<string, Store<any>>, stepNames: string[]): () => void;
}

/**
 * Creates a reactive execution log for workflow step tracking. Backed by `reactiveLog` (Phase 3b).
 *
 * @param opts - Optional configuration.
 *
 * @returns `ExecutionLogResult` — reactive log with step filtering, pipeline auto-connect, and optional persistence.
 *
 * @returnsTable log | ReactiveLog\<ExecutionEntry\> | Underlying reactive log.
 * append(entry) | (entry) => number | Append an execution event.
 * forStep(step) | (step) => ExecutionEntry[] | Get entries for a specific step.
 * latest | Store\<ExecutionEntry \| undefined\> | Reactive latest entry.
 * length | Store\<number\> | Reactive entry count.
 * persistError | Store\<unknown\> | Last persist error (null when healthy).
 * connectPipeline(stepMeta, names) | (...) => () => void | Auto-log pipeline step events.
 * clear() | () => void | Clear the log.
 * destroy() | () => void | Destroy and clean up.
 *
 * @remarks **Auto-logging:** `connectPipeline()` subscribes to per-step metadata stores and auto-appends start/value/complete/error events.
 * @remarks **Persistence:** Optional adapter writes through on every append. Load on construction for recovery.
 * @remarks **Bounded:** Set `maxSize` for production to prevent unbounded memory growth.
 *
 * @example
 * ```ts
 * import { executionLog } from 'callbag-recharge/orchestrate';
 * import { pipeline, step, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * const log = executionLog({ maxSize: 500 });
 * const wf = pipeline({
 *   trigger: step(fromTrigger<number>()),
 * });
 * const unsub = log.connectPipeline(wf.stepMeta, wf.order);
 * // Events auto-logged as pipeline runs
 * log.forStep("trigger"); // all events for "trigger" step
 * unsub();
 * ```
 *
 * @seeAlso [pipeline](./pipeline) — workflow builder, [reactiveLog](./reactiveLog) — underlying data structure
 *
 * @category orchestrate
 */
export function executionLog(opts?: ExecutionLogOptions): ExecutionLogResult {
	const baseName = opts?.name ?? "executionLog";
	const persist = opts?.persist;

	const log = reactiveLog<ExecutionEntry>({
		id: baseName,
		maxSize: opts?.maxSize,
	});

	// Step index for fast forStep() lookups
	const _stepIndex = new Map<string, number[]>();

	// Sentinel store: when torn down, all connectPipeline effects auto-dispose via the graph
	const _alive = state(true, { name: `${baseName}:alive` });

	// Persist error store — surfaces adapter failures
	const persistErrorStore = state<unknown>(null, { name: `${baseName}:persistError` });

	function append(entry: ExecutionEntry): number {
		const seq = log.append(entry);
		// Update step index
		const seqs = _stepIndex.get(entry.step);
		if (seqs) {
			seqs.push(seq);
		} else {
			_stepIndex.set(entry.step, [seq]);
		}
		// Persist
		if (persist) {
			try {
				const result = persist.append(entry);
				if (result instanceof Promise) {
					result
						.then(() => {
							if (persistErrorStore.get() !== null) persistErrorStore.set(null);
						})
						.catch((err) => persistErrorStore.set(err));
				} else if (persistErrorStore.get() !== null) {
					persistErrorStore.set(null);
				}
			} catch (err) {
				persistErrorStore.set(err);
			}
		}
		return seq;
	}

	function forStep(step: string): ExecutionEntry[] {
		const seqs = _stepIndex.get(step);
		if (!seqs) return [];
		const entries: ExecutionEntry[] = [];
		for (const seq of seqs) {
			const entry = log.get(seq);
			if (entry) entries.push(entry.value);
		}
		return entries;
	}

	// Derive latest entry from the reactive log's latest
	const latest = derived(
		[log.latest],
		() => {
			const l = log.latest.get();
			return l?.value;
		},
		{ name: `${baseName}:latest` },
	) as Store<ExecutionEntry | undefined>;

	function connectPipeline(stepMeta: Record<string, Store<any>>, stepNames: string[]): () => void {
		const subs: { unsubscribe(): void }[] = [];

		for (const name of stepNames) {
			const meta = stepMeta[name];
			if (!meta) continue;

			let prevStatus: string | undefined;
			let prevCount = 0;

			const sub = subscribe(meta, (m: any) => {
				const now = Date.now();
				const status = m.status as string | undefined;
				const count = (m.count as number) ?? 0;
				const err = m.error;

				if (status == null) return;

				if (status === "active" && prevStatus !== "active") {
					append({ step: name, event: "start", timestamp: now, runCount: count });
				}

				// Track value events separately from start: only fire when count
				// increases AND we already knew about the active status (not first emit)
				if (count > prevCount && prevStatus === "active" && status === "active") {
					append({ step: name, event: "value", timestamp: now, runCount: count });
				}

				if (status === "completed" && prevStatus !== "completed") {
					append({ step: name, event: "complete", timestamp: now, runCount: count });
				}

				if (status === "errored" && prevStatus !== "errored") {
					append({
						step: name,
						event: "error",
						timestamp: now,
						error: err,
						runCount: count,
					});
				}

				prevStatus = status;
				prevCount = count;
			});
			subs.push(sub);
		}

		const disconnect = () => {
			for (const sub of subs) sub.unsubscribe();
			subs.length = 0;
		};

		// Wire cleanup into graph: when _alive is torn down (END), this effect
		// auto-disposes, running disconnect(). No flat list needed.
		const disposeGuard = effect([_alive], () => disconnect);

		return () => {
			disconnect();
			disposeGuard();
		};
	}

	return {
		log,
		append,
		forStep,
		latest,
		length: log.lengthStore,
		persistError: persistErrorStore,
		clear() {
			log.clear();
			_stepIndex.clear();
			if (persist) {
				try {
					const result = persist.clear();
					if (result instanceof Promise) {
						result.catch((err) => persistErrorStore.set(err));
					}
				} catch (err) {
					persistErrorStore.set(err);
				}
			}
		},
		destroy() {
			log.destroy();
			_stepIndex.clear();
			teardown(persistErrorStore);
			// Cascades END to all connectPipeline guard effects, auto-disposing them
			teardown(_alive);
		},
		connectPipeline,
	};
}

// ---------------------------------------------------------------------------
// Built-in persistence adapter: in-memory (for testing)
// ---------------------------------------------------------------------------

/**
 * In-memory execution log persistence adapter. Useful for testing.
 */
export function memoryLogAdapter(): ExecutionLogPersistAdapter {
	const entries: ExecutionEntry[] = [];
	return {
		append(entry) {
			entries.push(entry);
		},
		load() {
			return [...entries];
		},
		clear() {
			entries.length = 0;
		},
	};
}
