// ---------------------------------------------------------------------------
// pipelineRunner — supervisor for long-running pipelines
// ---------------------------------------------------------------------------
// Manages lifecycle of multiple pipelines: health checks, auto-restart on
// failure, backoff between restarts. Think PM2/systemd for pipeline().
//
// Usage:
//   const runner = pipelineRunner([
//     { name: "ingest", factory: () => pipeline({ ... }) },
//     { name: "process", factory: () => pipeline({ ... }), restart: { backoff: exponential() } },
//   ]);
//   runner.status.get(); // "running" | "degraded" | "stopped"
//   runner.destroy();
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store, WritableStore } from "../core/types";
import type { BackoffStrategy } from "../utils/backoff";
import { exponential } from "../utils/backoff";
import type { PipelineResult, PipelineStatus } from "./pipeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineRunnerConfig {
	/** Unique name for this managed pipeline. */
	name: string;
	/** Factory that creates a fresh pipeline instance. Called on start and each restart. */
	factory: () => PipelineResult<any>;
	/** Restart policy. Default: enabled with exponential backoff, unlimited restarts. */
	restart?: {
		/** Whether auto-restart is enabled. Default: true. */
		enabled?: boolean;
		/** Max consecutive restarts before giving up (marks pipeline "stopped"). Default: Infinity. */
		maxRestarts?: number;
		/** Backoff strategy for delays between restarts. Default: exponential(). */
		backoff?: BackoffStrategy;
	};
	/** Optional periodic health check. */
	healthCheck?: {
		/** Interval in ms between health checks. Default: 30_000. */
		intervalMs?: number;
		/** Custom health probe. Return false or throw to mark unhealthy → trigger restart. */
		fn: (pipeline: PipelineResult<any>) => boolean | Promise<boolean>;
	};
}

export type RunnerStatus = "running" | "degraded" | "stopped";

export interface ManagedPipeline {
	/** Reactive reference to the current pipeline instance. Null when stopped. Updates on restart. */
	pipeline: Store<PipelineResult<any> | null>;
	/** Reactive pipeline status (mirrors the managed pipeline's status store). */
	status: Store<PipelineStatus | "stopped">;
	/** Number of times this pipeline has been restarted. */
	restartCount: Store<number>;
	/** Whether the last health check passed. */
	healthy: Store<boolean>;
}

export interface PipelineRunnerResult {
	/** Per-pipeline managed state, keyed by config name. */
	pipelines: Record<string, ManagedPipeline>;
	/** Aggregate runner status: "running" if all healthy, "degraded" if any unhealthy, "stopped" if all stopped. */
	status: Store<RunnerStatus>;
	/** Manually restart a specific pipeline by name. */
	restart(name: string): void;
	/** Stop a pipeline (or all if no name). Stopped pipelines do not auto-restart. */
	stop(name?: string): void;
	/** Start a previously stopped pipeline (or all if no name). */
	start(name?: string): void;
	/** Destroy the runner and all managed pipelines. */
	destroy(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface ManagedEntry {
	config: PipelineRunnerConfig;
	pipeline: PipelineResult<any> | null;
	pipelineStore: WritableStore<PipelineResult<any> | null>;
	statusStore: WritableStore<PipelineStatus | "stopped">;
	restartCountStore: WritableStore<number>;
	healthyStore: WritableStore<boolean>;
	statusUnsub: { unsubscribe(): void } | null;
	healthTimer: ReturnType<typeof setInterval> | null;
	restartTimer: ReturnType<typeof setTimeout> | null;
	/** Whether this entry is actively managed (not manually stopped). */
	active: boolean;
	/** Consecutive restart count (resets on successful run). */
	consecutiveRestarts: number;
	/** Last backoff delay (for stateful backoff strategies like decorrelatedJitter). */
	lastDelay: number | undefined;
	/** Generation counter — incremented on each restart/rewire. Health check callbacks check this to discard stale results. */
	generation: number;
	/** Whether the runner itself is destroyed. */
	destroyed: boolean;
}

/**
 * Supervisor for long-running pipelines. Creates, monitors, and auto-restarts
 * pipelines on failure. Provides aggregate health status.
 *
 * @param configs - Array of pipeline configurations to manage.
 *
 * @returns `PipelineRunnerResult` — managed pipelines, aggregate status, lifecycle controls.
 *
 * @example
 * ```ts
 * import { pipelineRunner } from 'callbag-recharge/orchestrate';
 * import { pipeline, step, task, fromTrigger } from 'callbag-recharge/orchestrate';
 * import { exponential } from 'callbag-recharge/utils';
 *
 * const runner = pipelineRunner([
 *   {
 *     name: "ingest",
 *     factory: () => pipeline({
 *       trigger: step(fromTrigger<string>()),
 *       fetch: task(["trigger"], async (url) => fetch(url).then(r => r.json())),
 *     }),
 *     restart: { backoff: exponential({ base: 1000 }) },
 *   },
 * ]);
 *
 * runner.status.get(); // "running"
 * runner.destroy();
 * ```
 *
 * @category orchestrate
 */
export function pipelineRunner(configs: PipelineRunnerConfig[]): PipelineRunnerResult {
	// Validate unique names
	const names = new Set<string>();
	for (const cfg of configs) {
		if (names.has(cfg.name)) {
			throw new Error(`pipelineRunner: duplicate pipeline name "${cfg.name}"`);
		}
		names.add(cfg.name);
	}

	const entries = new Map<string, ManagedEntry>();
	let runnerDestroyed = false;

	// --- Create managed entries ---
	for (const config of configs) {
		const entry: ManagedEntry = {
			config,
			pipeline: null,
			pipelineStore: state<PipelineResult<any> | null>(null, {
				name: `runner:${config.name}:pipeline`,
			}),
			statusStore: state<PipelineStatus | "stopped">("idle", {
				name: `runner:${config.name}:status`,
				equals: () => false,
			}),
			restartCountStore: state<number>(0, {
				name: `runner:${config.name}:restartCount`,
			}),
			healthyStore: state<boolean>(true, {
				name: `runner:${config.name}:healthy`,
			}),
			statusUnsub: null,
			healthTimer: null,
			restartTimer: null,
			active: true,
			consecutiveRestarts: 0,
			lastDelay: undefined,
			generation: 0,
			destroyed: false,
		};
		entries.set(config.name, entry);
	}

	// --- Wire a managed pipeline ---
	function wirePipeline(entry: ManagedEntry): void {
		if (runnerDestroyed || entry.destroyed || !entry.active) return;

		entry.generation++;
		try {
			const pl = entry.config.factory();
			entry.pipeline = pl;
			entry.pipelineStore.set(pl);

			// Subscribe to pipeline status
			entry.statusUnsub = subscribe(pl.status, (status) => {
				if (entry.destroyed) return;
				entry.statusStore.set(status);

				// Reset consecutive restart counter on successful completion
				if (status === "completed") {
					entry.consecutiveRestarts = 0;
					entry.lastDelay = undefined;
				}

				// Auto-restart on error
				if (status === "errored" && entry.active) {
					scheduleRestart(entry);
				}
			});

			// Start health check if configured
			if (entry.config.healthCheck) {
				const { intervalMs = 30_000, fn } = entry.config.healthCheck;
				const gen = entry.generation;
				entry.healthTimer = setInterval(() => {
					if (entry.destroyed || !entry.pipeline || !entry.active) return;
					if (entry.generation !== gen) return; // stale timer from previous pipeline
					runHealthCheck(entry, fn, gen);
				}, intervalMs);
			}
		} catch (_err) {
			// Factory threw — mark as errored and schedule restart
			entry.statusStore.set("errored");
			entry.healthyStore.set(false);
			if (entry.active) {
				scheduleRestart(entry);
			}
		}
	}

	function runHealthCheck(
		entry: ManagedEntry,
		fn: (pipeline: PipelineResult<any>) => boolean | Promise<boolean>,
		gen: number,
	): void {
		if (!entry.pipeline) return;

		try {
			const result = fn(entry.pipeline);
			if (result instanceof Promise) {
				result.then(
					(healthy) => {
						if (entry.destroyed || entry.generation !== gen) return;
						entry.healthyStore.set(healthy);
						if (!healthy && entry.active) {
							scheduleRestart(entry);
						}
					},
					() => {
						if (entry.destroyed || entry.generation !== gen) return;
						entry.healthyStore.set(false);
						if (entry.active) {
							scheduleRestart(entry);
						}
					},
				);
			} else {
				entry.healthyStore.set(result);
				if (!result && entry.active) {
					scheduleRestart(entry);
				}
			}
		} catch {
			entry.healthyStore.set(false);
			if (entry.active) {
				scheduleRestart(entry);
			}
		}
	}

	function scheduleRestart(entry: ManagedEntry): void {
		if (entry.destroyed || !entry.active) return;
		// Already pending restart
		if (entry.restartTimer !== null) return;

		const restartConfig = entry.config.restart;
		const enabled = restartConfig?.enabled !== false;
		if (!enabled) {
			// Restart disabled — mark stopped
			entry.active = false;
			entry.statusStore.set("stopped");
			return;
		}

		const maxRestarts = restartConfig?.maxRestarts ?? Infinity;
		if (entry.consecutiveRestarts >= maxRestarts) {
			// Exhausted restarts — mark stopped
			entry.active = false;
			entry.statusStore.set("stopped");
			return;
		}

		const backoff = restartConfig?.backoff ?? exponential();
		const delay = backoff(entry.consecutiveRestarts, undefined, entry.lastDelay);

		if (delay === null) {
			// Backoff says stop
			entry.active = false;
			entry.statusStore.set("stopped");
			return;
		}

		entry.lastDelay = delay;

		entry.restartTimer = setTimeout(() => {
			entry.restartTimer = null;
			if (entry.destroyed || !entry.active) return;
			doRestart(entry);
		}, delay);
	}

	function doRestart(entry: ManagedEntry): void {
		if (entry.destroyed) return;

		// Tear down old pipeline
		teardownPipeline(entry);

		entry.consecutiveRestarts++;
		batch(() => {
			entry.restartCountStore.set(entry.restartCountStore.get() + 1);
			entry.healthyStore.set(true);
		});

		// Create new pipeline
		wirePipeline(entry);
	}

	function teardownPipeline(entry: ManagedEntry): void {
		if (entry.restartTimer !== null) {
			clearTimeout(entry.restartTimer);
			entry.restartTimer = null;
		}
		if (entry.healthTimer !== null) {
			clearInterval(entry.healthTimer);
			entry.healthTimer = null;
		}
		if (entry.statusUnsub) {
			entry.statusUnsub.unsubscribe();
			entry.statusUnsub = null;
		}
		if (entry.pipeline) {
			entry.pipeline.destroy();
			entry.pipeline = null;
			entry.pipelineStore.set(null);
		}
	}

	function stopEntry(entry: ManagedEntry): void {
		entry.active = false;
		teardownPipeline(entry);
		entry.statusStore.set("stopped");
	}

	function startEntry(entry: ManagedEntry): void {
		if (entry.destroyed) return;
		if (entry.active && entry.pipeline) return; // already running

		// Clear any stale restart timer from previous lifecycle
		if (entry.restartTimer !== null) {
			clearTimeout(entry.restartTimer);
			entry.restartTimer = null;
		}

		entry.active = true;
		entry.consecutiveRestarts = 0;
		entry.lastDelay = undefined;
		entry.healthyStore.set(true);
		wirePipeline(entry);
	}

	// --- Aggregate status ---
	const allStatusStores = [...entries.values()].map((e) => e.statusStore);
	const allHealthStores = [...entries.values()].map((e) => e.healthyStore);
	const aggregateStatus = derived([...allStatusStores, ...allHealthStores], () => {
		let allStopped = true;
		let anyDegraded = false;

		for (const entry of entries.values()) {
			const s = entry.statusStore.get();
			if (s !== "stopped") allStopped = false;
			if (s === "errored" || !entry.healthyStore.get()) anyDegraded = true;
		}

		if (allStopped) return "stopped" as RunnerStatus;
		if (anyDegraded) return "degraded" as RunnerStatus;
		return "running" as RunnerStatus;
	});

	// Keep aggregate status alive
	const aggregateUnsub = subscribe(aggregateStatus, () => {});

	// --- Start all pipelines ---
	for (const entry of entries.values()) {
		wirePipeline(entry);
	}

	// --- Build result ---
	const pipelinesResult: Record<string, ManagedPipeline> = {};
	for (const [name, entry] of entries) {
		pipelinesResult[name] = {
			pipeline: entry.pipelineStore,
			status: entry.statusStore,
			restartCount: entry.restartCountStore,
			healthy: entry.healthyStore,
		};
	}

	return {
		pipelines: pipelinesResult,
		status: aggregateStatus,

		restart(name: string): void {
			const entry = entries.get(name);
			if (!entry) throw new Error(`pipelineRunner: unknown pipeline "${name}"`);
			if (entry.destroyed) return;

			entry.active = true;
			entry.consecutiveRestarts = 0;
			entry.lastDelay = undefined;
			doRestart(entry);
		},

		stop(name?: string): void {
			if (name !== undefined) {
				const entry = entries.get(name);
				if (!entry) throw new Error(`pipelineRunner: unknown pipeline "${name}"`);
				stopEntry(entry);
			} else {
				for (const entry of entries.values()) {
					stopEntry(entry);
				}
			}
		},

		start(name?: string): void {
			if (name !== undefined) {
				const entry = entries.get(name);
				if (!entry) throw new Error(`pipelineRunner: unknown pipeline "${name}"`);
				startEntry(entry);
			} else {
				for (const entry of entries.values()) {
					if (!entry.active) startEntry(entry);
				}
			}
		},

		destroy(): void {
			if (runnerDestroyed) return;
			runnerDestroyed = true;

			// Teardown aggregate status — cascades END to subscribers
			aggregateUnsub.unsubscribe();
			teardown(aggregateStatus);

			// Signal TEARDOWN to each managed pipeline, then teardown companion stores.
			// pipeline.destroy() already sends TEARDOWN signals through its graph (5f-6).
			for (const entry of entries.values()) {
				entry.destroyed = true;
				teardownPipeline(entry);
				// Teardown companion stores — cascades END to any subscribers
				teardown(entry.pipelineStore);
				teardown(entry.statusStore);
				teardown(entry.restartCountStore);
				teardown(entry.healthyStore);
			}
		},
	};
}
