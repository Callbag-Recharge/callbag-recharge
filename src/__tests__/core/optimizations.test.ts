import { beforeEach, describe, expect, test } from "vitest";
import { derived } from "../../derived";
import { effect } from "../../effect";
import { pipeRaw, SKIP } from "../../extra/pipeRaw";
import { Inspector } from "../../inspector";
import { producer } from "../../producer";
import { batch } from "../../protocol";
import { state } from "../../state";

// ---------------------------------------------------------------------------
// Inspector.enabled
// ---------------------------------------------------------------------------

describe("Inspector.enabled", () => {
	beforeEach(() => {
		Inspector._reset();
	});

	test("disabled → register is no-op, graph returns empty", () => {
		Inspector.enabled = false;
		const s = state(1, { name: "x" });
		expect(Inspector.graph().size).toBe(0);
		expect(Inspector.getName(s)).toBe(undefined);
	});

	test("re-enabled → normal behavior restored", () => {
		Inspector.enabled = false;
		state(1, { name: "invisible" });
		Inspector.enabled = true;
		const s2 = state(2, { name: "visible" });
		expect(Inspector.getName(s2)).toBe("visible");
		// Only the store created while enabled should appear
		expect(Inspector.graph().size).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// equals option
// ---------------------------------------------------------------------------

describe("equals option", () => {
	test("state with custom equals: skip pushDirty when values are 'equal'", () => {
		const s = state({ id: 1, label: "a" }, { equals: (a, b) => a.id === b.id });
		let runs = 0;
		effect([s], () => {
			s.get();
			runs++;
		});
		expect(runs).toBe(1);

		// Same id → considered equal, effect should not re-run
		s.set({ id: 1, label: "b" });
		expect(runs).toBe(1);

		// Different id → not equal, effect re-runs
		s.set({ id: 2, label: "c" });
		expect(runs).toBe(2);
	});

	test("derived with equals: returns cached ref when output unchanged", () => {
		const a = state(1);
		const b = state(2);
		const sum = derived([a, b], () => a.get() + b.get(), {
			equals: (x, y) => x === y,
		});

		const ref1 = sum.get(); // 3
		expect(ref1).toBe(3);

		// Change a and b so sum stays the same (1+2 → 2+1)
		a.set(2);
		b.set(1);
		const ref2 = sum.get(); // still 3
		expect(ref2).toBe(3);
	});

	test("diamond with equals on intermediates: downstream effect runs fewer times", () => {
		const a = state(0);
		// B clamps to 0/1
		const b = derived([a], () => (a.get() >= 5 ? 1 : 0), {
			equals: (x, y) => x === y,
		});
		const c = derived([a], () => a.get() * 2);
		let dRuns = 0;
		effect([b, c], () => {
			b.get();
			c.get();
			dRuns++;
		});
		expect(dRuns).toBe(1);

		// a=1: b stays 0 (equals → cached), c changes → effect runs
		a.set(1);
		expect(dRuns).toBe(2);

		// a=2: b stays 0, c changes → effect runs
		a.set(2);
		expect(dRuns).toBe(3);
	});

	test("producer with custom equals: skip emit for 'equal' values", () => {
		const s = producer<{ id: number }>(undefined, {
			equals: (a, b) => a.id === b.id,
		});

		let runs = 0;
		effect([s], () => {
			s.get();
			runs++;
		});
		expect(runs).toBe(1); // initial effect run

		s.emit({ id: 1 });
		expect(runs).toBe(2); // first emit

		// Same id → skipped
		s.emit({ id: 1 });
		expect(runs).toBe(2);

		// Different id → runs
		s.emit({ id: 2 });
		expect(runs).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// batch()
// ---------------------------------------------------------------------------

describe("batch()", () => {
	test("multiple set() inside batch → effects run once after batch ends", () => {
		const a = state(0);
		const b = state(0);
		let runs = 0;
		effect([a, b], () => {
			a.get();
			b.get();
			runs++;
		});
		expect(runs).toBe(1);

		batch(() => {
			a.set(1);
			b.set(2);
		});
		expect(runs).toBe(2); // exactly one re-run
	});

	test("nested batch → effects run only when outermost ends", () => {
		const a = state(0);
		let runs = 0;
		effect([a], () => {
			a.get();
			runs++;
		});
		expect(runs).toBe(1);

		batch(() => {
			a.set(1);
			batch(() => {
				a.set(2);
			});
			// Inner batch ended but outer hasn't — effect should not have run yet
			// (depth is still > 0)
			a.set(3);
		});
		// Effect should run once after outermost batch
		expect(runs).toBe(2);
		expect(a.get()).toBe(3);
	});

	test("return value forwarded", () => {
		const result = batch(() => 42);
		expect(result).toBe(42);
	});

	test("error in callback still decrements depth (try/finally)", () => {
		const a = state(0);
		let runs = 0;
		effect([a], () => {
			a.get();
			runs++;
		});
		expect(runs).toBe(1);

		expect(() => {
			batch(() => {
				a.set(1);
				throw new Error("boom");
			});
		}).toThrow("boom");

		// Depth should have been restored — subsequent set should trigger effect immediately
		a.set(2);
		expect(runs).toBe(3); // once for set(1) flush after error, once for set(2)
	});
});

// ---------------------------------------------------------------------------
// pipeRaw() + SKIP
// ---------------------------------------------------------------------------

describe("pipeRaw()", () => {
	test("map chain produces correct values", () => {
		const s = state(2);
		const result = pipeRaw(
			s,
			(n: number) => n * 3,
			(n: number) => n + 1,
		);
		expect(result.get()).toBe(7); // 2*3+1
		s.set(5);
		expect(result.get()).toBe(16); // 5*3+1
	});

	test("SKIP returns cached / undefined on first", () => {
		const s = state(0);
		const result = pipeRaw(s, (n: number) => (n > 0 ? n * 2 : SKIP));
		// First call: n=0, SKIP, no cache → undefined
		expect(result.get()).toBe(undefined);

		s.set(3);
		expect(result.get()).toBe(6);

		// Back to 0 → SKIP, returns cached 6
		s.set(0);
		expect(result.get()).toBe(6);
	});

	test("single derived created (Inspector.graph() count)", () => {
		Inspector._reset();
		Inspector.enabled = true;
		const s = state(1, { name: "src" });
		pipeRaw(
			s,
			(n: number) => n * 2,
			(n: number) => n + 1,
			(n: number) => String(n),
		);
		const graph = Inspector.graph();
		// Should have: src (state) + 1 derived for the fused pipe = 2 stores
		expect(graph.size).toBe(2);
	});

	test("re-runs when source changes", () => {
		const s = state(10);
		const result = pipeRaw(s, (n: number) => n * 2);
		expect(result.get()).toBe(20);
		s.set(5);
		expect(result.get()).toBe(10);
	});
});
