/**
 * H3: Workflow Builder — Hero App store layer
 *
 * Code-first n8n: users write pipeline() code in an editable script pane,
 * press "Update" to parse it into a live DAG, then run the pipeline.
 * Presets load example code that users can start from and modify.
 *
 * All library logic lives here; the Vue component is UI-only.
 *
 * Demonstrates: pipeline, task, source, workflowNode, dagLayout (orchestrate),
 * reactiveLog (data).
 * Import constraint: orchestrate+ and data only (no raw/core/extra/utils).
 *
 * Run: pnpm exec tsx --tsconfig tsconfig.examples.json examples/workflow-builder.ts
 */

import type { ReactiveLog } from "callbag-recharge/data";
import { reactiveLog } from "callbag-recharge/data";
import type {
	DagLayoutEdge,
	LayoutNode,
	PipelineStatus,
	Store,
	TaskState,
	WorkflowNodeResult,
	WritableStore,
} from "callbag-recharge/orchestrate";
import {
	dagLayout,
	effect,
	fromTrigger,
	pipeline,
	source,
	state,
	TASK_STATE,
	task,
	workflowNode,
} from "callbag-recharge/orchestrate";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A node in the visual DAG. */
export interface WorkflowNode {
	id: string;
	label: string;
	task: TaskState;
	log: ReactiveLog<string>;
	breaker: WorkflowNodeResult["breaker"];
	breakerState: WorkflowNodeResult["breakerState"];
	reset(): void;
	destroy(): void;
}

/** An edge in the visual DAG. */
export interface WorkflowEdge {
	source: string;
	target: string;
}

/** Parsed node from user code. */
export interface ParsedNode {
	id: string;
	label: string;
	deps: string[];
	type: "source" | "task";
}

/** Result of parsing pipeline code. */
export interface ParseResult {
	ok: boolean;
	nodes: ParsedNode[];
	edges: WorkflowEdge[];
	error?: string;
}

/** Preset definition — example code users can start from. */
export interface PipelinePreset {
	id: string;
	name: string;
	description: string;
	code: string;
}

interface BuiltPipeline {
	nodes: WorkflowNode[];
	edges: WorkflowEdge[];
	layout: LayoutNode[];
	trigger: ReturnType<typeof fromTrigger<string>>;
	wfNodes: WorkflowNodeResult[];
	wf: { status: Store<PipelineStatus>; reset(): void; destroy(): void };
}

// ---------------------------------------------------------------------------
// Code parser — extracts pipeline structure from user code
// ---------------------------------------------------------------------------

/** Convert camelCase id to Title Case label. */
function idToLabel(id: string): string {
	return id.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Parse pipeline() code to extract nodes and edges.
 * Recognizes:
 *   - `name: source(...)` → source node (implicit trigger)
 *   - `name: task(["dep1", "dep2"], ...)` → task node with dependencies
 */
export function parsePipelineCode(code: string): ParseResult {
	const nodes: ParsedNode[] = [];
	const edges: WorkflowEdge[] = [];
	const seen = new Set<string>();

	// Match source entries:  name: source(...)
	const sourceRe = /(\w+)\s*:\s*source\s*\(/g;
	for (let m = sourceRe.exec(code); m !== null; m = sourceRe.exec(code)) {
		const id = m[1];
		if (id === "trigger") continue; // skip trigger source
		if (!seen.has(id)) {
			seen.add(id);
			nodes.push({ id, label: idToLabel(id), deps: [], type: "source" });
		}
	}

	// Match task entries:  name: task(["dep1", "dep2"], ...)
	const taskRe = /(\w+)\s*:\s*task\s*\(\s*\[([^\]]*)\]/g;
	for (let m = taskRe.exec(code); m !== null; m = taskRe.exec(code)) {
		const id = m[1];
		if (seen.has(id)) continue; // skip duplicate definitions
		seen.add(id);

		const depsStr = m[2];
		const deps = depsStr
			.split(",")
			.map((d) => d.trim().replace(/['"]/g, ""))
			.filter((d) => d.length > 0);

		nodes.push({ id, label: idToLabel(id), deps, type: "task" });

		for (const dep of deps) {
			if (dep !== "trigger") {
				edges.push({ source: dep, target: id });
			}
		}
	}

	if (nodes.length === 0) {
		return {
			ok: false,
			nodes: [],
			edges: [],
			error:
				'No pipeline nodes found. Define tasks with: name: task(["deps"], async (signal) => { ... })',
		};
	}

	// Validate: check all deps reference known nodes or "trigger"
	const nodeIds = new Set(nodes.map((n) => n.id));
	for (const node of nodes) {
		for (const dep of node.deps) {
			if (dep !== "trigger" && !nodeIds.has(dep)) {
				return {
					ok: false,
					nodes: [],
					edges: [],
					error: `Unknown dependency "${dep}" in task "${node.id}". Available nodes: ${[...nodeIds].join(", ")}`,
				};
			}
		}
	}

	// Detect cycles via topological sort (Kahn's algorithm)
	const inDegree = new Map<string, number>();
	const adj = new Map<string, string[]>();
	for (const n of nodes) {
		inDegree.set(n.id, 0);
		adj.set(n.id, []);
	}
	for (const e of edges) {
		adj.get(e.source)?.push(e.target);
		inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
	}
	const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
	let sorted = 0;
	while (queue.length > 0) {
		const cur = queue.shift()!;
		sorted++;
		for (const next of adj.get(cur) ?? []) {
			const d = (inDegree.get(next) ?? 1) - 1;
			inDegree.set(next, d);
			if (d === 0) queue.push(next);
		}
	}
	if (sorted < nodes.length) {
		return {
			ok: false,
			nodes: [],
			edges: [],
			error:
				"Cycle detected in pipeline dependencies. Tasks cannot depend on each other in a loop.",
		};
	}

	return { ok: true, nodes, edges };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function buildNode(meta: WorkflowNodeResult, def: any): WorkflowNode {
	return {
		id: meta.id,
		label: meta.label,
		task: def[TASK_STATE] as TaskState,
		log: meta.log,
		breaker: meta.breaker,
		breakerState: meta.breakerState,
		reset: () => meta.reset(),
		destroy: () => meta.destroy(),
	};
}

function computeLayout(nodes: { id: string }[], edges: DagLayoutEdge[]): LayoutNode[] {
	return dagLayout(nodes, edges, { nodeGap: 200, layerGap: 120, direction: "TB" }).nodes;
}

// ---------------------------------------------------------------------------
// Build pipeline dynamically from parsed nodes
// ---------------------------------------------------------------------------

function buildFromParsed(
	parsed: ParseResult,
	opts: {
		durationRange: WritableStore<[number, number]>;
		failRate: WritableStore<number>;
	},
): BuiltPipeline {
	const triggerSrc = fromTrigger<string>({ name: "wb:trigger" });

	// Only build task-type nodes; source-type nodes are not executable
	const taskNodes = parsed.nodes.filter((pn) => pn.type === "task");

	const allWfNodes: WorkflowNodeResult[] = [];
	const wfNodes: Record<string, WorkflowNodeResult> = {};
	const defs: Record<string, any> = { trigger: source(triggerSrc) };
	const builtNodes: WorkflowNode[] = [];

	for (const pn of taskNodes) {
		const wn = workflowNode(pn.id, pn.label);
		wfNodes[pn.id] = wn;
		allWfNodes.push(wn);

		const deps = pn.deps.length > 0 ? pn.deps : ["trigger"];
		const def = task(
			deps,
			async (signal, _vals) => {
				wn.log.append(`[START] ${pn.label}...`);
				return wn.simulate(opts.durationRange.get(), opts.failRate.get(), signal);
			},
			{ name: pn.id },
		);
		defs[pn.id] = def;
	}

	const wf = pipeline(defs, { name: "wb" });

	for (const pn of taskNodes) {
		builtNodes.push(buildNode(wfNodes[pn.id], defs[pn.id]));
	}

	// Filter edges to only include task-type nodes
	const taskIds = new Set(taskNodes.map((n) => n.id));
	const taskEdges = parsed.edges.filter((e) => taskIds.has(e.source) && taskIds.has(e.target));

	return {
		nodes: builtNodes,
		edges: taskEdges,
		layout: computeLayout(
			taskNodes.map((n) => ({ id: n.id })),
			taskEdges,
		),
		trigger: triggerSrc,
		wfNodes: allWfNodes,
		wf,
	};
}

// ---------------------------------------------------------------------------
// Presets — example code users can start from and edit
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
  fetchBank: task(["cron"], async (signal) => {
    return fetchBankData(signal);
  }),
  fetchCards: task(["cron"], async (signal) => {
    return fetchCardData(signal);
  }),
  // Fan-in: waits for both fetch tasks
  aggregate: task(["fetchBank", "fetchCards"], async (s, [bank, cards]) => {
    return merge(bank, cards);
  }),
  anomaly: task(["aggregate"], async (s, [data]) => {
    return detectAnomalies(data);
  }),
  batchWrite: task(["aggregate"], async (s, [data]) => {
    return writeBatch(data);
  }),
  alert: task(["anomaly"], async (s, [result]) => {
    return sendAlert(result);
  }),
});`;

export const presets: PipelinePreset[] = [
	{
		id: "etl",
		name: "ETL Pipeline",
		description: "Extract → Transform → Load. Linear 3-stage pipeline.",
		code: ETL_CODE,
	},
	{
		id: "fanout",
		name: "Fan-out / Fan-in",
		description: "Ingest → (Validate ‖ Enrich) → Store. Diamond-shaped DAG.",
		code: FANOUT_CODE,
	},
	{
		id: "full-dag",
		name: "Full DAG (7 nodes)",
		description: "Finance pipeline: Cron → fetch → aggregate → detect → alert.",
		code: FULL_DAG_CODE,
	},
];

// ---------------------------------------------------------------------------
// Workflow Builder store
// ---------------------------------------------------------------------------

export interface WorkflowBuilderState {
	/** Currently selected preset ID (empty string if user has edited code). */
	selectedTemplate: WritableStore<string>;
	/** Pipeline code in the editor (editable). */
	code: WritableStore<string>;
	/** Parse error from last updateCode() call. */
	parseError: Store<string>;
	/** Duration range for simulated work [min, max] ms. */
	durationRange: WritableStore<[number, number]>;
	/** Failure probability 0–1. */
	failRate: WritableStore<number>;
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
	/** Current auto-layout positions. */
	layout: Store<LayoutNode[]>;
	/** Global execution log. */
	executionLog: ReactiveLog<string>;
	/** Load a preset into the editor. */
	selectTemplate(presetId: string): void;
	/** Parse the current code and rebuild the pipeline + DAG. */
	updateCode(newCode: string): boolean;
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
	const parseError = state<string>("", { name: "wb.parseError" });

	// Active pipeline state
	let activePipeline: BuiltPipeline | null = null;

	// Reactive stores for the current pipeline's output
	const nodesStore = state<WorkflowNode[]>([], { name: "wb.nodes" });
	const edgesStore = state<WorkflowEdge[]>([], { name: "wb.edges" });
	const layoutStore = state<LayoutNode[]>([], { name: "wb.layout" });
	const pipelineStatus = state<PipelineStatus>("idle", { name: "wb.pipelineStatus" });
	const code = state<string>(presets[0].code, { name: "wb.code" });

	// Status sync effect disposer
	let statusUnsub: (() => void) | null = null;

	function destroyActive(): void {
		if (activePipeline) {
			activePipeline.wf.destroy();
			for (const wn of activePipeline.wfNodes) {
				wn.destroy();
			}
			activePipeline = null;
		}
		if (statusUnsub) {
			statusUnsub();
			statusUnsub = null;
		}
	}

	function buildAndActivate(codeText: string): boolean {
		const parsed = parsePipelineCode(codeText);
		if (!parsed.ok) {
			parseError.set(parsed.error ?? "Parse error");
			return false;
		}

		destroyActive();
		parseError.set("");

		activePipeline = buildFromParsed(parsed, {
			durationRange,
			failRate,
		});

		nodesStore.set(activePipeline.nodes);
		edgesStore.set(activePipeline.edges);
		layoutStore.set(activePipeline.layout);
		pipelineStatus.set("idle");
		running.set(false);

		// Sync pipeline status reactively
		const wfStatus = activePipeline.wf.status;
		const dispose = effect([wfStatus, running], () => {
			const s = wfStatus.get();
			pipelineStatus.set(s);
			if (running.get() && (s === "completed" || s === "errored")) {
				running.set(false);
				const next = runCount.get() + 1;
				runCount.set(next);
				executionLog.append(`[${new Date().toISOString()}] Run #${next} — ${s}`);
			}
		});
		statusUnsub = dispose;
		return true;
	}

	// Initialize with first preset
	buildAndActivate(presets[0].code);

	function selectTemplate(presetId: string): void {
		const preset = presets.find((p) => p.id === presetId);
		if (!preset) return;
		selectedTemplate.set(presetId);
		code.set(preset.code);
		buildAndActivate(preset.code);
	}

	function updateCode(newCode: string): boolean {
		const ok = buildAndActivate(newCode);
		if (ok) {
			code.set(newCode);
			selectedTemplate.set("");
		}
		return ok;
	}

	function triggerPipeline(): void {
		if (!activePipeline || running.get()) return;
		activePipeline.wf.reset();
		for (const wn of activePipeline.wfNodes) wn.reset();
		activePipeline.trigger.fire("go");
		running.set(true);
		executionLog.append(`[${new Date().toISOString()}] Triggered pipeline`);
	}

	function resetPipeline(): void {
		if (!activePipeline) return;
		activePipeline.wf.reset();
		running.set(false);
		pipelineStatus.set("idle");
	}

	function destroy(): void {
		destroyActive();
		executionLog.destroy();
	}

	return {
		selectedTemplate,
		code,
		parseError,
		durationRange,
		failRate,
		running,
		runCount,
		pipelineStatus,
		nodes: nodesStore,
		edges: edgesStore,
		layout: layoutStore,
		executionLog,
		selectTemplate,
		updateCode,
		trigger: triggerPipeline,
		reset: resetPipeline,
		destroy,
	};
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
if (typeof process !== "undefined" && process.argv?.[1]?.includes("workflow-builder")) {
	console.log("=== Workflow Builder: Code-first Pipeline Editor ===\n");
	console.log("Available presets:");
	for (const p of presets) {
		console.log(`  ${p.id}: ${p.name} — ${p.description}`);
	}

	const wb = createWorkflowBuilder();

	console.log(`\nPreset: ${wb.selectedTemplate.get()}`);
	console.log(
		`Nodes: ${wb.nodes
			.get()
			.map((n) => n.label)
			.join(" → ")}`,
	);
	console.log(`Edges: ${wb.edges.get().length}`);
	console.log(`Code:\n${wb.code.get()}\n`);

	// Test updateCode with custom pipeline
	const customCode = `const wf = pipeline({
  trigger: source(fromTrigger()),
  fetch: task(["trigger"], async (s) => getData()),
  process: task(["fetch"], async (s, [d]) => transform(d)),
  save: task(["process"], async (s, [d]) => persist(d)),
});`;

	console.log("--- Updating with custom code ---");
	const ok = wb.updateCode(customCode);
	console.log(`Parse OK: ${ok}`);
	console.log(
		`Nodes: ${wb.nodes
			.get()
			.map((n) => n.label)
			.join(" → ")}`,
	);
	console.log(`Edges: ${wb.edges.get().length}`);

	// Test parse error
	console.log("\n--- Testing parse error ---");
	const bad = wb.updateCode("const x = 42;");
	console.log(`Parse OK: ${bad}`);
	console.log(`Error: ${wb.parseError.get()}`);

	wb.destroy();
	console.log("\n--- done ---");
}
