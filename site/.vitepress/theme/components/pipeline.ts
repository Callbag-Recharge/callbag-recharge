// ---------------------------------------------------------------------------
// Pipeline definition — pure callbag-recharge, zero UI code
// ---------------------------------------------------------------------------
// A personal finance DAG: cron → fetch bank + fetch cards → aggregate →
// detect anomaly + batch write → alert. Shows diamond resolution, retry,
// circuit breaker, reactive logging — all with library primitives.
// ---------------------------------------------------------------------------

import { state } from "@lib/core/state";
import type { Store } from "@lib/core/types";
import { reactiveLog } from "@lib/data/reactiveLog";
import type { ReactiveLog } from "@lib/data/types";
import { taskState } from "@lib/orchestrate/taskState";
import type { TaskState } from "@lib/orchestrate/types";
import { exponential } from "@lib/utils/backoff";
import { circuitBreaker } from "@lib/utils/circuitBreaker";

// ---------------------------------------------------------------------------
// Task node — combines taskState + circuitBreaker + reactiveLog
// ---------------------------------------------------------------------------
export interface PipelineNode {
	id: string;
	label: string;
	task: TaskState;
	log: ReactiveLog<string>;
	breaker: ReturnType<typeof circuitBreaker>;
}

function createNode(id: string, label: string): PipelineNode {
	return {
		id,
		label,
		task: taskState({ id }),
		log: reactiveLog<string>({ id: `${id}:log`, maxSize: 50 }),
		breaker: circuitBreaker({
			failureThreshold: 3,
			cooldownMs: 5000,
			cooldown: exponential({ base: 1000, factor: 2, max: 10000 }),
		}),
	};
}

// Simulate async work with random duration and failure chance
function simulateWork(
	node: PipelineNode,
	durationRange: [number, number],
	failRate = 0.15,
): Promise<string> {
	const [min, max] = durationRange;
	const duration = min + Math.random() * (max - min);

	return new Promise((resolve, reject) => {
		setTimeout(() => {
			if (Math.random() < failRate) {
				node.breaker.recordFailure();
				node.log.append(`[ERROR] Failed after ${Math.round(duration)}ms`);
				reject(new Error(`${node.label} failed`));
			} else {
				node.breaker.recordSuccess();
				node.log.append(`[OK] Completed in ${Math.round(duration)}ms`);
				resolve(`${node.label} result`);
			}
		}, duration);
	});
}

// ---------------------------------------------------------------------------
// DAG definition
// ---------------------------------------------------------------------------
export interface Pipeline {
	nodes: PipelineNode[];
	edges: Array<{ source: string; target: string }>;
	trigger: () => void;
	running: Store<boolean>;
	runCount: Store<number>;
	destroy: () => void;
}

export function createPipeline(): Pipeline {
	// --- Nodes ---
	const cron = createNode("cron", "Cron Trigger");
	const fetchBank = createNode("fetch-bank", "Fetch Bank");
	const fetchCards = createNode("fetch-cards", "Fetch Cards");
	const aggregate = createNode("aggregate", "Aggregate");
	const anomaly = createNode("anomaly", "Detect Anomaly");
	const batchWrite = createNode("batch-write", "Batch Write");
	const alert = createNode("alert", "Send Alert");

	const nodes = [cron, fetchBank, fetchCards, aggregate, anomaly, batchWrite, alert];

	// --- Edges ---
	const edges = [
		{ source: "cron", target: "fetch-bank" },
		{ source: "cron", target: "fetch-cards" },
		{ source: "fetch-bank", target: "aggregate" },
		{ source: "fetch-cards", target: "aggregate" },
		{ source: "aggregate", target: "anomaly" },
		{ source: "aggregate", target: "batch-write" },
		{ source: "anomaly", target: "alert" },
	];

	// --- Run tracking ---
	const _runCount = state(0, { name: "pipeline:runCount" });
	const _running = state(false, { name: "pipeline:running" });

	// --- Pipeline execution ---
	async function runNode(node: PipelineNode, duration: [number, number], failRate?: number) {
		if (!node.breaker.canExecute()) {
			node.log.append("[CIRCUIT OPEN] Skipped — breaker is open");
			return null;
		}
		node.log.append("[START] Running...");
		try {
			const result = await node.task.run(() => simulateWork(node, duration, failRate));
			return result;
		} catch {
			return null;
		}
	}

	async function trigger() {
		if (_running.get()) return;
		_running.set(true);

		// Phase 1: Cron trigger
		cron.log.append("[TRIGGER] Pipeline started");
		await cron.task.run(() => {
			cron.breaker.recordSuccess();
			cron.log.append("[OK] Trigger fired");
			return Promise.resolve("triggered");
		});

		// Phase 2: Parallel fetches (diamond source)
		const [bankResult, cardsResult] = await Promise.allSettled([
			runNode(fetchBank, [800, 2000], 0.2),
			runNode(fetchCards, [600, 1500], 0.15),
		]);

		const bankOk = bankResult.status === "fulfilled" && bankResult.value !== null;
		const cardsOk = cardsResult.status === "fulfilled" && cardsResult.value !== null;

		// Phase 3: Aggregate (diamond resolution — waits for both)
		if (bankOk || cardsOk) {
			aggregate.log.append(
				`[START] Merging: bank=${bankOk ? "ok" : "fail"}, cards=${cardsOk ? "ok" : "fail"}`,
			);
			await runNode(aggregate, [300, 800], 0.05);

			// Phase 4: Parallel outputs
			if (aggregate.task.get().status === "success") {
				await Promise.allSettled([
					runNode(anomaly, [200, 600], 0.1),
					runNode(batchWrite, [400, 1000], 0.08),
				]);

				// Phase 5: Alert (only if anomaly detected)
				if (anomaly.task.get().status === "success") {
					await runNode(alert, [100, 300], 0.02);
				}
			}
		} else {
			aggregate.log.append("[SKIP] Both sources failed");
		}

		_running.set(false);
		_runCount.update((n) => n + 1);
	}

	return {
		nodes,
		edges,
		trigger,
		running: _running as Store<boolean>,
		runCount: _runCount as Store<number>,
		destroy() {
			for (const node of nodes) {
				node.task.destroy();
				node.log.destroy();
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Source code string — displayed in the code panel
// ---------------------------------------------------------------------------
export const PIPELINE_SOURCE = `import { taskState } from 'callbag-recharge/orchestrate'
import { reactiveLog } from 'callbag-recharge/data'
import { circuitBreaker, exponential } from 'callbag-recharge/utils'

// Each task = taskState + circuitBreaker + reactiveLog
const fetchBank  = taskState({ id: 'fetch-bank' })
const fetchCards = taskState({ id: 'fetch-cards' })
const aggregate  = taskState({ id: 'aggregate' })
const anomaly    = taskState({ id: 'anomaly' })
const batchWrite = taskState({ id: 'batch-write' })
const alert      = taskState({ id: 'alert' })

// Circuit breaker with exponential backoff
const breaker = circuitBreaker({
  failureThreshold: 3,
  cooldownMs: 5000,
  cooldown: exponential({ base: 1000, factor: 2 }),
})

// Logs per task — bounded circular buffer
const bankLog = reactiveLog({ id: 'bank:log', maxSize: 50 })

// Run a task with circuit breaker guard
async function runTask(task, work) {
  if (!breaker.canExecute()) return null
  return task.run(work)
}

// Execute the DAG
await runTask(fetchBank, () => plaid.sync())   // parallel
await runTask(fetchCards, () => stripe.list())  // parallel
await aggregate.run(() => merge(bank, cards))   // diamond!
await anomaly.run(() => detectSpikes(data))
await alert.run(() => telegram.send(summary))`;
