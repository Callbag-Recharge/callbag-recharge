import { describe, expect, test } from "vitest";
import { subscribe } from "../../core/subscribe";
import { batch, derived, effect, Inspector, producer, state } from "../../index";

// ---------------------------------------------------------------------------
// #1 State write fast path
// ---------------------------------------------------------------------------

describe("state write fast path", () => {
	test("set() with no subscribers updates value", () => {
		const s = state(1);
		s.set(2);
		expect(s.get()).toBe(2);
	});

	test("set() deduplicates via Object.is (default)", () => {
		const s = state(1);
		let runs = 0;
		effect([s], () => {
			s.get();
			runs++;
		});
		expect(runs).toBe(1);

		s.set(1); // same value — should not trigger
		expect(runs).toBe(1);

		s.set(2);
		expect(runs).toBe(2);
	});

	test("set() with custom equals works", () => {
		const s = state({ id: 1, label: "a" }, { equals: (a, b) => a.id === b.id });
		let runs = 0;
		effect([s], () => {
			s.get();
			runs++;
		});
		expect(runs).toBe(1);

		s.set({ id: 1, label: "b" }); // same id — skipped
		expect(runs).toBe(1);

		s.set({ id: 2, label: "c" }); // different id — triggers
		expect(runs).toBe(2);
	});

	test("set() dispatches DIRTY + DATA to subscribers", () => {
		const s = state(0);
		const d = derived([s], () => s.get() * 2);
		expect(d.get()).toBe(0);

		s.set(5);
		expect(d.get()).toBe(10);
	});

	test("set() inside batch defers DATA", () => {
		const s = state(0);
		let runs = 0;
		effect([s], () => {
			s.get();
			runs++;
		});
		expect(runs).toBe(1);

		batch(() => {
			s.set(1);
			s.set(2);
			s.set(3);
			expect(runs).toBe(1); // not yet
		});
		expect(runs).toBe(2); // once after batch
		expect(s.get()).toBe(3);
	});

	test("set() is no-op after complete()", () => {
		const s = state(1) as any;
		// Access the underlying ProducerImpl to call complete
		s.complete();
		s.set(2);
		expect(s.get()).toBe(1); // unchanged
	});

	test("update() uses fast path", () => {
		const s = state(1);
		s.update((v) => v + 1);
		expect(s.get()).toBe(2);

		let runs = 0;
		effect([s], () => {
			s.get();
			runs++;
		});
		expect(runs).toBe(1);

		s.update((v) => v * 3);
		expect(s.get()).toBe(6);
		expect(runs).toBe(2);
	});

	test("set() with undefined initial allows first emission", () => {
		const s = state<number | undefined>(undefined);
		let runs = 0;
		effect([s], () => {
			s.get();
			runs++;
		});
		expect(runs).toBe(1);

		// First set should go through even though value is undefined
		s.set(undefined);
		expect(runs).toBe(2);

		s.set(42);
		expect(runs).toBe(3);
	});

	test("destructured set() still works (bound method)", () => {
		const s = state(1);
		const { set } = s;
		set(2);
		expect(s.get()).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// #3 derived.from()
// ---------------------------------------------------------------------------

describe("derived.from()", () => {
	test("basic identity: tracks dep value", () => {
		const s = state(1);
		const p = derived.from(s);
		expect(p.get()).toBe(1);

		s.set(2);
		expect(p.get()).toBe(2);

		s.set(42);
		expect(p.get()).toBe(42);
	});

	test("with equals: deduplicates downstream", () => {
		const s = state(0);
		const p = derived.from(s, { equals: (a, b) => a === b });
		let runs = 0;
		effect([p], () => {
			p.get();
			runs++;
		});
		expect(runs).toBe(1);

		s.set(0); // same value — from() sends RESOLVED, effect skips
		expect(runs).toBe(1);

		s.set(1);
		expect(runs).toBe(2);
	});

	test("with name: Inspector shows correct info", () => {
		Inspector._reset();
		Inspector.enabled = true;
		const s = state(1, { name: "src" });
		const p = derived.from(s, { name: "probe" });
		const info = Inspector.inspect(p);
		expect(info.name).toBe("probe");
		expect(info.kind).toBe("derived");
		expect(info.value).toBe(1);
	});

	test("downstream derived reacts to from() changes", () => {
		const s = state(1);
		const p = derived.from(s);
		const doubled = derived([p], () => p.get() * 2);
		expect(doubled.get()).toBe(2);

		s.set(5);
		expect(doubled.get()).toBe(10);
	});

	test("effect reacts to from() changes", () => {
		const s = state(0);
		const p = derived.from(s);
		const values: number[] = [];
		effect([p], () => {
			values.push(p.get());
		});
		expect(values).toEqual([0]);

		s.set(1);
		expect(values).toEqual([0, 1]);

		s.set(2);
		expect(values).toEqual([0, 1, 2]);
	});

	test("subscribe works with from()", () => {
		const s = state(0);
		const p = derived.from(s);
		const values: number[] = [];
		const unsub = subscribe(p, (v) => values.push(v));

		s.set(1);
		s.set(2);
		expect(values).toEqual([1, 2]);
		unsub();
	});

	test("diamond pattern with from()", () => {
		const a = state(1);
		const b = derived.from(a);
		const c = derived([a], () => a.get() * 2);
		let runs = 0;
		effect([b, c], () => {
			b.get();
			c.get();
			runs++;
		});
		expect(runs).toBe(1);

		a.set(2);
		expect(runs).toBe(2);
		expect(b.get()).toBe(2);
		expect(c.get()).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// #4 Lazy STANDALONE
// ---------------------------------------------------------------------------

describe("lazy STANDALONE", () => {
	test("derived not connected until first get()", () => {
		let started = false;
		const p = producer<number>(
			({ emit }) => {
				started = true;
				emit(1);
			},
			{ initial: 0 },
		);

		// Create derived — should NOT trigger producer start
		const d = derived([p], () => p.get() + 1);
		expect(started).toBe(false);

		// First get() triggers lazy connection. Producer starts during
		// endDeferredStart(), emits 1 → derived recomputes to 1+1=2.
		expect(d.get()).toBe(2);
		expect(started).toBe(true);
	});

	test("derived connects on first source() subscription", () => {
		const s = state(1);
		const d = derived([s], () => s.get() * 2);

		// Subscribe — triggers lazy connection
		const values: number[] = [];
		const unsub = subscribe(d, (v) => values.push(v));

		s.set(2);
		expect(values).toEqual([4]);

		s.set(3);
		expect(values).toEqual([4, 6]);
		unsub();
	});

	test("get() after state change returns fresh value", () => {
		const s = state(1);
		const d = derived([s], () => s.get() + 10);

		// Don't call get() yet — derived is not connected
		s.set(5);

		// First get() recomputes + connects — should reflect current state
		expect(d.get()).toBe(15);

		// Subsequent changes reflected via STANDALONE subscription
		s.set(10);
		expect(d.get()).toBe(20);
	});

	test("diamond pattern works with lazy STANDALONE", () => {
		const a = state(1);
		const b = derived([a], () => a.get() + 1);
		const c = derived([a], () => a.get() * 2);
		const d = derived([b, c], () => b.get() + c.get());

		expect(d.get()).toBe(4); // (1+1) + (1*2) = 4

		a.set(3);
		expect(d.get()).toBe(10); // (3+1) + (3*2) = 10
	});

	test("effect triggers lazy connection on deps", () => {
		const s = state(0);
		const d = derived([s], () => s.get() + 1);
		const values: number[] = [];

		// Effect subscribes to d — should trigger d's lazy connection
		effect([d], () => {
			values.push(d.get());
		});
		expect(values).toEqual([1]); // 0 + 1

		s.set(5);
		expect(values).toEqual([1, 6]); // 5 + 1
	});

	test("multiple derived chain: lazy connects cascade", () => {
		const s = state(1);
		const a = derived([s], () => s.get() + 1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([b], () => b.get() + 10);

		// None connected yet. First get on c cascades.
		expect(c.get()).toBe(14); // ((1+1)*2)+10 = 14

		s.set(3);
		expect(c.get()).toBe(18); // ((3+1)*2)+10 = 18
	});

	test("subscriber unsub returns to STANDALONE, stays connected", () => {
		const s = state(1);
		const d = derived([s], () => s.get() * 2);

		// get() to trigger lazy connection
		expect(d.get()).toBe(2);

		// Add subscriber
		const values: number[] = [];
		const unsub = subscribe(d, (v) => values.push(v));
		s.set(2);
		expect(values).toEqual([4]);

		// Remove subscriber — back to STANDALONE
		unsub();

		// Changes still tracked (STANDALONE keeps deps connected)
		s.set(3);
		expect(d.get()).toBe(6);
	});

	test("batch works with lazy STANDALONE derived", () => {
		const a = state(0);
		const b = state(0);
		const d = derived([a, b], () => a.get() + b.get());

		expect(d.get()).toBe(0);

		batch(() => {
			a.set(1);
			b.set(2);
		});
		expect(d.get()).toBe(3);
	});
});
