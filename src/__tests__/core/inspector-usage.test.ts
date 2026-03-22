// ---------------------------------------------------------------------------
// Inspector Usage Examples — Debugging reactive graphs in tests, browser, CLI
// ---------------------------------------------------------------------------
// These tests demonstrate how Inspector can be used as a real debugging tool.
// Inspector has zero intrusion into primitives — it's purely:
// 1. Read-only metadata (graph, dumpGraph, snapshot, inspect, getEdges)
// 2. Callbag sinks (observe, spy, trace) that subscribe externally
// 3. Graph wrappers (tap) for visualization
//
// Copy these patterns into your own project tests to:
// - Inspect protocol events (DIRTY, DATA, RESOLVED, END)
// - Verify diamond glitch-freedom
// - Snapshot the entire graph for AI/CLI debugging
// - Insert taps for graph visualization without affecting production
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscribe } from "../../extra/subscribe";
import { batch, DIRTY, derived, Inspector, producer, RESOLVED, state } from "../../index";

beforeEach(() => {
	Inspector._reset();
});

// ===========================================================================
// Example 1: observe() — protocol-level state inspection
// ===========================================================================

describe("Example 1: observe() — protocol-level state inspection", () => {
	it("captures DIRTY on type 3 and value on type 1 per set()", () => {
		const s = state(0, { name: "counter" });
		const obs = Inspector.observe(s);

		s.set(1);
		s.set(2);

		// Values: only DATA payloads
		expect(obs.values).toEqual([1, 2]);

		// Signals: DIRTY before each value
		expect(obs.dirtyCount).toBe(2);

		// Protocol order: DIRTY, DATA, DIRTY, DATA
		expect(obs.events).toEqual([
			{ type: "signal", data: DIRTY },
			{ type: "data", data: 1 },
			{ type: "signal", data: DIRTY },
			{ type: "data", data: 2 },
		]);

		// Name from Inspector registration
		expect(obs.name).toBe("counter");

		obs.dispose();
	});
});

// ===========================================================================
// Example 2: observe() — diamond glitch-freedom proof
// ===========================================================================

describe("Example 2: observe() — diamond glitch-freedom proof", () => {
	it("convergence node D emits once per source change, never intermediate values", () => {
		//     A
		//    / \
		//   B   C
		//    \ /
		//     D
		const a = state(1, { name: "a" });
		const b = derived([a], () => a.get() + 1, { name: "b" });
		const c = derived([a], () => a.get() * 2, { name: "c" });
		const d = derived([b, c], () => b.get() + c.get(), { name: "d" });

		const obsD = Inspector.observe(d);

		a.set(5);
		// b=6, c=10, d=16 — no intermediate glitch value
		expect(obsD.values).toEqual([16]);
		expect(obsD.dirtyCount).toBe(1);

		a.set(10);
		// b=11, c=20, d=31
		expect(obsD.values).toEqual([16, 31]);

		obsD.dispose();
	});
});

// ===========================================================================
// Example 3: observe() — RESOLVED subtree skipping
// ===========================================================================

describe("Example 3: observe() — RESOLVED subtree skipping", () => {
	it("parity node sends RESOLVED (not DATA) when value unchanged", () => {
		const s = state(1, { name: "source" });
		const parity = derived([s], () => s.get() % 2, {
			name: "parity",
			equals: (a, b) => a === b,
		});

		const obs = Inspector.observe(parity);

		// s=1→3: parity 1%2=1 → 3%2=1, unchanged
		s.set(3);

		// No DATA emitted — parity sent RESOLVED instead
		expect(obs.values).toEqual([]);
		expect(obs.resolvedCount).toBe(1);
		expect(obs.signals).toEqual([DIRTY, RESOLVED]);

		// s=3→2: parity changes 1→0
		s.set(2);
		expect(obs.values).toEqual([0]);
		expect(obs.dirtyCount).toBe(2);
		expect(obs.resolvedCount).toBe(1); // still 1 from before

		obs.dispose();
	});
});

// ===========================================================================
// Example 4: observe() — completion and error
// ===========================================================================

describe("Example 4: observe() — completion and error", () => {
	it("captures END on producer.complete()", () => {
		const p = producer<number>(undefined, { name: "src", initial: 0 });
		const obs = Inspector.observe(p);

		p.emit(1);
		p.emit(2);
		p.complete();

		expect(obs.values).toEqual([1, 2]);
		expect(obs.completedCleanly).toBe(true);
	});

	it("captures END with error payload on producer.error()", () => {
		const p = producer<number>(undefined, { name: "src", initial: 0 });
		const obs = Inspector.observe(p);

		p.emit(1);
		p.error("boom");

		expect(obs.values).toEqual([1]);
		expect(obs.errored).toBe(true);
		expect(obs.endError).toBe("boom");
	});
});

// ===========================================================================
// Example 5: observe() — batch coalescing proof
// ===========================================================================

describe("Example 5: observe() — batch coalescing proof", () => {
	it("batch sends single DIRTY + single DATA despite multiple set() calls", () => {
		const s = state(0, { name: "batched" });
		const obs = Inspector.observe(s);

		batch(() => {
			s.set(1);
			s.set(2);
			s.set(3);
		});

		// Only the final value emitted
		expect(obs.values).toEqual([3]);
		// Single DIRTY (sent immediately), single DATA (deferred to batch end)
		expect(obs.dirtyCount).toBe(1);
		expect(obs.events).toEqual([
			{ type: "signal", data: DIRTY },
			{ type: "data", data: 3 },
		]);

		obs.dispose();
	});
});

// ===========================================================================
// Example 6: tap() — transparent graph visualization wrapper
// ===========================================================================

describe("Example 6: tap() — graph visualization", () => {
	it("tap inserts a named node without affecting data flow", () => {
		const a = state(1, { name: "a" });
		const _b = derived([a], () => a.get() * 2, { name: "b" });

		// Insert a tap between a and its downstream for debugging
		const tapped = Inspector.tap(a, "debug_a");

		// tap delegates transparently
		expect(tapped.get()).toBe(1);
		a.set(5);
		expect(tapped.get()).toBe(5);

		// Graph shows the tap node
		const snap = Inspector.snapshot();
		const tapNode = snap.nodes.find((n) => n.name === "debug_a");
		expect(tapNode).toBeDefined();
		expect(tapNode?.kind).toBe("tap");

		// Edge: a → debug_a
		expect(snap.edges).toContainEqual({ from: "a", to: "debug_a" });
	});

	it("subscribing through tap receives all updates", () => {
		const a = state(0, { name: "src" });
		const tapped = Inspector.tap(a);
		const values: number[] = [];

		subscribe(tapped, (v) => values.push(v));
		a.set(10);
		a.set(20);

		expect(values).toEqual([10, 20]);
	});
});

// ===========================================================================
// Example 7: spy() — observe with console logging
// ===========================================================================

describe("Example 7: spy() — interactive debugging", () => {
	it("spy logs to console and captures protocol events", () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const s = state(0, { name: "src" });
		const d = derived([s], () => s.get() * 3, { name: "tripled" });

		const result = Inspector.spy(d, { name: "debug" });

		s.set(5);

		// Returns observe-like result
		expect(result.values).toEqual([15]);
		expect(result.dirtyCount).toBe(1);

		// Console was called for each event
		expect(consoleSpy).toHaveBeenCalledWith("[debug] STATE:", DIRTY);
		expect(consoleSpy).toHaveBeenCalledWith("[debug] DATA:", 15);

		result.dispose();
		consoleSpy.mockRestore();
	});
});

// ===========================================================================
// Example 8: snapshot() — AI-friendly graph dump
// ===========================================================================

describe("Example 8: snapshot() — AI-friendly graph dump", () => {
	it("returns a complete JSON-serializable graph for AI consumption", () => {
		//     A
		//    / \
		//   B   C
		//    \ /
		//     D
		const a = state(1, { name: "A" });
		const b = derived([a], () => a.get() * 2, { name: "B" });
		const c = derived([a], () => a.get() + 10, { name: "C" });
		const _d = derived([b, c], () => b.get() + c.get(), { name: "D" });

		const snap = Inspector.snapshot();

		// All nodes present
		expect(snap.nodes.length).toBe(4);
		expect(snap.nodes.map((n) => n.name).sort()).toEqual(["A", "B", "C", "D"]);

		// Values are correct
		expect(snap.nodes.find((n) => n.name === "A")?.value).toBe(1);
		expect(snap.nodes.find((n) => n.name === "D")?.value).toBe(13); // 2 + 11

		// Edges capture full topology
		expect(snap.edges).toContainEqual({ from: "A", to: "B" });
		expect(snap.edges).toContainEqual({ from: "A", to: "C" });
		expect(snap.edges).toContainEqual({ from: "B", to: "D" });
		expect(snap.edges).toContainEqual({ from: "C", to: "D" });

		// JSON round-trip works
		expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
	});
});

// ===========================================================================
// Example 9: dumpGraph() for console/CLI debugging
// ===========================================================================

describe("Example 9: dumpGraph() for console/CLI", () => {
	it("produces a readable snapshot of a multi-node graph", () => {
		const count = state(42, { name: "count" });
		const doubled = derived([count], () => count.get() * 2, { name: "doubled" });
		const _label = derived([doubled], () => `value=${doubled.get()}`, { name: "label" });

		// In a real debugging session you'd do: console.log(Inspector.dumpGraph())
		const dump = Inspector.dumpGraph();

		// Verify structure
		expect(dump).toContain("Store Graph (3 nodes):");
		expect(dump).toContain("count (state) = 42");
		expect(dump).toContain("doubled (derived) = 84");
		expect(dump).toContain('label (derived) = "value=84"');
		// v6: derived nodes are DISCONNECTED without subscribers
		expect(dump).toContain("[DISCONNECTED]");

		// Edges show dependency graph
		const edges = Inspector.getEdges();
		expect(edges.get("count")).toEqual(["doubled"]);
		expect(edges.get("doubled")).toEqual(["label"]);
	});
});

// ===========================================================================
// Example 10: Double diamond — graph verification without hooks
// ===========================================================================

describe("Example 10: Double diamond — graph + observe verification", () => {
	it("verifies full topology and glitch-freedom via observe + snapshot", () => {
		//     A
		//    / \
		//   B   C
		//    \ / \
		//     D   E
		//      \ /
		//       F
		const a = state(1, { name: "A" });
		const b = derived([a], () => a.get() * 2, { name: "B" });
		const c = derived([a], () => a.get() + 10, { name: "C" });
		const d = derived([b, c], () => b.get() + c.get(), { name: "D" });
		const e = derived([c], () => c.get() * 3, { name: "E" });
		const f = derived([d, e], () => d.get() + e.get(), { name: "F" });

		const obsF = Inspector.observe(f);

		a.set(5);

		// F computed exactly once (glitch-free)
		expect(obsF.values).toEqual([70]); // (10+15) + (15*3) = 25 + 45 = 70
		expect(obsF.dirtyCount).toBe(1);

		// Snapshot confirms full topology
		const snap = Inspector.snapshot();
		expect(snap.nodes.length).toBe(6);

		// Verify edge topology
		const edgeSet = new Set(snap.edges.map((e) => `${e.from}->${e.to}`));
		expect(edgeSet).toContain("A->B");
		expect(edgeSet).toContain("A->C");
		expect(edgeSet).toContain("B->D");
		expect(edgeSet).toContain("C->D");
		expect(edgeSet).toContain("C->E");
		expect(edgeSet).toContain("D->F");
		expect(edgeSet).toContain("E->F");

		obsF.dispose();
	});
});
