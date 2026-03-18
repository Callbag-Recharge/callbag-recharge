// ---------------------------------------------------------------------------
// Inspector tests — observability without per-store overhead
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscribe } from "../../extra/subscribe";
import { derived, Inspector, operator, producer, state } from "../../index";

beforeEach(() => {
	Inspector._reset();
});

describe("Inspector", () => {
	it("inspect() returns store info", () => {
		const count = state(42, { name: "count" });
		const info = Inspector.inspect(count);

		expect(info.name).toBe("count");
		expect(info.kind).toBe("state");
		expect(info.value).toBe(42);
	});

	it("inspect() works on derived stores", () => {
		const a = state(1, { name: "a" });
		const sum = derived([a], () => a.get() + 10, { name: "sum" });
		const info = Inspector.inspect(sum);

		expect(info.name).toBe("sum");
		expect(info.kind).toBe("derived");
		expect(info.value).toBe(11);
	});

	it("inspect() works on producer stores", () => {
		const s = producer<number>(
			({ emit }) => {
				emit(99);
			},
			{ name: "myProducer" },
		);

		// Start the producer
		s.source(0, () => {});

		const info = Inspector.inspect(s);
		expect(info.name).toBe("myProducer");
		expect(info.kind).toBe("producer");
		expect(info.value).toBe(99);
	});

	it("getName() returns the store name", () => {
		const count = state(0, { name: "count" });
		expect(Inspector.getName(count)).toBe("count");
	});

	it("getName() returns undefined for unnamed stores", () => {
		const count = state(0);
		expect(Inspector.getName(count)).toBeUndefined();
	});

	it("getKind() returns the store kind", () => {
		const s = state(0);
		const d = derived([s], () => s.get());
		const p = producer<number>();
		const o = operator<number>([s], ({ emit }) => {
			return (_dep, type, data) => {
				if (type === 1) emit(data);
			};
		});
		expect(Inspector.getKind(s)).toBe("state");
		expect(Inspector.getKind(d)).toBe("derived");
		expect(Inspector.getKind(p)).toBe("producer");
		expect(Inspector.getKind(o)).toBe("operator");
	});

	it("graph() returns all living stores", () => {
		const a = state(1, { name: "a" });
		const b = state(2, { name: "b" });
		const _sum = derived([a, b], () => a.get() + b.get(), { name: "sum" });

		const g = Inspector.graph();
		expect(g.size).toBe(3);
		expect(g.has("a")).toBe(true);
		expect(g.has("b")).toBe(true);
		expect(g.has("sum")).toBe(true);
		expect(g.get("sum")?.value).toBe(3);
	});

	it("trace() tracks value changes", () => {
		const count = state(0, { name: "traced" });
		const changes: Array<{ value: number; prev: number | undefined }> = [];

		const unsub = Inspector.trace(count, (value, prev) => {
			changes.push({ value, prev });
		});

		count.set(10);
		count.set(20);
		unsub();
		count.set(30); // not traced

		expect(changes).toEqual([
			{ value: 10, prev: 0 },
			{ value: 20, prev: 10 },
		]);
	});

	it("stores are plain objects — no extra properties", () => {
		const count = state(0, { name: "count" });

		// Store only has get, set, update, source — nothing else
		const keys = Object.keys(count);
		expect(keys).not.toContain("name");
		expect(keys).not.toContain("kind");
		expect(keys).not.toContain("deps");
		expect(keys).not.toContain("subs");
	});

	it("_reset() clears all state", () => {
		state(0, { name: "foo" });
		Inspector._reset();
		const g = Inspector.graph();
		expect(g.size).toBe(0);
	});

	it("v4: inspect() returns status field", () => {
		const a = state(1, { name: "a" });
		const info = Inspector.inspect(a);
		expect(info.status).toBeDefined();
		// State is DISCONNECTED before first subscriber
		expect(info.status).toBe("DISCONNECTED");
	});

	it("v4: inspect() shows SETTLED status after emit", () => {
		const a = state(1, { name: "a" });
		// Subscribe so we go through emit path
		a.source(0, () => {});
		a.set(2);
		const info = Inspector.inspect(a);
		expect(info.status).toBe("SETTLED");
	});

	it("v6: inspect() shows derived DISCONNECTED status before subscription", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2, { name: "b" });
		const info = Inspector.inspect(b);
		// v6: derived is DISCONNECTED until subscribed. get() pull-computes
		// but does not change status.
		expect(info.status).toBe("DISCONNECTED");
		expect(info.value).toBe(2); // inspect calls get() which pull-computes
	});

	// -----------------------------------------------------------------------
	// Auto-registered edges
	// -----------------------------------------------------------------------

	it("derived auto-registers edges with parent stores", () => {
		const a = state(1, { name: "a" });
		const b = state(2, { name: "b" });
		const _sum = derived([a, b], () => a.get() + b.get(), { name: "sum" });

		const edges = Inspector.getEdges();
		expect(edges.get("a")).toContain("sum");
		expect(edges.get("b")).toContain("sum");
	});

	it("operator auto-registers edges with parent stores", () => {
		const a = state(0, { name: "a" });
		const _op = operator<number>(
			[a],
			({ emit, signal }) => {
				return (_dep, type, data) => {
					if (type === 1) emit(data);
					else if (type === 3) signal(data);
				};
			},
			{ name: "myOp" },
		);

		const edges = Inspector.getEdges();
		expect(edges.get("a")).toContain("myOp");
	});

	it("registerEdge does not duplicate existing edges", () => {
		const a = state(1, { name: "a" });
		const b = derived([a], () => a.get() * 2, { name: "b" });
		// auto-registered already, calling again should not duplicate
		Inspector.registerEdge(a, b);

		const edges = Inspector.getEdges();
		expect(edges.get("a")).toEqual(["b"]);
	});

	// -----------------------------------------------------------------------
	// dumpGraph()
	// -----------------------------------------------------------------------

	it("dumpGraph() returns a human-readable graph string", () => {
		const a = state(1, { name: "a" });
		const b = state(2, { name: "b" });
		const _sum = derived([a, b], () => a.get() + b.get(), { name: "sum" });

		const dump = Inspector.dumpGraph();
		expect(dump).toContain("Store Graph (3 nodes):");
		expect(dump).toContain("a (state)");
		expect(dump).toContain("b (state)");
		expect(dump).toContain("sum (derived)");
		// v6: derived is DISCONNECTED until subscribed; state is DISCONNECTED
		// without subscribers. Check that status is shown.
		expect(dump).toContain("[DISCONNECTED]");
	});

	it("dumpGraph() shows edge info", () => {
		const a = state(1, { name: "a" });
		const _d = derived([a], () => a.get() * 2, { name: "doubled" });

		const dump = Inspector.dumpGraph();
		// "a" has children ["doubled"], shown in the dump
		expect(dump).toContain("a (state)");
		expect(dump).toContain("doubled (derived)");
	});

	// -----------------------------------------------------------------------
	// tap() — transparent passthrough wrapper
	// -----------------------------------------------------------------------

	it("tap() creates a distinct graph node that delegates to the original", () => {
		const a = state(42, { name: "a" });
		const tapped = Inspector.tap(a, "tapped_a");

		// Delegates get()
		expect(tapped.get()).toBe(42);

		// Appears as a separate node in the graph
		const g = Inspector.graph();
		expect(g.has("a")).toBe(true);
		expect(g.has("tapped_a")).toBe(true);
		expect(g.get("tapped_a")?.kind).toBe("tap");

		// Edge registered from a → tapped_a
		const edges = Inspector.getEdges();
		expect(edges.get("a")).toContain("tapped_a");

		// Can subscribe through tap
		const values: number[] = [];
		subscribe(tapped, (v) => values.push(v));
		a.set(99);
		expect(values).toEqual([99]);
	});

	it("tap() auto-generates name when none provided", () => {
		const a = state(0, { name: "src" });
		const tapped = Inspector.tap(a);

		expect(Inspector.getName(tapped)).toBe("tap(src)");
	});

	// -----------------------------------------------------------------------
	// spy() — observe with console logging
	// -----------------------------------------------------------------------

	it("spy() returns observe-like result and logs to console", () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const a = state(0, { name: "a" });
		const result = Inspector.spy(a, { name: "myspy" });

		a.set(10);
		a.set(20);

		expect(result.values).toEqual([10, 20]);
		expect(result.dirtyCount).toBe(2);
		expect(result.name).toBe("myspy");

		// Console was called
		expect(consoleSpy).toHaveBeenCalledWith("[myspy] STATE:", expect.anything());
		expect(consoleSpy).toHaveBeenCalledWith("[myspy] DATA:", 10);
		expect(consoleSpy).toHaveBeenCalledWith("[myspy] DATA:", 20);

		result.dispose();
		consoleSpy.mockRestore();
	});

	// -----------------------------------------------------------------------
	// snapshot() — JSON-serializable graph
	// -----------------------------------------------------------------------

	it("snapshot() returns JSON-serializable graph data", () => {
		const a = state(1, { name: "a" });
		const _b = derived([a], () => a.get() * 2, { name: "b" });

		const snap = Inspector.snapshot();

		expect(snap.nodes).toContainEqual({
			name: "a",
			kind: "state",
			value: 1,
			status: "DISCONNECTED",
		});
		expect(snap.nodes).toContainEqual({
			name: "b",
			kind: "derived",
			value: 2,
			status: "DISCONNECTED",
		});

		expect(snap.edges).toContainEqual({ from: "a", to: "b" });

		// Verify it's actually JSON-serializable
		const json = JSON.stringify(snap);
		expect(JSON.parse(json)).toEqual(snap);
	});

	// -----------------------------------------------------------------------
	// Full debugging scenario (no hooks)
	// -----------------------------------------------------------------------

	it("full debugging scenario: graph + observe + trace", () => {
		// Build a small reactive graph
		const count = state(0, { name: "count" });
		const doubled = derived([count], () => count.get() * 2, { name: "doubled" });

		// Use observe() to capture protocol events
		const obs = Inspector.observe(doubled);

		// Trigger updates
		count.set(5);
		count.set(10);

		// Verify observe captured the flow
		expect(obs.values).toEqual([10, 20]);
		expect(obs.dirtyCount).toBe(2);

		// Verify graph snapshot
		const g = Inspector.graph();
		expect(g.get("count")?.value).toBe(10);
		expect(g.get("doubled")?.value).toBe(20);

		// Verify edges
		const edges = Inspector.getEdges();
		expect(edges.get("count")).toContain("doubled");

		// Verify dumpGraph works
		const dump = Inspector.dumpGraph();
		expect(dump).toContain("Store Graph (2 nodes):");

		// Verify snapshot is JSON-serializable
		const snap = Inspector.snapshot();
		expect(snap.nodes.length).toBe(2);
		expect(snap.edges).toContainEqual({ from: "count", to: "doubled" });

		obs.dispose();
	});

	// -----------------------------------------------------------------------
	// _reset()
	// -----------------------------------------------------------------------

	it("_reset() clears edges", () => {
		Inspector.registerEdge(state(1, { name: "x" }), state(2, { name: "y" }));
		Inspector._reset();
		expect(Inspector.getEdges().size).toBe(0);
	});
});
