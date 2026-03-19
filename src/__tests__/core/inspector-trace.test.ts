import { afterEach, describe, expect, it } from "vitest";
import { derived } from "../../core/derived";
import { Inspector } from "../../core/inspector";
import { state } from "../../core/state";

describe("Inspector reasoning trace", () => {
	afterEach(() => {
		Inspector._reset();
	});

	it("annotate stores a reason on a node", () => {
		const s = state(0, { name: "counter" });
		Inspector.annotate(s, "initialized for retry tracking");

		expect(Inspector.getAnnotation(s)).toBe("initialized for retry tracking");
	});

	it("getAnnotation returns undefined for unannotated nodes", () => {
		const s = state(0);
		expect(Inspector.getAnnotation(s)).toBeUndefined();
	});

	it("annotate overwrites previous annotation on same node", () => {
		const s = state(0, { name: "a" });
		Inspector.annotate(s, "first reason");
		Inspector.annotate(s, "updated reason");

		expect(Inspector.getAnnotation(s)).toBe("updated reason");
	});

	it("traceLog returns chronological entries", () => {
		const a = state(0, { name: "a" });
		const b = state(1, { name: "b" });

		Inspector.annotate(a, "source of truth");
		Inspector.annotate(b, "fallback path");
		Inspector.annotate(a, "promoted to primary");

		const log = Inspector.traceLog();
		expect(log).toHaveLength(3);
		expect(log[0].node).toBe("a");
		expect(log[0].reason).toBe("source of truth");
		expect(log[1].node).toBe("b");
		expect(log[1].reason).toBe("fallback path");
		expect(log[2].node).toBe("a");
		expect(log[2].reason).toBe("promoted to primary");

		// All entries have timestamps
		for (const entry of log) {
			expect(typeof entry.timestamp).toBe("number");
			expect(entry.timestamp).toBeGreaterThan(0);
		}
	});

	it("traceLog returns a copy (not the internal array)", () => {
		const s = state(0, { name: "s" });
		Inspector.annotate(s, "test");

		const log1 = Inspector.traceLog();
		const log2 = Inspector.traceLog();
		expect(log1).not.toBe(log2);
		expect(log1).toEqual(log2);
	});

	it("clearTrace empties the log but keeps per-node annotations", () => {
		const s = state(0, { name: "s" });
		Inspector.annotate(s, "persistent annotation");

		expect(Inspector.traceLog()).toHaveLength(1);
		Inspector.clearTrace();
		expect(Inspector.traceLog()).toHaveLength(0);

		// Per-node annotation still available
		expect(Inspector.getAnnotation(s)).toBe("persistent annotation");
	});

	it("snapshot includes annotations on annotated nodes", () => {
		const a = state(0, { name: "a" });
		const _b = derived([a], () => a.get() * 2, { name: "b" });

		Inspector.annotate(a, "root input");

		const snap = Inspector.snapshot();
		const nodeA = snap.nodes.find((n) => n.name === "a");
		const nodeB = snap.nodes.find((n) => n.name === "b");

		expect(nodeA?.annotation).toBe("root input");
		expect(nodeB?.annotation).toBeUndefined();
	});

	it("snapshot includes trace log", () => {
		const s = state(0, { name: "s" });
		Inspector.annotate(s, "reason 1");
		Inspector.annotate(s, "reason 2");

		const snap = Inspector.snapshot();
		expect(snap.trace).toHaveLength(2);
		expect(snap.trace[0].reason).toBe("reason 1");
		expect(snap.trace[1].reason).toBe("reason 2");
	});

	it("annotate is no-op when Inspector is disabled", () => {
		Inspector.enabled = false;
		const s = state(0);
		Inspector.annotate(s, "should not be stored");

		// WeakMap still gets the annotation (annotate only checks enabled for the log)
		// Actually let's verify the behavior
		expect(Inspector.traceLog()).toHaveLength(0);
		Inspector.enabled = true;
	});

	it("_reset clears annotations and trace log", () => {
		const s = state(0, { name: "s" });
		Inspector.annotate(s, "test");

		Inspector._reset();
		expect(Inspector.traceLog()).toHaveLength(0);
		// WeakMap annotation gone after reset
		expect(Inspector.getAnnotation(s)).toBeUndefined();
	});

	it("annotate on unregistered node assigns unique fallback key", () => {
		const obj1 = { x: 1 };
		const obj2 = { y: 2 };
		Inspector.annotate(obj1, "reason for obj1");
		Inspector.annotate(obj2, "reason for obj2");

		const log = Inspector.traceLog();
		expect(log).toHaveLength(2);
		// Each unregistered node gets a unique key (not the same "anonymous")
		expect(log[0].node).not.toBe(log[1].node);
		expect(log[0].node).toMatch(/^anonymous_\d+$/);
		expect(log[1].node).toMatch(/^anonymous_\d+$/);
	});

	it("ring buffer evicts oldest entries when maxTraceEntries exceeded", () => {
		Inspector.maxTraceEntries = 3;
		const s = state(0, { name: "s" });
		Inspector.annotate(s, "entry-1");
		Inspector.annotate(s, "entry-2");
		Inspector.annotate(s, "entry-3");
		Inspector.annotate(s, "entry-4"); // evicts entry-1

		const log = Inspector.traceLog();
		expect(log).toHaveLength(3);
		expect(log[0].reason).toBe("entry-2");
		expect(log[1].reason).toBe("entry-3");
		expect(log[2].reason).toBe("entry-4");
	});

	it("ring buffer returns entries in chronological order", () => {
		Inspector.maxTraceEntries = 4;
		const s = state(0, { name: "s" });
		for (let i = 1; i <= 7; i++) {
			Inspector.annotate(s, `entry-${i}`);
		}

		const log = Inspector.traceLog();
		expect(log).toHaveLength(4);
		expect(log.map((e) => e.reason)).toEqual(["entry-4", "entry-5", "entry-6", "entry-7"]);
	});
});
