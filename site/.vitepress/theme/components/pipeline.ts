// ---------------------------------------------------------------------------
// Pipeline definition — declarative DAG with pipeline() + step()
// ---------------------------------------------------------------------------
// A personal finance DAG: cron → fetch bank + fetch cards → aggregate →
// detect anomaly + batch write → alert. Shows diamond resolution, retry,
// circuit breaker, reactive logging — all with library primitives.
// ---------------------------------------------------------------------------

import { pipe } from "@lib/core/pipe";
import { producer } from "@lib/core/producer";
import { state } from "@lib/core/state";
import type { Store } from "@lib/core/types";
import { reactiveLog } from "@lib/data/reactiveLog";
import type { ReactiveLog } from "@lib/data/types";
import { combine, switchMap } from "@lib/extra";
import { fromTrigger } from "@lib/orchestrate/fromTrigger";
import { pipeline, step } from "@lib/orchestrate/pipeline";
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

// Run a node as a reactive producer (circuit breaker guarded)
function nodeProducer(
	node: PipelineNode,
	duration: [number, number],
	failRate?: number,
): Store<string | null> {
	return producer<string | null>(({ emit, complete }) => {
		if (!node.breaker.canExecute()) {
			node.log.append("[CIRCUIT OPEN] Skipped — breaker is open");
			emit(null);
			complete();
			return;
		}
		node.log.append("[START] Running...");
		node.task
			.run(() => simulateWork(node, duration, failRate))
			.then((r) => {
				emit(r);
				complete();
			})
			.catch(() => {
				emit(null);
				complete();
			});
	});
}

// Emit null immediately (skip sentinel)
function skipProducer(): Store<string | null> {
	return producer<string | null>(({ emit, complete }) => {
		emit(null);
		complete();
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
	let _checkDoneTimer: ReturnType<typeof setInterval> | null = null;

	// --- Declarative pipeline wiring via pipeline() + step() ---
	const triggerSrc = fromTrigger<string>({ name: "pipeline:trigger" });

	// #region display
	const wf = pipeline({
		// Entry point: manual trigger
		trigger: step(triggerSrc),

		// Step 1: Cron fires on trigger
		cron: step(["trigger"], (src: Store<string | undefined>) =>
			pipe(
				src,
				switchMap(() =>
					producer<string>(({ emit, complete }) => {
						cron.log.append("[TRIGGER] Pipeline started");
						cron.task
							.run(() => {
								cron.breaker.recordSuccess();
								cron.log.append("[OK] Trigger fired");
								return Promise.resolve("triggered");
							})
							.then((r) => {
								emit(r);
								complete();
							})
							.catch(() => {
								emit("triggered");
								complete();
							});
					}),
				),
			),
		),

		// Step 2a: Fetch bank (parallel with cards)
		fetchBank: step(["cron"], (src: Store<string>) =>
			pipe(
				src,
				switchMap(() => nodeProducer(fetchBank, [800, 2000], 0.2)),
			),
		),

		// Step 2b: Fetch cards (parallel with bank)
		fetchCards: step(["cron"], (src: Store<string>) =>
			pipe(
				src,
				switchMap(() => nodeProducer(fetchCards, [600, 1500], 0.15)),
			),
		),

		// Step 3: Aggregate — diamond resolution (waits for both fetches)
		aggregate: step(
			["fetchBank", "fetchCards"],
			(bankSrc: Store<string | null>, cardsSrc: Store<string | null>) =>
				pipe(
					combine(bankSrc, cardsSrc),
					switchMap(([bankVal, cardVal]: [string | null, string | null]) => {
						const bankOk = bankVal !== null;
						const cardsOk = cardVal !== null;
						if (!bankOk && !cardsOk) {
							aggregate.log.append("[SKIP] Both sources failed");
							return skipProducer();
						}
						aggregate.log.append(
							`[START] Merging: bank=${bankOk ? "ok" : "fail"}, cards=${cardsOk ? "ok" : "fail"}`,
						);
						return nodeProducer(aggregate, [300, 800], 0.05);
					}),
				),
		),

		// Step 4a: Detect anomaly
		anomaly: step(["aggregate"], (src: Store<string | null>) =>
			pipe(
				src,
				switchMap((v: string | null) =>
					v !== null ? nodeProducer(anomaly, [200, 600], 0.1) : skipProducer(),
				),
			),
		),

		// Step 4b: Batch write
		batchWrite: step(["aggregate"], (src: Store<string | null>) =>
			pipe(
				src,
				switchMap((v: string | null) =>
					v !== null ? nodeProducer(batchWrite, [400, 1000], 0.08) : skipProducer(),
				),
			),
		),

		// Step 5: Alert (only if anomaly detection succeeds)
		alert: step(["anomaly"], (src: Store<string | null>) =>
			pipe(
				src,
				switchMap((v: string | null) =>
					v !== null ? nodeProducer(alert, [100, 300], 0.02) : skipProducer(),
				),
			),
		),
	});
	// #endregion display

	function fireTrigger() {
		if (_running.get()) return;
		_running.set(true);
		triggerSrc.fire("go");

		// Track completion — watch pipeline status
		_checkDoneTimer = setInterval(() => {
			const status = wf.status.get();
			if (status !== "active") {
				_running.set(false);
				_runCount.update((n) => n + 1);
				if (_checkDoneTimer) {
					clearInterval(_checkDoneTimer);
					_checkDoneTimer = null;
				}
			}
		}, 100);
	}

	return {
		nodes,
		edges,
		trigger: fireTrigger,
		running: _running as Store<boolean>,
		runCount: _runCount as Store<number>,
		destroy() {
			if (_checkDoneTimer) {
				clearInterval(_checkDoneTimer);
				_checkDoneTimer = null;
			}
			wf.destroy();
			for (const node of nodes) {
				node.task.destroy();
				node.log.destroy();
			}
		},
	};
}
