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
 * Demonstrates: pipeline, task, source, workflowNode (orchestrate),
 * fromTrigger (extra).
 *
 * Run: pnpm exec tsx --tsconfig tsconfig.examples.json examples/airflow-demo.ts
 */

import { effect, state } from "callbag-recharge";
import type { ReactiveLog } from "callbag-recharge/data";
import { firstValueFrom, fromTimer, fromTrigger } from "callbag-recharge/extra";
import type { TaskState, WorkflowNodeResult } from "callbag-recharge/orchestrate";
import { pipeline, source, TASK_STATE, task, workflowNode } from "callbag-recharge/orchestrate";
import type { CircuitBreaker } from "callbag-recharge/utils/circuitBreaker";

// ---------------------------------------------------------------------------
// Node metadata — workflowNode bundles log + circuit breaker + simulate
// ---------------------------------------------------------------------------
export interface PipelineNode {
	id: string;
	label: string;
	task: TaskState;
	log: ReactiveLog<string>;
	breaker: CircuitBreaker;
	/** Reactive circuit breaker state ("closed" | "open" | "half-open"). */
	breakerState: WorkflowNodeResult["breakerState"];
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
	cron: workflowNode("cron", "Cron Trigger"),
	fetchBank: workflowNode("fetch-bank", "Fetch Bank"),
	fetchCards: workflowNode("fetch-cards", "Fetch Cards"),
	aggregate: workflowNode("aggregate", "Aggregate"),
	anomaly: workflowNode("anomaly", "Detect Anomaly"),
	batchWrite: workflowNode("batch-write", "Batch Write"),
	alert: workflowNode("alert", "Send Alert"),
};

// ---------------------------------------------------------------------------
// Pipeline run state
// ---------------------------------------------------------------------------
export const running = state(false, { name: "pipeline:running" });
export const runCount = state(0, { name: "pipeline:runCount" });

// ---------------------------------------------------------------------------
// Declarative pipeline wiring via pipeline() + task()
// ---------------------------------------------------------------------------
const triggerSrc = fromTrigger<string>({ name: "pipeline:trigger" });

// #region display
const cronDef = task(
	["trigger"],
	async (signal, [_v]) => {
		n.cron.log.append("[TRIGGER] Pipeline started");
		// Cron is a trigger node — use simulate with 0% failure for consistent
		// breaker bookkeeping (no special-cased manual recordSuccess).
		return n.cron.simulate([0, 0], 0, signal);
	},
	{ name: "cron" },
);

const fetchBankDef = task(
	["cron"],
	async (signal, [_v]) => n.fetchBank.simulate([800, 2000], 0.2, signal),
	{
		name: "fetchBank",
		skip: () => !n.fetchBank.breaker.canExecute(),
		onSkip: () => {
			n.fetchBank.breakerState.set(n.fetchBank.breaker.state);
			n.fetchBank.log.append("[CIRCUIT OPEN] Skipped — breaker is open");
		},
		onStart: () => {
			// Sync breakerState after canExecute() may have transitioned to half-open
			n.fetchBank.breakerState.set(n.fetchBank.breaker.state);
			n.fetchBank.log.append("[START] Running...");
		},
	},
);

const fetchCardsDef = task(
	["cron"],
	async (signal, [_v]) => n.fetchCards.simulate([600, 1500], 0.15, signal),
	{
		name: "fetchCards",
		skip: () => !n.fetchCards.breaker.canExecute(),
		onSkip: () => {
			n.fetchCards.breakerState.set(n.fetchCards.breaker.state);
			n.fetchCards.log.append("[CIRCUIT OPEN] Skipped — breaker is open");
		},
		onStart: () => {
			// Sync breakerState after canExecute() may have transitioned to half-open
			n.fetchCards.breakerState.set(n.fetchCards.breaker.state);
			n.fetchCards.log.append("[START] Running...");
		},
	},
);

const aggregateDef = task(
	["fetchBank", "fetchCards"],
	async (signal, [bankVal, cardsVal]) => {
		n.aggregate.log.append(
			`[START] Merging: bank=${bankVal ? "ok" : "fail"}, cards=${cardsVal ? "ok" : "fail"}`,
		);
		return n.aggregate.simulate([300, 800], 0.05, signal);
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
	async (signal, [_v]) => n.anomaly.simulate([200, 600], 0.1, signal),
	{
		name: "anomaly",
		onStart: () => n.anomaly.log.append("[START] Running..."),
	},
);

const batchWriteDef = task(
	["aggregate"],
	async (signal, [_v]) => n.batchWrite.simulate([400, 1000], 0.08, signal),
	{
		name: "batchWrite",
		onStart: () => n.batchWrite.log.append("[START] Running..."),
	},
);

const alertDef = task(
	["anomaly"],
	async (signal, [_v]) => n.alert.simulate([100, 300], 0.02, signal),
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

// Reactive completion: when pipeline finishes while running, update state
const disposeStatusEffect = effect([running, wf.status], () => {
	if (running.get() && (wf.status.get() === "completed" || wf.status.get() === "errored")) {
		running.set(false);
		runCount.update((n) => n + 1);
	}
});

// ---------------------------------------------------------------------------
// Build PipelineNode array — combine metadata + TaskState from task() defs
// ---------------------------------------------------------------------------
function buildNode(meta: WorkflowNodeResult, def: any): PipelineNode {
	return {
		id: meta.id,
		label: meta.label,
		task: def[TASK_STATE] as TaskState,
		log: meta.log,
		breaker: meta.breaker,
		breakerState: meta.breakerState,
	};
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
export function trigger() {
	if (running.get()) return;
	// RESET clears pipeline status and restarts task states (preserving runCount).
	wf.reset();
	// Reset circuit breakers so a fresh run starts with clean breaker state.
	for (const node of Object.values(n)) {
		node.reset();
	}
	triggerSrc.fire("go");
	running.set(true);
}

// Lightweight stop for SPA unmount — does not destroy stores (safe for remount).
export function stop() {
	running.set(false);
}

export function destroy() {
	disposeStatusEffect();
	wf.destroy();
	for (const node of Object.values(n)) {
		node.destroy();
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
