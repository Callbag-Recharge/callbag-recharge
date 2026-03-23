import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inspector } from "../../core/inspector";
import { state } from "../../core/state";
import { dagLayout } from "../../orchestrate/dagLayout";
import { workflowNode } from "../../orchestrate/workflowNode";
import { autoSave } from "../../utils/autoSave";
import { memoryAdapter } from "../../utils/checkpoint";
import { contentStats } from "../../utils/contentStats";
import { cursorInfo } from "../../utils/cursorInfo";

// ===========================================================================
// contentStats
// ===========================================================================
describe("contentStats", () => {
	it("returns 0 words for empty string", () => {
		const content = state("");
		const stats = contentStats(content);
		expect(stats.wordCount.get()).toBe(0);
		expect(stats.charCount.get()).toBe(0);
		expect(stats.lineCount.get()).toBe(1);
	});

	it("counts a single word", () => {
		const content = state("hello");
		const stats = contentStats(content);
		expect(stats.wordCount.get()).toBe(1);
		expect(stats.charCount.get()).toBe(5);
		expect(stats.lineCount.get()).toBe(1);
	});

	it("counts multiple words separated by spaces", () => {
		const content = state("hello world foo");
		const stats = contentStats(content);
		expect(stats.wordCount.get()).toBe(3);
		expect(stats.charCount.get()).toBe(15);
	});

	it("handles multiline text", () => {
		const content = state("line one\nline two\nline three");
		const stats = contentStats(content);
		expect(stats.wordCount.get()).toBe(6);
		expect(stats.lineCount.get()).toBe(3);
		// "line one\nline two\nline three" = 8 + 1 + 8 + 1 + 10 = 28 chars
		expect(stats.charCount.get()).toBe(28);
	});

	it("trims leading/trailing whitespace for word count", () => {
		const content = state("  hello  ");
		const stats = contentStats(content);
		expect(stats.wordCount.get()).toBe(1);
		expect(stats.charCount.get()).toBe(9);
	});

	it("handles tabs and multiple spaces as word separators", () => {
		const content = state("one\ttwo   three");
		const stats = contentStats(content);
		expect(stats.wordCount.get()).toBe(3);
	});

	it("reactively updates on content change", () => {
		const content = state("hello");
		const stats = contentStats(content);

		// Activate the derived stores so they track
		Inspector.activate(stats.charCount);
		Inspector.activate(stats.lineCount);
		const obs = Inspector.observe(stats.wordCount);

		content.set("hello world");
		expect(stats.wordCount.get()).toBe(2);
		expect(stats.charCount.get()).toBe(11);
		expect(stats.lineCount.get()).toBe(1);
		// obs captures only changed values (derived deduplicates initial)
		expect(obs.values).toContain(2);

		content.set("a b c");
		expect(stats.wordCount.get()).toBe(3);
		expect(obs.values).toContain(3);

		obs.dispose();
	});

	it("accepts a name prefix via opts", () => {
		const content = state("test");
		const stats = contentStats(content, { name: "editor" });
		// Verify stores are created (name is internal, but the stores work)
		expect(stats.wordCount.get()).toBe(1);
	});

	it("counts whitespace-only content as 0 words", () => {
		const content = state("   \n\t  ");
		const stats = contentStats(content);
		expect(stats.wordCount.get()).toBe(0);
		expect(stats.lineCount.get()).toBe(2);
	});
});

// ===========================================================================
// cursorInfo
// ===========================================================================
describe("cursorInfo", () => {
	it("returns line 1, col 1 at start of text", () => {
		const content = state("hello world");
		const pos = state(0);
		const cursor = cursorInfo(content, pos);
		expect(cursor.line.get()).toBe(1);
		expect(cursor.column.get()).toBe(1);
		expect(cursor.display.get()).toBe("Ln 1, Col 1");
	});

	it("computes column in middle of line", () => {
		const content = state("hello world");
		const pos = state(5);
		const cursor = cursorInfo(content, pos);
		expect(cursor.line.get()).toBe(1);
		expect(cursor.column.get()).toBe(6);
		expect(cursor.display.get()).toBe("Ln 1, Col 6");
	});

	it("computes line and column after newline", () => {
		const content = state("hello\nworld");
		const pos = state(8);
		const cursor = cursorInfo(content, pos);
		expect(cursor.line.get()).toBe(2);
		expect(cursor.column.get()).toBe(3);
		expect(cursor.display.get()).toBe("Ln 2, Col 3");
	});

	it("handles position at end of text", () => {
		const content = state("ab\ncd");
		const pos = state(5);
		const cursor = cursorInfo(content, pos);
		expect(cursor.line.get()).toBe(2);
		expect(cursor.column.get()).toBe(3);
	});

	it("handles position right at newline", () => {
		const content = state("hello\nworld");
		const pos = state(5);
		const cursor = cursorInfo(content, pos);
		// Position 5 is the \n character itself; slice(0,5) = "hello" → 1 line
		expect(cursor.line.get()).toBe(1);
		expect(cursor.column.get()).toBe(6);
	});

	it("handles position right after newline", () => {
		const content = state("hello\nworld");
		const pos = state(6);
		const cursor = cursorInfo(content, pos);
		expect(cursor.line.get()).toBe(2);
		expect(cursor.column.get()).toBe(1);
	});

	it("reactively updates on position change", () => {
		const content = state("hello\nworld");
		const pos = state(0);
		const cursor = cursorInfo(content, pos);

		// Activate line/column so display derived can compute
		Inspector.activate(cursor.line);
		Inspector.activate(cursor.column);
		const obs = Inspector.observe(cursor.display);

		pos.set(8);
		expect(obs.values).toContain("Ln 2, Col 3");

		obs.dispose();
	});

	it("reactively updates on content change", () => {
		const content = state("abc");
		const pos = state(2);
		const cursor = cursorInfo(content, pos);
		expect(cursor.line.get()).toBe(1);
		expect(cursor.column.get()).toBe(3);

		content.set("a\nbc");
		// pos is still 2, which is now after the newline
		expect(cursor.line.get()).toBe(2);
		expect(cursor.column.get()).toBe(1);
	});

	it("handles multiple newlines", () => {
		const content = state("a\nb\nc\nd");
		const pos = state(6);
		const cursor = cursorInfo(content, pos);
		// "a\nb\nc\n" (6 chars) → 4 lines (split by \n gives ["a","b","c",""])
		expect(cursor.line.get()).toBe(4);
		expect(cursor.column.get()).toBe(1);
	});

	it("accepts a name prefix via opts", () => {
		const content = state("test");
		const pos = state(0);
		const cursor = cursorInfo(content, pos, { name: "editor" });
		expect(cursor.line.get()).toBe(1);
	});
});

// ===========================================================================
// autoSave
// ===========================================================================
describe("autoSave", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("starts with saved status when not dirty", () => {
		const content = state("hello");
		const dirty = state(false);
		const adapter = memoryAdapter();
		const save = autoSave(content, dirty, adapter);

		// Activate the status store so derived computes
		Inspector.activate(save.status);
		expect(save.status.get()).toBe("saved");
		save.dispose();
	});

	it("transitions to unsaved when dirty", () => {
		const content = state("hello");
		const dirty = state(false);
		const adapter = memoryAdapter();
		const save = autoSave(content, dirty, adapter);

		Inspector.activate(save.status);
		Inspector.activate(save.debouncedContent);
		Inspector.activate(save.checkpointed);

		dirty.set(true);
		expect(save.status.get()).toBe("unsaved");
		save.dispose();
	});

	it("debounces content before checkpoint", () => {
		const content = state("a");
		const dirty = state(true);
		const adapter = memoryAdapter();
		const save = autoSave(content, dirty, adapter, { debounceMs: 500 });

		Inspector.activate(save.debouncedContent);
		Inspector.activate(save.checkpointed);
		Inspector.activate(save.status);

		// Before debounce fires, nothing should be debounced
		content.set("ab");
		expect(save.debouncedContent.get()).toBeUndefined();

		// Advance past debounce
		vi.advanceTimersByTime(600);
		expect(save.debouncedContent.get()).toBe("ab");

		save.dispose();
	});

	it("persists via adapter after debounce", () => {
		const content = state("initial");
		const dirty = state(true);
		const adapter = memoryAdapter();
		const save = autoSave(content, dirty, adapter, {
			debounceMs: 300,
			checkpointId: "test-save",
		});

		Inspector.activate(save.debouncedContent);
		Inspector.activate(save.checkpointed);
		Inspector.activate(save.status);

		content.set("updated");
		vi.advanceTimersByTime(400);

		// checkpoint should have persisted
		expect(adapter.load("test-save")).toBe("updated");
		save.dispose();
	});

	it("calls markClean after checkpoint persist", () => {
		const content = state("hello");
		const dirty = state(true);
		const adapter = memoryAdapter();
		const markClean = vi.fn();
		const save = autoSave(content, dirty, adapter, {
			debounceMs: 200,
			markClean,
		});

		Inspector.activate(save.debouncedContent);
		Inspector.activate(save.checkpointed);
		Inspector.activate(save.status);

		content.set("world");
		vi.advanceTimersByTime(300);

		expect(markClean).toHaveBeenCalled();
		save.dispose();
	});

	it("dispose clears checkpoint adapter data", () => {
		const content = state("hello");
		const dirty = state(true);
		const adapter = memoryAdapter();
		const save = autoSave(content, dirty, adapter, {
			debounceMs: 200,
			checkpointId: "dispose-test",
		});

		Inspector.activate(save.debouncedContent);
		Inspector.activate(save.checkpointed);
		Inspector.activate(save.status);

		// Let debounce fire and persist
		content.set("persisted");
		vi.advanceTimersByTime(300);
		expect(adapter.load("dispose-test")).toBe("persisted");

		// dispose should clear the checkpoint
		save.dispose();
		expect(adapter.load("dispose-test")).toBeUndefined();
	});

	it("uses default debounceMs of 1000", () => {
		const content = state("hello");
		const dirty = state(true);
		const adapter = memoryAdapter();
		const save = autoSave(content, dirty, adapter);

		Inspector.activate(save.debouncedContent);
		Inspector.activate(save.checkpointed);
		Inspector.activate(save.status);

		content.set("updated");

		vi.advanceTimersByTime(500);
		expect(save.debouncedContent.get()).toBeUndefined();

		vi.advanceTimersByTime(600);
		expect(save.debouncedContent.get()).toBe("updated");

		save.dispose();
	});
});

// ===========================================================================
// dagLayout
// ===========================================================================
describe("dagLayout", () => {
	it("returns empty result for empty graph", () => {
		const result = dagLayout([], []);
		expect(result.nodes).toEqual([]);
		expect(result.backEdges).toEqual([]);
	});

	it("positions a single node at layer 0", () => {
		const result = dagLayout([{ id: "a" }], []);
		expect(result.nodes).toHaveLength(1);
		expect(result.nodes[0].id).toBe("a");
		expect(result.nodes[0].layer).toBe(0);
		expect(result.nodes[0].order).toBe(0);
	});

	it("positions a linear chain in sequential layers", () => {
		const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
		const edges = [
			{ source: "a", target: "b" },
			{ source: "b", target: "c" },
		];
		const result = dagLayout(nodes, edges);

		const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
		expect(byId.a.layer).toBe(0);
		expect(byId.b.layer).toBe(1);
		expect(byId.c.layer).toBe(2);
	});

	it("handles fan-out (one parent, two children)", () => {
		const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
		const edges = [
			{ source: "a", target: "b" },
			{ source: "a", target: "c" },
		];
		const result = dagLayout(nodes, edges);

		const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
		expect(byId.a.layer).toBe(0);
		expect(byId.b.layer).toBe(1);
		expect(byId.c.layer).toBe(1);
		// b and c should have different orders
		expect(byId.b.order).not.toBe(byId.c.order);
	});

	it("handles diamond shape (fan-out then fan-in)", () => {
		const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
		const edges = [
			{ source: "a", target: "b" },
			{ source: "a", target: "c" },
			{ source: "b", target: "d" },
			{ source: "c", target: "d" },
		];
		const result = dagLayout(nodes, edges);

		const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
		expect(byId.a.layer).toBe(0);
		expect(byId.b.layer).toBe(1);
		expect(byId.c.layer).toBe(1);
		expect(byId.d.layer).toBe(2);
	});

	it("handles a full DAG with 7 nodes (airflow-style)", () => {
		const nodes = [
			{ id: "trigger" },
			{ id: "extract" },
			{ id: "validate" },
			{ id: "transform" },
			{ id: "load" },
			{ id: "report" },
			{ id: "cleanup" },
		];
		const edges = [
			{ source: "trigger", target: "extract" },
			{ source: "trigger", target: "validate" },
			{ source: "extract", target: "transform" },
			{ source: "validate", target: "transform" },
			{ source: "transform", target: "load" },
			{ source: "load", target: "report" },
			{ source: "validate", target: "report" },
			{ source: "report", target: "cleanup" },
		];
		const result = dagLayout(nodes, edges);

		const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
		expect(byId.trigger.layer).toBe(0);
		expect(byId.extract.layer).toBe(1);
		expect(byId.validate.layer).toBe(1);
		expect(byId.transform.layer).toBe(2);
		expect(byId.load.layer).toBe(3);
		expect(byId.report.layer).toBe(4);
		expect(byId.cleanup.layer).toBe(5);
		expect(result.nodes).toHaveLength(7);
	});

	it("uses LR direction to swap x and y", () => {
		const nodes = [{ id: "a" }, { id: "b" }];
		const edges = [{ source: "a", target: "b" }];

		const tb = dagLayout(nodes, edges, { direction: "TB" });
		const lr = dagLayout(nodes, edges, { direction: "LR" });

		const tbA = tb.nodes.find((n) => n.id === "a")!;
		const lrA = lr.nodes.find((n) => n.id === "a")!;
		const tbB = tb.nodes.find((n) => n.id === "b")!;
		const lrB = lr.nodes.find((n) => n.id === "b")!;

		expect(tbA.y).toBe(0);
		expect(lrA.x).toBe(0);
		expect(tbB.y).toBe(120);
		expect(lrB.x).toBe(120);
	});

	it("applies custom nodeGap and layerGap", () => {
		const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
		const edges = [
			{ source: "a", target: "b" },
			{ source: "a", target: "c" },
		];
		const result = dagLayout(nodes, edges, { nodeGap: 100, layerGap: 50 });

		const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
		expect(byId.b.y).toBe(50);
		expect(byId.c.y).toBe(50);
		expect(Math.abs(byId.b.x - byId.c.x)).toBe(100);
	});

	it("applies custom nodeWidth for centering", () => {
		const nodes = [{ id: "a" }];
		const result160 = dagLayout(nodes, [], { nodeWidth: 160 });
		const result200 = dagLayout(nodes, [], { nodeWidth: 200 });
		expect(result160.nodes[0].x).toBe(80);
		expect(result200.nodes[0].x).toBe(100);
	});

	it("handles disconnected nodes", () => {
		const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
		const edges: { source: string; target: string }[] = [];
		const result = dagLayout(nodes, edges);

		for (const n of result.nodes) {
			expect(n.layer).toBe(0);
		}
		expect(result.nodes).toHaveLength(3);
	});

	it("ignores edges referencing unknown nodes", () => {
		const nodes = [{ id: "a" }, { id: "b" }];
		const edges = [
			{ source: "a", target: "b" },
			{ source: "a", target: "unknown" },
		];
		const result = dagLayout(nodes, edges);
		expect(result.nodes).toHaveLength(2);
		const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
		expect(byId.a.layer).toBe(0);
		expect(byId.b.layer).toBe(1);
	});

	it("assigns unique order within each layer", () => {
		const nodes = [{ id: "root" }, { id: "a" }, { id: "b" }, { id: "c" }];
		const edges = [
			{ source: "root", target: "a" },
			{ source: "root", target: "b" },
			{ source: "root", target: "c" },
		];
		const result = dagLayout(nodes, edges);
		const layer1 = result.nodes.filter((n) => n.layer === 1);
		const orders = layer1.map((n) => n.order).sort();
		expect(orders).toEqual([0, 1, 2]);
	});

	it("detects back-edges in cyclic graphs", () => {
		const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
		const edges = [
			{ source: "a", target: "b" },
			{ source: "b", target: "c" },
			{ source: "c", target: "a" }, // back-edge
		];
		const result = dagLayout(nodes, edges);

		// Should detect exactly one back-edge
		expect(result.backEdges).toHaveLength(1);
		expect(result.backEdges[0]).toEqual({ source: "c", target: "a" });
		// Nodes still laid out correctly (a→b→c layered)
		const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
		expect(byId.a.layer).toBe(0);
		expect(byId.b.layer).toBe(1);
		expect(byId.c.layer).toBe(2);
	});

	it("detects multiple back-edges in complex cycles", () => {
		const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
		const edges = [
			{ source: "a", target: "b" },
			{ source: "b", target: "c" },
			{ source: "c", target: "d" },
			{ source: "d", target: "b" }, // back-edge to b
			{ source: "c", target: "a" }, // back-edge to a
		];
		const result = dagLayout(nodes, edges);

		expect(result.backEdges.length).toBeGreaterThanOrEqual(2);
		expect(result.nodes).toHaveLength(4);
		// All nodes should still be laid out
		const ids = result.nodes.map((n) => n.id).sort();
		expect(ids).toEqual(["a", "b", "c", "d"]);
	});

	it("returns no back-edges for acyclic graphs", () => {
		const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
		const edges = [
			{ source: "a", target: "b" },
			{ source: "a", target: "c" },
		];
		const result = dagLayout(nodes, edges);
		expect(result.backEdges).toEqual([]);
	});
});

// ===========================================================================
// workflowNode
// ===========================================================================
describe("workflowNode", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("creates a node with id and label", () => {
		const node = workflowNode("extract", "Extract Data");
		expect(node.id).toBe("extract");
		expect(node.label).toBe("Extract Data");
		node.destroy();
	});

	it("has a reactive log", () => {
		const node = workflowNode("n1", "Node 1");
		node.log.append("event 1");
		node.log.append("event 2");
		expect(node.log.toArray().map((e) => e.value)).toEqual(["event 1", "event 2"]);
		node.destroy();
	});

	it("has a circuit breaker starting in closed state", () => {
		const node = workflowNode("n1", "Node 1");
		expect(node.breaker.state).toBe("closed");
		expect(node.breakerState.get()).toBe("closed");
		node.destroy();
	});

	it("simulate resolves on success (Math.random >= failRate)", async () => {
		vi.spyOn(Math, "random")
			.mockReturnValueOnce(0.5) // duration randomness
			.mockReturnValueOnce(0.9); // > failRate → success

		const node = workflowNode("n1", "Test Node");

		const promise = node.simulate([100, 200], 0.2);
		// Advance timers to cover the fromTimer duration
		vi.advanceTimersByTime(200);
		const result = await promise;

		expect(result).toBe("Test Node result");
		expect(node.breaker.state).toBe("closed");

		vi.restoreAllMocks();
		node.destroy();
	});

	it("simulate throws on failure (Math.random < failRate)", async () => {
		vi.spyOn(Math, "random")
			.mockReturnValueOnce(0.5) // duration randomness
			.mockReturnValueOnce(0.1); // < failRate → failure

		const node = workflowNode("n1", "Test Node");

		const promise = node.simulate([100, 200], 0.5);
		vi.advanceTimersByTime(200);

		await expect(promise).rejects.toThrow("Test Node failed");

		vi.restoreAllMocks();
		node.destroy();
	});

	it("simulate records failure in circuit breaker", async () => {
		vi.spyOn(Math, "random")
			.mockReturnValueOnce(0.5) // duration
			.mockReturnValueOnce(0.0); // < failRate → failure

		const node = workflowNode("n1", "Test Node");

		const promise = node.simulate([50, 100], 0.5);
		vi.advanceTimersByTime(200);
		await promise.catch(() => {});

		expect(node.breaker.failureCount).toBe(1);

		vi.restoreAllMocks();
		node.destroy();
	});

	it("simulate records success in circuit breaker and logs", async () => {
		vi.spyOn(Math, "random")
			.mockReturnValueOnce(0.5) // duration
			.mockReturnValueOnce(0.99); // success

		const node = workflowNode("n1", "Test Node");

		const promise = node.simulate([100, 200], 0.5);
		vi.advanceTimersByTime(200);
		await promise;

		const entries = node.log.toArray().map((e) => e.value);
		expect(entries.length).toBe(1);
		expect(entries[0]).toMatch(/\[OK\] Completed in/);

		vi.restoreAllMocks();
		node.destroy();
	});

	it("simulate logs error entry on failure", async () => {
		vi.spyOn(Math, "random")
			.mockReturnValueOnce(0.5) // duration
			.mockReturnValueOnce(0.0); // failure

		const node = workflowNode("n1", "Test Node");

		const promise = node.simulate([100, 200], 0.5);
		vi.advanceTimersByTime(200);
		await promise.catch(() => {});

		const entries = node.log.toArray().map((e) => e.value);
		expect(entries.length).toBe(1);
		expect(entries[0]).toMatch(/\[ERROR\] Failed after/);

		vi.restoreAllMocks();
		node.destroy();
	});

	it("updates breakerState reactively on failure", async () => {
		vi.spyOn(Math, "random").mockReturnValueOnce(0.5).mockReturnValueOnce(0.0); // failure

		const node = workflowNode("n1", "Node", {
			breaker: { failureThreshold: 1 },
		});

		const obs = Inspector.observe(node.breakerState);

		const promise = node.simulate([50, 100], 0.5);
		vi.advanceTimersByTime(200);
		await promise.catch(() => {});

		// Breaker should have opened after 1 failure
		expect(node.breakerState.get()).toBe("open");
		expect(obs.values).toContain("open");

		obs.dispose();
		vi.restoreAllMocks();
		node.destroy();
	});

	it("respects logMaxSize option", () => {
		const node = workflowNode("n1", "Node", { logMaxSize: 3 });
		node.log.append("a");
		node.log.append("b");
		node.log.append("c");
		node.log.append("d");
		// Log should trim to 3
		expect(node.log.length).toBeLessThanOrEqual(3);
		node.destroy();
	});

	it("destroy cleans up log", () => {
		const node = workflowNode("n1", "Node");
		node.log.append("entry");
		node.destroy();
		// After destroy, log should be cleaned up
		expect(node.log.toArray().map((e) => e.value)).toEqual([]);
	});
});
