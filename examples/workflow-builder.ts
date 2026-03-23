/**
 * H3: Workflow Builder — Hero App store layer
 *
 * Code-first n8n: users pick a pipeline template and customize parameters.
 * Left pane: CodeMirror shows the pipeline code (read-only or editable params).
 * Right pane: Vue Flow renders the live DAG. Fire triggers, watch nodes animate.
 *
 * All library logic lives here; the Vue component is UI-only.
 *
 * Demonstrates: pipeline, task, source, fromTrigger, taskState, circuitBreaker,
 * checkpoint (execution history), reactiveLog, state, derived, effect.
 *
 * Run: pnpm exec tsx --tsconfig tsconfig.examples.json examples/workflow-builder.ts
 */

import type { Store } from "callbag-recharge";
import { effect, state } from "callbag-recharge";
import type { ReactiveLog } from "callbag-recharge/data";
import { reactiveLog } from "callbag-recharge/data";
import { firstValueFrom, fromTimer, fromTrigger } from "callbag-recharge/extra";
import { pipeline, source } from "callbag-recharge/orchestrate/pipeline";
import { task } from "callbag-recharge/orchestrate/task";
import type { PipelineStatus, TaskState } from "callbag-recharge/orchestrate/types";
import { TASK_STATE } from "callbag-recharge/orchestrate/types";
import { exponential } from "callbag-recharge/utils/backoff";
import { circuitBreaker } from "callbag-recharge/utils/circuitBreaker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A node in the visual DAG. */
export interface WorkflowNode {
	id: string;
	label: string;
	task: TaskState;
	log: ReactiveLog<string>;
	breaker: ReturnType<typeof circuitBreaker>;
	breakerState: Store<string>;
}

/** An edge in the visual DAG. */
export interface WorkflowEdge {
	source: string;
	target: string;
}

/** Template definition — what users pick from. */
export interface PipelineTemplate {
	id: string;
	name: string;
	description: string;
	/** Pipeline code shown in the editor (display only). */
	code: string;
	/** Factory that creates the live pipeline. */
	build(opts: TemplateBuildOpts): BuiltPipeline;
}

interface TemplateBuildOpts {
	/** Simulated task duration range [min, max] in ms. */
	durationRange: [number, number];
	/** Failure probability 0–1. */
	failRate: number;
}

interface BuiltPipeline {
	nodes: WorkflowNode[];
	edges: WorkflowEdge[];
	trigger: ReturnType<typeof fromTrigger<string>>;
	wf: { status: Store<PipelineStatus>; reset(): void; destroy(): void };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

async function simulateWork(
	meta: NodeMeta,
	durationRange: [number, number],
	failRate: number,
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

function buildNode(meta: NodeMeta, def: any): WorkflowNode {
	return { ...meta, task: def[TASK_STATE] as TaskState };
}

// ---------------------------------------------------------------------------
// Template 1: ETL Pipeline (3 stages — simple linear)
// ---------------------------------------------------------------------------
function buildEtlPipeline(opts: TemplateBuildOpts): BuiltPipeline {
	const n = {
		extract: createMeta("extract", "Extract"),
		transform: createMeta("transform", "Transform"),
		load: createMeta("load", "Load"),
	};

	const triggerSrc = fromTrigger<string>({ name: "etl:trigger" });

	const extractDef = task(
		["trigger"],
		async (_signal, [_v]) => {
			n.extract.log.append("[START] Extracting data...");
			return simulateWork(n.extract, opts.durationRange, opts.failRate);
		},
		{ name: "extract" },
	);

	const transformDef = task(
		["extract"],
		async (_signal, [_v]) => {
			n.transform.log.append("[START] Transforming...");
			return simulateWork(n.transform, opts.durationRange, opts.failRate);
		},
		{ name: "transform" },
	);

	const loadDef = task(
		["transform"],
		async (_signal, [_v]) => {
			n.load.log.append("[START] Loading...");
			return simulateWork(n.load, opts.durationRange, opts.failRate);
		},
		{ name: "load" },
	);

	const wf = pipeline(
		{
			trigger: source(triggerSrc),
			extract: extractDef,
			transform: transformDef,
			load: loadDef,
		},
		{ name: "etl" },
	);

	return {
		nodes: [
			buildNode(n.extract, extractDef),
			buildNode(n.transform, transformDef),
			buildNode(n.load, loadDef),
		],
		edges: [
			{ source: "extract", target: "transform" },
			{ source: "transform", target: "load" },
		],
		trigger: triggerSrc,
		wf,
	};
}

// ---------------------------------------------------------------------------
// Template 2: Fan-out / Fan-in (diamond shape)
// ---------------------------------------------------------------------------
function buildFanOutPipeline(opts: TemplateBuildOpts): BuiltPipeline {
	const n = {
		ingest: createMeta("ingest", "Ingest"),
		validate: createMeta("validate", "Validate"),
		enrich: createMeta("enrich", "Enrich"),
		store: createMeta("store", "Store"),
	};

	const triggerSrc = fromTrigger<string>({ name: "fanout:trigger" });

	const ingestDef = task(
		["trigger"],
		async (_signal, [_v]) => {
			n.ingest.log.append("[START] Ingesting...");
			return simulateWork(n.ingest, opts.durationRange, opts.failRate);
		},
		{ name: "ingest" },
	);

	const validateDef = task(
		["ingest"],
		async (_signal, [_v]) => {
			n.validate.log.append("[START] Validating...");
			return simulateWork(n.validate, opts.durationRange, opts.failRate);
		},
		{ name: "validate" },
	);

	const enrichDef = task(
		["ingest"],
		async (_signal, [_v]) => {
			n.enrich.log.append("[START] Enriching...");
			return simulateWork(n.enrich, opts.durationRange, opts.failRate);
		},
		{ name: "enrich" },
	);

	const storeDef = task(
		["validate", "enrich"],
		async (_signal, [_v1, _v2]) => {
			n.store.log.append("[START] Storing...");
			return simulateWork(n.store, opts.durationRange, opts.failRate);
		},
		{ name: "store" },
	);

	const wf = pipeline(
		{
			trigger: source(triggerSrc),
			ingest: ingestDef,
			validate: validateDef,
			enrich: enrichDef,
			store: storeDef,
		},
		{ name: "fanout" },
	);

	return {
		nodes: [
			buildNode(n.ingest, ingestDef),
			buildNode(n.validate, validateDef),
			buildNode(n.enrich, enrichDef),
			buildNode(n.store, storeDef),
		],
		edges: [
			{ source: "ingest", target: "validate" },
			{ source: "ingest", target: "enrich" },
			{ source: "validate", target: "store" },
			{ source: "enrich", target: "store" },
		],
		trigger: triggerSrc,
		wf,
	};
}

// ---------------------------------------------------------------------------
// Template 3: Full DAG (airflow-like — 7 nodes)
// ---------------------------------------------------------------------------
function buildFullDagPipeline(opts: TemplateBuildOpts): BuiltPipeline {
	const n = {
		cron: createMeta("cron", "Cron Trigger"),
		fetchBank: createMeta("fetch-bank", "Fetch Bank"),
		fetchCards: createMeta("fetch-cards", "Fetch Cards"),
		aggregate: createMeta("aggregate", "Aggregate"),
		anomaly: createMeta("anomaly", "Detect Anomaly"),
		batchWrite: createMeta("batch-write", "Batch Write"),
		alert: createMeta("alert", "Send Alert"),
	};

	const triggerSrc = fromTrigger<string>({ name: "dag:trigger" });

	const cronDef = task(
		["trigger"],
		async (_signal, [_v]) => {
			n.cron.log.append("[TRIGGER] Pipeline started");
			n.cron.breaker.recordSuccess();
			n.cron.breakerState.set(n.cron.breaker.state);
			return "triggered";
		},
		{ name: "cron" },
	);

	const fetchBankDef = task(
		["cron"],
		async (_signal, [_v]) => simulateWork(n.fetchBank, opts.durationRange, opts.failRate),
		{
			name: "fetchBank",
			skip: () => !n.fetchBank.breaker.canExecute(),
			onSkip: () => n.fetchBank.log.append("[CIRCUIT OPEN] Skipped"),
			onStart: () => n.fetchBank.log.append("[START] Running..."),
		},
	);

	const fetchCardsDef = task(
		["cron"],
		async (_signal, [_v]) => simulateWork(n.fetchCards, opts.durationRange, opts.failRate),
		{
			name: "fetchCards",
			skip: () => !n.fetchCards.breaker.canExecute(),
			onSkip: () => n.fetchCards.log.append("[CIRCUIT OPEN] Skipped"),
			onStart: () => n.fetchCards.log.append("[START] Running..."),
		},
	);

	const aggregateDef = task(
		["fetchBank", "fetchCards"],
		async (_signal, [_bankVal, _cardsVal]) => {
			n.aggregate.log.append("[START] Aggregating...");
			return simulateWork(n.aggregate, opts.durationRange, opts.failRate);
		},
		{ name: "aggregate" },
	);

	const anomalyDef = task(
		["aggregate"],
		async (_signal, [_v]) => simulateWork(n.anomaly, opts.durationRange, opts.failRate),
		{ name: "anomaly", onStart: () => n.anomaly.log.append("[START] Running...") },
	);

	const batchWriteDef = task(
		["aggregate"],
		async (_signal, [_v]) => simulateWork(n.batchWrite, opts.durationRange, opts.failRate),
		{ name: "batchWrite", onStart: () => n.batchWrite.log.append("[START] Running...") },
	);

	const alertDef = task(
		["anomaly"],
		async (_signal, [_v]) => simulateWork(n.alert, opts.durationRange, opts.failRate),
		{ name: "alert", onStart: () => n.alert.log.append("[START] Running...") },
	);

	const wf = pipeline(
		{
			trigger: source(triggerSrc),
			cron: cronDef,
			fetchBank: fetchBankDef,
			fetchCards: fetchCardsDef,
			aggregate: aggregateDef,
			anomaly: anomalyDef,
			batchWrite: batchWriteDef,
			alert: alertDef,
		},
		{ name: "dag" },
	);

	return {
		nodes: [
			buildNode(n.cron, cronDef),
			buildNode(n.fetchBank, fetchBankDef),
			buildNode(n.fetchCards, fetchCardsDef),
			buildNode(n.aggregate, aggregateDef),
			buildNode(n.anomaly, anomalyDef),
			buildNode(n.batchWrite, batchWriteDef),
			buildNode(n.alert, alertDef),
		],
		edges: [
			{ source: "cron", target: "fetch-bank" },
			{ source: "cron", target: "fetch-cards" },
			{ source: "fetch-bank", target: "aggregate" },
			{ source: "fetch-cards", target: "aggregate" },
			{ source: "aggregate", target: "anomaly" },
			{ source: "aggregate", target: "batch-write" },
			{ source: "anomaly", target: "alert" },
		],
		trigger: triggerSrc,
		wf,
	};
}

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

const ETL_CODE = `const wf = pipeline({
  trigger: source(fromTrigger()),
  extract: task(["trigger"], async (signal) => {
    // Fetch data from external API
    return await fetchData(signal);
  }),
  transform: task(["extract"], async (signal, [raw]) => {
    // Clean, normalize, reshape
    return transform(raw);
  }),
  load: task(["transform"], async (signal, [data]) => {
    // Write to database / warehouse
    await db.insert(data);
    return "loaded";
  }),
});`;

const FANOUT_CODE = `const wf = pipeline({
  trigger: source(fromTrigger()),
  ingest: task(["trigger"], async (signal) => {
    return await receivePayload(signal);
  }),
  validate: task(["ingest"], async (signal, [data]) => {
    return validateSchema(data);
  }),
  enrich: task(["ingest"], async (signal, [data]) => {
    return await lookupMetadata(data);
  }),
  // Fan-in: waits for BOTH validate + enrich
  store: task(["validate", "enrich"], async (signal, [valid, enriched]) => {
    await persist({ ...valid, ...enriched });
    return "stored";
  }),
});`;

const FULL_DAG_CODE = `const wf = pipeline({
  trigger: source(fromTrigger()),
  cron: task(["trigger"], async () => "triggered"),
  fetchBank:  task(["cron"], async (signal) => fetchBankData(signal), {
    skip: () => !breaker.canExecute(),
  }),
  fetchCards: task(["cron"], async (signal) => fetchCardData(signal), {
    skip: () => !breaker.canExecute(),
  }),
  // Fan-in: waits for both fetch tasks
  aggregate:  task(["fetchBank", "fetchCards"], async (s, [bank, cards]) => {
    return merge(bank, cards);
  }),
  anomaly:    task(["aggregate"], async (s, [data]) => detectAnomalies(data)),
  batchWrite: task(["aggregate"], async (s, [data]) => writeBatch(data)),
  alert:      task(["anomaly"], async (s, [result]) => sendAlert(result)),
});`;

export const templates: PipelineTemplate[] = [
	{
		id: "etl",
		name: "ETL Pipeline",
		description: "Extract → Transform → Load. Linear 3-stage pipeline.",
		code: ETL_CODE,
		build: buildEtlPipeline,
	},
	{
		id: "fanout",
		name: "Fan-out / Fan-in",
		description: "Ingest → (Validate ‖ Enrich) → Store. Diamond-shaped DAG.",
		code: FANOUT_CODE,
		build: buildFanOutPipeline,
	},
	{
		id: "full-dag",
		name: "Full DAG (Airflow-style)",
		description: "7-node finance pipeline with circuit breakers and skip propagation.",
		code: FULL_DAG_CODE,
		build: buildFullDagPipeline,
	},
];

// ---------------------------------------------------------------------------
// Workflow Builder store
// ---------------------------------------------------------------------------

export interface WorkflowBuilderState {
	/** Currently selected template ID. */
	selectedTemplate: Store<string>;
	/** Pipeline code displayed in the editor. */
	code: Store<string>;
	/** Duration range for simulated work [min, max] ms. */
	durationRange: Store<[number, number]>;
	/** Failure probability 0–1. */
	failRate: Store<number>;
	/** Whether the pipeline is currently running. */
	running: Store<boolean>;
	/** Total run count. */
	runCount: Store<number>;
	/** Pipeline status (derived from the active pipeline). */
	pipelineStatus: Store<PipelineStatus>;
	/** Current nodes for the DAG visualization. */
	nodes: Store<WorkflowNode[]>;
	/** Current edges for the DAG visualization. */
	edges: Store<WorkflowEdge[]>;
	/** Global execution log. */
	executionLog: ReactiveLog<string>;
	/** Select a template and rebuild the pipeline. */
	selectTemplate(templateId: string): void;
	/** Fire the pipeline trigger. */
	trigger(): void;
	/** Reset the pipeline for re-trigger. */
	reset(): void;
	/** Tear down everything. */
	destroy(): void;
}

export function createWorkflowBuilder(): WorkflowBuilderState {
	const selectedTemplate = state<string>("etl", { name: "wb.selectedTemplate" });
	const durationRange = state<[number, number]>([300, 1000], { name: "wb.durationRange" });
	const failRate = state<number>(0.1, { name: "wb.failRate" });
	const running = state(false, { name: "wb.running" });
	const runCount = state(0, { name: "wb.runCount" });
	const executionLog = reactiveLog<string>({ id: "wb:executionLog", maxSize: 200 });

	// Active pipeline state
	let activePipeline: BuiltPipeline | null = null;

	// Reactive stores for the current pipeline's output
	const nodesStore = state<WorkflowNode[]>([], { name: "wb.nodes" });
	const edgesStore = state<WorkflowEdge[]>([], { name: "wb.edges" });
	const pipelineStatus = state<PipelineStatus>("idle", { name: "wb.pipelineStatus" });
	const code = state<string>(templates[0].code, { name: "wb.code" });

	// Status sync effect disposer
	let statusUnsub: (() => void) | null = null;

	function buildFromTemplate(templateId: string): void {
		// Destroy previous pipeline
		if (activePipeline) {
			activePipeline.wf.destroy();
			for (const node of activePipeline.nodes) {
				node.log.destroy();
			}
		}
		if (statusUnsub) {
			statusUnsub();
			statusUnsub = null;
		}

		const template = templates.find((t) => t.id === templateId);
		if (!template) {
			activePipeline = null;
			return;
		}

		activePipeline = template.build({
			durationRange: durationRange.get(),
			failRate: failRate.get(),
		});

		nodesStore.set(activePipeline.nodes);
		edgesStore.set(activePipeline.edges);
		code.set(template.code);
		pipelineStatus.set("idle");
		running.set(false);

		// Sync pipeline status reactively
		const wfStatus = activePipeline.wf.status;
		const dispose = effect([running, wfStatus], () => {
			const s = wfStatus.get();
			pipelineStatus.set(s);
			if (running.get() && (s === "completed" || s === "errored")) {
				running.set(false);
				runCount.update((n) => n + 1);
				executionLog.append(`[${new Date().toISOString()}] Run #${runCount.get()} — ${s}`);
			}
		});
		statusUnsub = dispose;
	}

	// Initialize with first template
	buildFromTemplate("etl");

	function selectTemplate(templateId: string): void {
		selectedTemplate.set(templateId);
		buildFromTemplate(templateId);
	}

	function triggerPipeline(): void {
		if (!activePipeline || running.get()) return;
		activePipeline.wf.reset();
		activePipeline.trigger.fire("go");
		running.set(true);
		executionLog.append(`[${new Date().toISOString()}] Triggered: ${selectedTemplate.get()}`);
	}

	function resetPipeline(): void {
		if (!activePipeline) return;
		activePipeline.wf.reset();
		running.set(false);
		pipelineStatus.set("idle");
	}

	function destroy(): void {
		if (activePipeline) {
			activePipeline.wf.destroy();
			for (const node of activePipeline.nodes) {
				node.log.destroy();
			}
		}
		if (statusUnsub) statusUnsub();
		executionLog.destroy();
	}

	return {
		selectedTemplate,
		code,
		durationRange,
		failRate,
		running,
		runCount,
		pipelineStatus,
		nodes: nodesStore,
		edges: edgesStore,
		executionLog,
		selectTemplate,
		trigger: triggerPipeline,
		reset: resetPipeline,
		destroy,
	};
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
if (typeof process !== "undefined" && process.argv?.[1]?.includes("workflow-builder")) {
	console.log("=== Workflow Builder: Template-based Pipelines ===\n");
	console.log("Available templates:");
	for (const t of templates) {
		console.log(`  ${t.id}: ${t.name} — ${t.description}`);
	}

	const wb = createWorkflowBuilder();

	console.log(`\nSelected: ${wb.selectedTemplate.get()}`);
	console.log(
		`Nodes: ${wb.nodes
			.get()
			.map((n) => n.label)
			.join(" → ")}`,
	);
	console.log(`Edges: ${wb.edges.get().length}`);
	console.log(`Code:\n${wb.code.get()}\n`);

	// Switch to fan-out
	wb.selectTemplate("fanout");
	console.log(`Switched to: ${wb.selectedTemplate.get()}`);
	console.log(
		`Nodes: ${wb.nodes
			.get()
			.map((n) => n.label)
			.join(", ")}`,
	);
	console.log(`Edges: ${wb.edges.get().length}`);

	wb.destroy();
	console.log("\n--- done ---");
}
