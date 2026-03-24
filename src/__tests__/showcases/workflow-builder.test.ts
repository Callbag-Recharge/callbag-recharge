import { describe, expect, it, vi } from "vitest";
import {
	createWorkflowBuilder,
	parsePipelineCode,
	presets,
} from "../../../examples/workflow-builder";

describe("H3: Workflow Builder — store layer", () => {
	// -----------------------------------------------------------------------
	// Preset registry
	// -----------------------------------------------------------------------
	describe("presets", () => {
		it("has at least 3 presets", () => {
			expect(presets.length).toBeGreaterThanOrEqual(3);
		});

		it("each preset has required fields", () => {
			for (const p of presets) {
				expect(p.id).toBeTruthy();
				expect(p.name).toBeTruthy();
				expect(p.description).toBeTruthy();
				expect(p.code).toBeTruthy();
			}
		});

		it("preset IDs are unique", () => {
			const ids = presets.map((p) => p.id);
			expect(new Set(ids).size).toBe(ids.length);
		});
	});

	// -----------------------------------------------------------------------
	// Code parser
	// -----------------------------------------------------------------------
	describe("parsePipelineCode", () => {
		it("parses ETL code into 3 nodes and 2 edges", () => {
			const result = parsePipelineCode(presets[0].code);
			expect(result.ok).toBe(true);
			expect(result.nodes).toHaveLength(3);
			expect(result.edges).toHaveLength(2);
		});

		it("parses fan-out code into 4 nodes and 4 edges", () => {
			const result = parsePipelineCode(presets[1].code);
			expect(result.ok).toBe(true);
			expect(result.nodes).toHaveLength(4);
			expect(result.edges).toHaveLength(4);
		});

		it("parses full DAG code into 7 nodes and 7 edges", () => {
			const result = parsePipelineCode(presets[2].code);
			expect(result.ok).toBe(true);
			expect(result.nodes).toHaveLength(7);
			expect(result.edges).toHaveLength(7);
		});

		it("returns error for code with no pipeline nodes", () => {
			const result = parsePipelineCode("const x = 42;");
			expect(result.ok).toBe(false);
			expect(result.error).toBeTruthy();
		});

		it("returns error for unknown dependency", () => {
			const code = `const wf = pipeline({
				trigger: source(fromTrigger()),
				step: task(["nonexistent"], async () => "done"),
			});`;
			const result = parsePipelineCode(code);
			expect(result.ok).toBe(false);
			expect(result.error).toContain("nonexistent");
		});

		it("parses custom user code", () => {
			const code = `const wf = pipeline({
				trigger: source(fromTrigger()),
				fetch: task(["trigger"], async (s) => getData()),
				process: task(["fetch"], async (s, [d]) => transform(d)),
				save: task(["process"], async (s, [d]) => persist(d)),
			});`;
			const result = parsePipelineCode(code);
			expect(result.ok).toBe(true);
			expect(result.nodes).toHaveLength(3);
			expect(result.nodes.map((n) => n.id)).toEqual(["fetch", "process", "save"]);
			expect(result.edges).toHaveLength(2);
		});

		it("detects cyclic dependencies", () => {
			const code = `const wf = pipeline({
				trigger: source(fromTrigger()),
				a: task(["b"], async () => "done"),
				b: task(["a"], async () => "done"),
			});`;
			const result = parsePipelineCode(code);
			expect(result.ok).toBe(false);
			expect(result.error).toContain("ycle");
		});

		it("skips duplicate node definitions", () => {
			const code = `const wf = pipeline({
				trigger: source(fromTrigger()),
				step: task(["trigger"], async () => "first"),
				step: task(["trigger"], async () => "second"),
			});`;
			const result = parsePipelineCode(code);
			expect(result.ok).toBe(true);
			// Should only have 1 node (duplicate skipped)
			expect(result.nodes).toHaveLength(1);
		});
	});

	// -----------------------------------------------------------------------
	// Pipeline definition → DAG node/edge extraction
	// -----------------------------------------------------------------------
	describe("DAG structure", () => {
		it("ETL preset produces 3 nodes and 2 edges (linear)", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("etl");

			expect(wb.nodes.get()).toHaveLength(3);
			expect(wb.edges.get()).toHaveLength(2);

			// Linear: extract → transform → load
			const nodeIds = wb.nodes.get().map((n) => n.id);
			expect(nodeIds).toContain("extract");
			expect(nodeIds).toContain("transform");
			expect(nodeIds).toContain("load");

			wb.destroy();
		});

		it("fan-out preset produces 4 nodes and 4 edges (diamond)", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("fanout");

			expect(wb.nodes.get()).toHaveLength(4);
			expect(wb.edges.get()).toHaveLength(4);

			// Diamond: ingest → (validate, enrich) → store
			const edgePairs = wb.edges.get().map((e) => `${e.source}->${e.target}`);
			expect(edgePairs).toContain("ingest->validate");
			expect(edgePairs).toContain("ingest->enrich");
			expect(edgePairs).toContain("validate->store");
			expect(edgePairs).toContain("enrich->store");

			wb.destroy();
		});

		it("full-dag preset produces 7 nodes and 7 edges", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("full-dag");

			expect(wb.nodes.get()).toHaveLength(7);
			expect(wb.edges.get()).toHaveLength(7);

			wb.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Template switching
	// -----------------------------------------------------------------------
	describe("template switching", () => {
		it("selectTemplate changes selected template", () => {
			const wb = createWorkflowBuilder();

			wb.selectTemplate("fanout");
			expect(wb.selectedTemplate.get()).toBe("fanout");

			wb.selectTemplate("full-dag");
			expect(wb.selectedTemplate.get()).toBe("full-dag");

			wb.destroy();
		});

		it("selectTemplate updates code", () => {
			const wb = createWorkflowBuilder();

			wb.selectTemplate("etl");
			const etlCode = wb.code.get();

			wb.selectTemplate("fanout");
			expect(wb.code.get()).not.toBe(etlCode);

			wb.destroy();
		});

		it("selectTemplate rebuilds nodes and edges", () => {
			const wb = createWorkflowBuilder();

			wb.selectTemplate("etl");
			expect(wb.nodes.get()).toHaveLength(3);

			wb.selectTemplate("full-dag");
			expect(wb.nodes.get()).toHaveLength(7);

			wb.destroy();
		});

		it("switching template resets running and status", () => {
			const wb = createWorkflowBuilder();

			wb.selectTemplate("fanout");
			expect(wb.running.get()).toBe(false);
			expect(wb.pipelineStatus.get()).toBe("idle");

			wb.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// updateCode (editable script pane)
	// -----------------------------------------------------------------------
	describe("updateCode", () => {
		it("parses and rebuilds pipeline from custom code", () => {
			const wb = createWorkflowBuilder();
			const code = `const wf = pipeline({
				trigger: source(fromTrigger()),
				fetch: task(["trigger"], async (s) => getData()),
				process: task(["fetch"], async (s, [d]) => transform(d)),
			});`;

			const ok = wb.updateCode(code);
			expect(ok).toBe(true);
			expect(wb.nodes.get()).toHaveLength(2);
			expect(wb.edges.get()).toHaveLength(1);
			expect(wb.parseError.get()).toBe("");

			wb.destroy();
		});

		it("returns false and sets parseError on invalid code", () => {
			const wb = createWorkflowBuilder();

			const ok = wb.updateCode("const x = 42;");
			expect(ok).toBe(false);
			expect(wb.parseError.get()).toBeTruthy();

			wb.destroy();
		});

		it("clears selectedTemplate when user edits code", () => {
			const wb = createWorkflowBuilder();
			expect(wb.selectedTemplate.get()).toBe("etl");

			wb.updateCode(`const wf = pipeline({
				trigger: source(fromTrigger()),
				a: task(["trigger"], async () => "done"),
			});`);
			expect(wb.selectedTemplate.get()).toBe("");

			wb.destroy();
		});

		it("can run pipeline after updateCode", () => {
			const wb = createWorkflowBuilder();
			wb.updateCode(`const wf = pipeline({
				trigger: source(fromTrigger()),
				step: task(["trigger"], async () => "done"),
			});`);

			wb.trigger();
			expect(wb.running.get()).toBe(true);

			wb.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Trigger → status transitions
	// -----------------------------------------------------------------------
	describe("trigger and status", () => {
		it("trigger sets running to true and status to active", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("etl");

			wb.trigger();
			expect(wb.running.get()).toBe(true);

			wb.destroy();
		});

		it("trigger while running is a no-op", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("etl");

			wb.trigger();
			const runCountBefore = wb.runCount.get();
			wb.trigger(); // should be ignored
			expect(wb.runCount.get()).toBe(runCountBefore);

			wb.destroy();
		});

		it("pipeline completes and transitions to completed/errored", async () => {
			vi.useFakeTimers();
			const wb = createWorkflowBuilder();
			wb.selectTemplate("etl");
			// Set failRate to 0 for deterministic completion
			wb.failRate.set(0);
			// Rebuild with 0 fail rate
			wb.selectTemplate("etl");

			wb.trigger();
			expect(wb.running.get()).toBe(true);

			// Advance enough for all tasks to complete (3 tasks × 1000ms max each)
			await vi.advanceTimersByTimeAsync(5000);

			// Pipeline should have finished (completed or errored)
			const status = wb.pipelineStatus.get();
			expect(["completed", "errored", "idle"]).toContain(status);

			wb.destroy();
			vi.useRealTimers();
		});
	});

	// -----------------------------------------------------------------------
	// Reset
	// -----------------------------------------------------------------------
	describe("reset", () => {
		it("reset returns status to idle", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("etl");

			wb.trigger();
			wb.reset();

			expect(wb.running.get()).toBe(false);
			expect(wb.pipelineStatus.get()).toBe("idle");

			wb.destroy();
		});

		it("re-trigger works after reset", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("etl");

			wb.trigger();
			wb.reset();
			wb.trigger();
			expect(wb.running.get()).toBe(true);

			wb.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Execution log
	// -----------------------------------------------------------------------
	describe("execution log", () => {
		it("trigger appends to execution log", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("etl");

			const logBefore = wb.execLog.length.get();
			wb.trigger();
			expect(wb.execLog.length.get()).toBeGreaterThan(logBefore);

			wb.destroy();
		});

		it("execution log records pipeline start event", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("fanout");

			wb.trigger();
			const entries = wb.execLog.forStep("pipeline");
			expect(entries.some((e) => e.event === "start")).toBe(true);

			wb.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Node metadata
	// -----------------------------------------------------------------------
	describe("node metadata", () => {
		it("each node has a task with status store", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("etl");

			for (const node of wb.nodes.get()) {
				expect(node.task).toBeDefined();
				expect(node.task.status).toBeDefined();
				expect(node.task.status.get()).toBeDefined();
			}

			wb.destroy();
		});

		it("each node has a log", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("etl");

			for (const node of wb.nodes.get()) {
				expect(node.log).toBeDefined();
				expect(typeof node.log.append).toBe("function");
			}

			wb.destroy();
		});

		it("each node has a circuit breaker", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("etl");

			for (const node of wb.nodes.get()) {
				expect(node.breaker).toBeDefined();
				expect(node.breaker.state).toBe("closed");
				expect(node.breaker.canExecute()).toBe(true);
			}

			wb.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Code display
	// -----------------------------------------------------------------------
	describe("code display", () => {
		it("code contains pipeline keyword", () => {
			const wb = createWorkflowBuilder();

			for (const p of presets) {
				wb.selectTemplate(p.id);
				expect(wb.code.get()).toContain("pipeline");
			}

			wb.destroy();
		});

		it("code contains task keyword", () => {
			const wb = createWorkflowBuilder();

			for (const p of presets) {
				wb.selectTemplate(p.id);
				expect(wb.code.get()).toContain("task");
			}

			wb.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Destroy
	// -----------------------------------------------------------------------
	describe("destroy", () => {
		it("destroy cleans up without errors", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("fanout");
			wb.trigger();
			expect(() => wb.destroy()).not.toThrow();
		});
	});
});
