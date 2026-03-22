/**
 * Airflow demo — interactive DAG with pipeline() + step()
 *
 * A personal finance DAG: cron → fetch bank + fetch cards → aggregate →
 * detect anomaly + batch write → alert. Shows diamond resolution, retry,
 * circuit breaker, reactive logging — all with library primitives.
 *
 * This file is the store layer for the interactive Vue demo at site/demos/airflow.
 * The Vue component imports from here — no library logic lives in the site.
 *
 * Run: pnpm exec tsx --tsconfig tsconfig.examples.json examples/airflow-demo.ts
 */

// NOTE: This file is imported by the Vue demo component at build time.
// We use deep imports (e.g. callbag-recharge/utils/circuitBreaker) instead
// of barrel imports (callbag-recharge/utils) to avoid pulling in node:fs
// from checkpoint adapters during the browser build.

import type { Store } from "callbag-recharge";
import { pipe, producer, state, subscribe } from "callbag-recharge";
import type { ReactiveLog } from "callbag-recharge/data";
import { reactiveLog } from "callbag-recharge/data";
import { combine, firstValueFrom, fromTimer, fromTrigger, switchMap } from "callbag-recharge/extra";
import { pipeline, step } from "callbag-recharge/orchestrate/pipeline";
import { taskState } from "callbag-recharge/orchestrate/taskState";
import type { TaskState } from "callbag-recharge/orchestrate/types";
import { exponential } from "callbag-recharge/utils/backoff";
import { circuitBreaker } from "callbag-recharge/utils/circuitBreaker";

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
async function simulateWork(
	node: PipelineNode,
	durationRange: [number, number],
	failRate = 0.15,
): Promise<string> {
	const [min, max] = durationRange;
	const duration = min + Math.random() * (max - min);

	await firstValueFrom(fromTimer(duration));

	if (Math.random() < failRate) {
		node.breaker.recordFailure();
		node.log.append(`[ERROR] Failed after ${Math.round(duration)}ms`);
		throw new Error(`${node.label} failed`);
	}
	node.breaker.recordSuccess();
	node.log.append(`[OK] Completed in ${Math.round(duration)}ms`);
	return `${node.label} result`;
}

// Run a node as a reactive producer (circuit breaker guarded)
//
// IMPORTANT: emit() and complete() must happen INSIDE the task.run() body,
// before the function returns. This ensures downstream propagation fires
// BEFORE task status transitions to "success". Otherwise there's a microtask
// gap between the task status update and the .then() callback, causing
// runStatus to prematurely report "completed" before downstream tasks start.
//
// Note: emit/complete fire before task.run()'s generation check, so a stale
// run (after reset) could theoretically emit. This is safe here because
// switchMap unsubscribes old inner producers (emit becomes a no-op).
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
			.run(async () => {
				try {
					const result = await simulateWork(node, duration, failRate);
					emit(result);
					complete();
					return result;
				} catch (e) {
					emit(null);
					complete();
					throw e; // re-throw so task.run() sets status to "error"
				}
			})
			.catch(() => {}); // swallow — already handled inside
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
	let _pipelineStatusUnsub: (() => void) | null = null;

	// --- Declarative pipeline wiring via pipeline() + step() ---
	const triggerSrc = fromTrigger<string>({ name: "pipeline:trigger" });

	// #region display
	const wf = pipeline(
		{
			// Entry point: manual trigger
			trigger: step(triggerSrc),

			// Step 1: Cron fires on trigger (synchronous emit to prevent double-fire downstream)
			cron: step(["trigger"], (src: Store<string | undefined>) =>
				pipe(
					src,
					switchMap(() =>
						producer<string>(({ emit, complete }) => {
							cron.log.append("[TRIGGER] Pipeline started");
							cron.breaker.recordSuccess();
							cron.log.append("[OK] Trigger fired");
							emit("triggered");
							complete();
							// Fire-and-forget task tracking for UI status display
							cron.task.run(() => Promise.resolve("triggered")).catch(() => {});
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
							// Guard: undefined means "not yet produced" — wait for real values
							if (bankVal === undefined || cardVal === undefined) {
								return skipProducer();
							}
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
						v != null ? nodeProducer(anomaly, [200, 600], 0.1) : skipProducer(),
					),
				),
			),

			// Step 4b: Batch write
			batchWrite: step(["aggregate"], (src: Store<string | null>) =>
				pipe(
					src,
					switchMap((v: string | null) =>
						v != null ? nodeProducer(batchWrite, [400, 1000], 0.08) : skipProducer(),
					),
				),
			),

			// Step 5: Alert (only if anomaly detection succeeds)
			alert: step(["anomaly"], (src: Store<string | null>) =>
				pipe(
					src,
					switchMap((v: string | null) =>
						v != null ? nodeProducer(alert, [100, 300], 0.02) : skipProducer(),
					),
				),
			),
		},
		{
			tasks: {
				cron: cron.task,
				fetchBank: fetchBank.task,
				fetchCards: fetchCards.task,
				aggregate: aggregate.task,
				anomaly: anomaly.task,
				batchWrite: batchWrite.task,
				alert: alert.task,
			},
		},
	);
	// #endregion display

	function finishRun() {
		if (!_pipelineStatusUnsub) return;
		_running.set(false);
		_runCount.update((n) => n + 1);
		const unsub = _pipelineStatusUnsub;
		_pipelineStatusUnsub = null;
		queueMicrotask(() => unsub());
	}

	function fireTrigger() {
		if (_running.get()) return;
		_running.set(true);
		wf.reset();

		// Subscribe BEFORE firing so no status transitions can be missed.
		_pipelineStatusUnsub = subscribe(wf.status, (rs) => {
			if (rs === "completed" || rs === "errored") finishRun();
		});

		triggerSrc.fire("go");

		// Safety: if every task was skipped (e.g. all circuit breakers open),
		// no taskState ever transitions from idle, so status stays "idle" forever.
		// Detect this after the synchronous propagation settles.
		queueMicrotask(() => {
			if (_pipelineStatusUnsub && wf.status.get() === "idle") finishRun();
		});
	}

	return {
		nodes,
		edges,
		trigger: fireTrigger,
		running: _running as Store<boolean>,
		runCount: _runCount as Store<number>,
		destroy() {
			if (_pipelineStatusUnsub) {
				_pipelineStatusUnsub();
				_pipelineStatusUnsub = null;
			}
			wf.destroy();
			for (const node of nodes) {
				node.task.destroy();
				node.log.destroy();
			}
		},
	};
}
