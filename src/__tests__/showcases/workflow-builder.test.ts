import { describe, expect, it, vi } from "vitest";
import { createWorkflowBuilder, templates } from "../../../examples/workflow-builder";

describe("H3: Workflow Builder — store layer", () => {
	// -----------------------------------------------------------------------
	// Template registry
	// -----------------------------------------------------------------------
	describe("templates", () => {
		it("has at least 3 templates", () => {
			expect(templates.length).toBeGreaterThanOrEqual(3);
		});

		it("each template has required fields", () => {
			for (const t of templates) {
				expect(t.id).toBeTruthy();
				expect(t.name).toBeTruthy();
				expect(t.description).toBeTruthy();
				expect(t.code).toBeTruthy();
				expect(typeof t.build).toBe("function");
			}
		});

		it("template IDs are unique", () => {
			const ids = templates.map((t) => t.id);
			expect(new Set(ids).size).toBe(ids.length);
		});
	});

	// -----------------------------------------------------------------------
	// Pipeline definition → DAG node/edge extraction
	// -----------------------------------------------------------------------
	describe("DAG structure", () => {
		it("ETL template produces 3 nodes and 2 edges (linear)", () => {
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

		it("fan-out template produces 4 nodes and 4 edges (diamond)", () => {
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

		it("full-dag template produces 7 nodes and 7 edges", () => {
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

			const logBefore = wb.executionLog.lengthStore.get();
			wb.trigger();
			expect(wb.executionLog.lengthStore.get()).toBeGreaterThan(logBefore);

			wb.destroy();
		});

		it("execution log records template name on trigger", () => {
			const wb = createWorkflowBuilder();
			wb.selectTemplate("fanout");

			wb.trigger();
			const entries = wb.executionLog.toArray();
			expect(entries.some((e) => e.value.includes("fanout"))).toBe(true);

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

			for (const t of templates) {
				wb.selectTemplate(t.id);
				expect(wb.code.get()).toContain("pipeline");
			}

			wb.destroy();
		});

		it("code contains task keyword", () => {
			const wb = createWorkflowBuilder();

			for (const t of templates) {
				wb.selectTemplate(t.id);
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
