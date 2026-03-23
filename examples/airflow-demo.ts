/**
 * Airflow demo — interactive DAG with pipeline() + task()
 *
 * A personal finance DAG: cron → fetch bank + fetch cards → aggregate →
 * detect anomaly + batch write → alert. Uses high-level task() API —
 * the framework handles switchMap, combine, undefined guards, taskState,
 * and re-trigger cancellation automatically.
 *
 * This file is the store layer for the interactive Vue demo at site/demos/airflow.
 * The Vue component imports from here — no library logic lives in the site.
 *
 * Run: pnpm exec tsx --tsconfig tsconfig.examples.json examples/airflow-demo.ts
 */

// NOTE: Deep imports to avoid pulling in node:fs from checkpoint adapters.

import type { Store } from "callbag-recharge";
import { state } from "callbag-recharge";
import type { ReactiveLog } from "callbag-recharge/data";
import { reactiveLog } from "callbag-recharge/data";
import { firstValueFrom, fromTimer, fromTrigger, subscribe } from "callbag-recharge/extra";
import { pipeline, source } from "callbag-recharge/orchestrate/pipeline";
import { task } from "callbag-recharge/orchestrate/task";
import type { TaskState } from "callbag-recharge/orchestrate/types";
import { TASK_STATE } from "callbag-recharge/orchestrate/types";
import { exponential } from "callbag-recharge/utils/backoff";
import { circuitBreaker } from "callbag-recharge/utils/circuitBreaker";

// ---------------------------------------------------------------------------
// Node metadata — circuitBreaker + reactiveLog per task
// ---------------------------------------------------------------------------
export interface PipelineNode {
	id: string;
	label: string;
	task: TaskState;
	log: ReactiveLog<string>;
	breaker: ReturnType<typeof circuitBreaker>;
	/** Reactive circuit breaker state ("closed" | "open" | "half-open"). */
	breakerState: Store<string>;
}

interface NodeMeta {
	id: string;
	label: string;
	log: ReactiveLog<string>;
	breaker: ReturnType<typeof circuitBreaker>;
	breakerState: Store<string>;
}

function createMeta(id: string, label: string): NodeMeta {
	return {
		id,
		label,
		log: reactiveLog<string>({ id: `${id}:log`, maxSize: 50 }),
		breaker: circuitBreaker({
			failureThreshold: 3,
			cooldownMs: 5000,
			cooldown: exponential({ base: 1000, factor: 2, max: 10000 }),
		}),
		breakerState: state<string>("closed", { name: `${id}:breakerState` }),
	};
}

// Simulate async work with random duration and failure chance
async function simulateWork(
	meta: NodeMeta,
	durationRange: [number, number],
	failRate = 0.15,
): Promise<string> {
	const [min, max] = durationRange;
	const duration = min + Math.random() * (max - min);
	await firstValueFrom(fromTimer(duration));
	if (Math.random() < failRate) {
		meta.breaker.recordFailure();
		meta.breakerState.set(meta.breaker.state);
		meta.log.append(`[ERROR] Failed after ${Math.round(duration)}ms`);
		throw new Error(`${meta.label} failed`);
	}
	meta.breaker.recordSuccess();
	meta.breakerState.set(meta.breaker.state);
	meta.log.append(`[OK] Completed in ${Math.round(duration)}ms`);
	return `${meta.label} result`;
}

// ---------------------------------------------------------------------------
// Edge definition (static)
// ---------------------------------------------------------------------------
export const edges = [
	{ source: "cron", target: "fetch-bank" },
	{ source: "cron", target: "fetch-cards" },
	{ source: "fetch-bank", target: "aggregate" },
	{ source: "fetch-cards", target: "aggregate" },
	{ source: "aggregate", target: "anomaly" },
	{ source: "aggregate", target: "batch-write" },
	{ source: "anomaly", target: "alert" },
] as const;

// ---------------------------------------------------------------------------
// Node metadata instances
// ---------------------------------------------------------------------------
const n = {
	cron: createMeta("cron", "Cron Trigger"),
	fetchBank: createMeta("fetch-bank", "Fetch Bank"),
	fetchCards: createMeta("fetch-cards", "Fetch Cards"),
	aggregate: createMeta("aggregate", "Aggregate"),
	anomaly: createMeta("anomaly", "Detect Anomaly"),
	batchWrite: createMeta("batch-write", "Batch Write"),
	alert: createMeta("alert", "Send Alert"),
};

// ---------------------------------------------------------------------------
// Pipeline run state
// ---------------------------------------------------------------------------
export const running = state(false, { name: "pipeline:running" });
export const runCount = state(0, { name: "pipeline:runCount" });

let _pipelineStatusUnsub: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Declarative pipeline wiring via pipeline() + task()
// ---------------------------------------------------------------------------
const triggerSrc = fromTrigger<string>({ name: "pipeline:trigger" });

// #region display
const cronDef = task(
	["trigger"],
	async (_signal, [_v]) => {
		n.cron.log.append("[TRIGGER] Pipeline started");
		n.cron.breaker.recordSuccess();
		n.cron.breakerState.set(n.cron.breaker.state);
		n.cron.log.append("[OK] Trigger fired");
		return "triggered";
	},
	{ name: "cron" },
);

const fetchBankDef = task(
	["cron"],
	async (_signal, [_v]) => simulateWork(n.fetchBank, [800, 2000], 0.2),
	{
		name: "fetchBank",
		skip: () => !n.fetchBank.breaker.canExecute(),
		onSkip: () => {
			n.fetchBank.breakerState.set(n.fetchBank.breaker.state);
			n.fetchBank.log.append("[CIRCUIT OPEN] Skipped — breaker is open");
		},
		onStart: () => {
			n.fetchBank.breakerState.set(n.fetchBank.breaker.state);
			n.fetchBank.log.append("[START] Running...");
		},
	},
);

const fetchCardsDef = task(
	["cron"],
	async (_signal, [_v]) => simulateWork(n.fetchCards, [600, 1500], 0.15),
	{
		name: "fetchCards",
		skip: () => !n.fetchCards.breaker.canExecute(),
		onSkip: () => {
			n.fetchCards.breakerState.set(n.fetchCards.breaker.state);
			n.fetchCards.log.append("[CIRCUIT OPEN] Skipped — breaker is open");
		},
		onStart: () => {
			n.fetchCards.breakerState.set(n.fetchCards.breaker.state);
			n.fetchCards.log.append("[START] Running...");
		},
	},
);

const aggregateDef = task(
	["fetchBank", "fetchCards"],
	async (_signal, [bankVal, cardsVal]) => {
		n.aggregate.log.append(
			`[START] Merging: bank=${bankVal ? "ok" : "fail"}, cards=${cardsVal ? "ok" : "fail"}`,
		);
		return simulateWork(n.aggregate, [300, 800], 0.05);
	},
	{
		name: "aggregate",
		// No skip predicate needed — the undefined guard automatically blocks
		// when either upstream emits undefined (error/skip). Pipeline skip
		// propagation marks this task as "skipped".
		onStart: () => n.aggregate.log.append("[START] Aggregating..."),
	},
);

const anomalyDef = task(
	["aggregate"],
	async (_signal, [_v]) => simulateWork(n.anomaly, [200, 600], 0.1),
	{
		name: "anomaly",
		onStart: () => n.anomaly.log.append("[START] Running..."),
	},
);

const batchWriteDef = task(
	["aggregate"],
	async (_signal, [_v]) => simulateWork(n.batchWrite, [400, 1000], 0.08),
	{
		name: "batchWrite",
		onStart: () => n.batchWrite.log.append("[START] Running..."),
	},
);

const alertDef = task(
	["anomaly"],
	async (_signal, [_v]) => simulateWork(n.alert, [100, 300], 0.02),
	{
		name: "alert",
		onStart: () => n.alert.log.append("[START] Running..."),
	},
);

const wf = pipeline({
	trigger: source(triggerSrc),
	cron: cronDef,
	fetchBank: fetchBankDef,
	fetchCards: fetchCardsDef,
	aggregate: aggregateDef,
	anomaly: anomalyDef,
	batchWrite: batchWriteDef,
	alert: alertDef,
});
// #endregion display

// ---------------------------------------------------------------------------
// Build PipelineNode array — combine metadata + TaskState from task() defs
// ---------------------------------------------------------------------------
function buildNode(meta: NodeMeta, def: any): PipelineNode {
	return { ...meta, task: def[TASK_STATE] as TaskState };
}

export const nodes: PipelineNode[] = [
	buildNode(n.cron, cronDef),
	buildNode(n.fetchBank, fetchBankDef),
	buildNode(n.fetchCards, fetchCardsDef),
	buildNode(n.aggregate, aggregateDef),
	buildNode(n.anomaly, anomalyDef),
	buildNode(n.batchWrite, batchWriteDef),
	buildNode(n.alert, alertDef),
];

// ---------------------------------------------------------------------------
// Trigger / stop / destroy
// ---------------------------------------------------------------------------
function finishRun() {
	if (!_pipelineStatusUnsub) return;
	running.set(false);
	runCount.update((n) => n + 1);
	const unsub = _pipelineStatusUnsub;
	_pipelineStatusUnsub = null;
	queueMicrotask(() => unsub());
}

export function trigger() {
	if (running.get()) return;
	running.set(true);
	// RESET clears pipeline status and restarts task states (preserving runCount).
	wf.reset();

	// Subscribe BEFORE firing so no status transitions can be missed.
	_pipelineStatusUnsub = subscribe(wf.status, (rs) => {
		if (rs === "completed" || rs === "errored") finishRun();
	});

	triggerSrc.fire("go");
}

// Lightweight stop for SPA unmount — does not destroy stores (safe for remount).
export function stop() {
	if (_pipelineStatusUnsub) {
		_pipelineStatusUnsub();
		_pipelineStatusUnsub = null;
	}
	running.set(false);
}

export function destroy() {
	if (_pipelineStatusUnsub) {
		_pipelineStatusUnsub();
		_pipelineStatusUnsub = null;
	}
	wf.destroy();
	for (const meta of Object.values(n)) {
		meta.log.destroy();
	}
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
if (typeof process !== "undefined" && process.argv?.[1]?.includes("airflow-demo")) {
	console.log("=== Airflow Demo: Personal Finance Pipeline ===\n");

	trigger();

	(async () => {
		await firstValueFrom(fromTimer(4000));
		console.log(`\n=== Run complete (${runCount.get()} runs) ===`);
		for (const node of nodes) {
			const meta = node.task.get();
			console.log(`  ${node.label}: ${meta.status} (runs: ${meta.runCount})`);
		}
		destroy();
		console.log("--- done ---");
	})();
}
