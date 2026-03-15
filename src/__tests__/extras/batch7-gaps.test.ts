import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flat } from "../../extra/flat";
import { fromIter } from "../../extra/fromIter";
import { of } from "../../extra/of";
import { repeat } from "../../extra/repeat";
import { subscribe } from "../../extra/subscribe";
import { pipeRaw, SKIP } from "../../extra/pipeRaw";
import { derived, Inspector, operator, pipe, producer, state } from "../../index";
import { batch } from "../../batch";
import { DATA, END, START, STATE } from "../../protocol";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ===========================================================================
// flat — edge cases beyond basics
// ===========================================================================

describe("flat", () => {
	it("outer error propagates to flat", () => {
		const outer = producer<any>(({ error }) => {
			error("outer-fail");
		});
		const f = pipe(outer, flat());
		let err: unknown;
		subscribe(f, () => {}, { onEnd: (e) => (err = e) });
		expect(err).toBe("outer-fail");
	});

	it("outer completes with no inner → immediate complete", () => {
		const outer = producer<any>(({ complete }) => {
			complete();
		});
		const f = pipe(outer, flat());
		let ended = false;
		let err: unknown;
		subscribe(f, () => {}, { onEnd: (e) => { ended = true; err = e; } });
		expect(ended).toBe(true);
		expect(err).toBeUndefined();
	});

	it("outer completes while inner active → waits for inner to complete", () => {
		const inner = state(1);
		const outer = producer<any>(({ emit, complete }) => {
			emit(inner);
			complete();
		});
		const f = pipe(outer, flat());
		const values: number[] = [];
		let ended = false;
		subscribe(f, (v) => values.push(v as number), { onEnd: () => (ended = true) });

		// Outer completed but inner still alive
		expect(ended).toBe(false);
		inner.set(2);
		expect(values).toContain(2);
	});

	it("inner completes after outer completes → flat completes", () => {
		const inner = producer<number>(({ emit, complete }) => {
			emit(10);
			complete();
		});
		const outer = producer<any>(({ emit, complete }) => {
			emit(inner);
			complete();
		});
		const f = pipe(outer, flat());
		let ended = false;
		subscribe(f, () => {}, { onEnd: () => (ended = true) });
		expect(ended).toBe(true);
	});

	it("inner error while outer still active → error propagates", () => {
		const inner = producer<number>(({ error }) => {
			error("inner-fail");
		});
		const outer = state<any>(inner);
		const f = pipe(outer, flat());
		let err: unknown;
		subscribe(f, () => {}, { onEnd: (e) => (err = e) });
		expect(err).toBe("inner-fail");
	});

	it("rapid switching — only latest inner is active", () => {
		const inners = [state(1), state(2), state(3)];
		const outer = state<any>(inners[0]);
		const f = pipe(outer, flat());
		const values: number[] = [];
		subscribe(f, (v) => values.push(v as number));

		outer.set(inners[1]);
		outer.set(inners[2]);

		// Now only inners[2] should be active
		values.length = 0;
		inners[0].set(10); // should NOT be forwarded
		inners[1].set(20); // should NOT be forwarded
		inners[2].set(30); // should be forwarded
		expect(values).toEqual([30]);
	});

	it("outer emits undefined → unsubscribes inner, emits undefined", () => {
		const inner = state(42);
		const outer = state<any>(inner);
		const f = pipe(outer, flat());
		const values: any[] = [];
		subscribe(f, (v) => values.push(v));

		outer.set(undefined);
		expect(values).toContain(undefined);

		// Inner changes should no longer propagate
		values.length = 0;
		inner.set(99);
		expect(values).toEqual([]);
	});

	it("get() returns current inner value without subscribers", () => {
		const inner = state(7);
		const outer = state<any>(inner);
		const f = pipe(outer, flat());
		// get() should return inner's current value even without subscribers
		expect(f.get()).toBe(7);
	});

	it("multiple subscribers share single outer subscription", () => {
		let outerSubCount = 0;
		const inner = state(1);
		const outer = producer<any>(({ emit }) => {
			outerSubCount++;
			emit(inner);
		});
		const f = pipe(outer, flat());

		const unsub1 = subscribe(f, () => {});
		const unsub2 = subscribe(f, () => {});
		// Producer is multicast — only one outer subscription
		expect(outerSubCount).toBe(1);

		unsub1();
		unsub2();
	});
});

// ===========================================================================
// repeat — edge cases beyond extras-roadmap tests
// ===========================================================================

describe("repeat", () => {
	it("count=0 → immediate complete, no subscription", () => {
		let factoryCalls = 0;
		const r = repeat(() => {
			factoryCalls++;
			return of(1);
		}, 0);
		let ended = false;
		subscribe(r, () => {}, { onEnd: () => (ended = true) });
		expect(ended).toBe(true);
		expect(factoryCalls).toBe(0);
	});

	it("values from all rounds are emitted in order", () => {
		let round = 0;
		const r = repeat(() => {
			round++;
			return fromIter([round * 10 + 1, round * 10 + 2]);
		}, 3);
		const values: number[] = [];
		subscribe(r, (v) => values.push(v as number));
		expect(values).toEqual([11, 12, 21, 22, 31, 32]);
	});

	it("get() retains last value from previous round after completion", () => {
		const r = repeat(() => fromIter([1, 2, 3]), 2);
		subscribe(r, () => {});
		// After 2 rounds, last value should be 3
		expect(r.get()).toBe(3);
	});

	it("error in any round stops repetition", () => {
		let round = 0;
		const r = repeat(() => {
			round++;
			if (round === 2) {
				return producer<number>(({ error }) => { error("round2-fail"); });
			}
			return fromIter([round]);
		}, 5);
		const values: number[] = [];
		let err: unknown;
		subscribe(r, (v) => values.push(v as number), { onEnd: (e) => (err = e) });
		expect(values).toEqual([1]);
		expect(err).toBe("round2-fail");
		expect(round).toBe(2); // stopped at round 2
	});

	it("unsubscribe during active round cleans up inner source", () => {
		let cleanedUp = false;
		const r = repeat(() => {
			return producer<number>(({ emit }) => {
				emit(1);
				return () => { cleanedUp = true; };
			});
		});
		const unsub = subscribe(r, () => {});
		expect(cleanedUp).toBe(false);
		unsub();
		expect(cleanedUp).toBe(true);
	});

	it("infinite repeat (no count) re-subscribes until unsubscribed", () => {
		let round = 0;
		// Use async-completing source to avoid runaway trampoline
		const r = repeat(() => {
			round++;
			const currentRound = round;
			return producer<number>(({ emit, complete }) => {
				emit(currentRound);
				setTimeout(() => complete(), 10);
			});
		});
		const values: number[] = [];
		const unsub = subscribe(r, (v) => values.push(v as number));

		expect(values).toEqual([1]);
		vi.advanceTimersByTime(10); // complete round 1 → resubscribe
		expect(values).toEqual([1, 2]);
		vi.advanceTimersByTime(10); // complete round 2 → resubscribe
		expect(values).toEqual([1, 2, 3]);

		unsub(); // stop
		vi.advanceTimersByTime(100);
		expect(values).toEqual([1, 2, 3]); // no more
	});
});

// ===========================================================================
// pipeRaw / SKIP — edge cases beyond optimizations tests
// ===========================================================================

describe("pipeRaw", () => {
	it("error from upstream propagates through fused pipeline", () => {
		const p = producer<number>();
		const fused = pipeRaw(p, (v) => v * 2);
		let err: unknown;
		subscribe(fused, () => {}, { onEnd: (e) => (err = e) });
		p.error("upstream-fail");
		expect(err).toBe("upstream-fail");
	});

	it("completion from upstream propagates through fused pipeline", () => {
		const p = producer<number>();
		const fused = pipeRaw(p, (v) => v * 2);
		let ended = false;
		let err: unknown;
		subscribe(fused, () => {}, { onEnd: (e) => { ended = true; err = e; } });
		p.complete();
		expect(ended).toBe(true);
		expect(err).toBeUndefined();
	});

	it("3-transform chain produces correct values", () => {
		const s = state(1);
		const fused = pipeRaw(
			s,
			(v) => v + 1,
			(v) => v * 10,
			(v) => `val:${v}`,
		);
		const values: string[] = [];
		subscribe(fused, (v) => values.push(v as string));

		s.set(2);
		s.set(5);
		expect(values).toEqual(["val:30", "val:60"]);
		expect(fused.get()).toBe("val:60");
	});

	it("4-transform chain produces correct values", () => {
		const s = state(1);
		const fused = pipeRaw(
			s,
			(v) => v + 1,
			(v) => v * 2,
			(v) => v - 1,
			(v) => `r:${v}`,
		);
		expect(fused.get()).toBe("r:3"); // (1+1)*2-1 = 3
		const values: string[] = [];
		subscribe(fused, (v) => values.push(v as string));
		s.set(5);
		expect(values).toEqual(["r:11"]); // (5+1)*2-1 = 11
	});

	it("SKIP at first transform → no emission, RESOLVED signal", () => {
		const s = state(0);
		const fused = pipeRaw(
			s,
			(v) => (v % 2 === 0 ? SKIP : v),
			(v) => (v as number) * 10,
		);
		const values: number[] = [];
		subscribe(fused, (v) => values.push(v as number));

		s.set(1); // odd → passes → 10
		s.set(2); // even → SKIP
		s.set(3); // odd → passes → 30
		s.set(4); // even → SKIP
		expect(values).toEqual([10, 30]);
	});

	it("SKIP at middle transform → no emission", () => {
		const s = state(1);
		const fused = pipeRaw(
			s,
			(v) => v * 2,
			(v) => (v > 10 ? SKIP : v),
			(v) => `ok:${v}`,
		);
		const values: string[] = [];
		subscribe(fused, (v) => values.push(v as string));

		s.set(3); // 3*2=6, 6<=10, "ok:6"
		s.set(6); // 6*2=12, 12>10, SKIP
		s.set(4); // 4*2=8, 8<=10, "ok:8"
		expect(values).toEqual(["ok:6", "ok:8"]);
	});

	it("SKIP at last transform → no emission", () => {
		const s = state(1);
		const fused = pipeRaw(
			s,
			(v) => v + 1,
			(v) => (v === 3 ? SKIP : `v:${v}`),
		);
		const values: string[] = [];
		subscribe(fused, (v) => values.push(v as string));

		s.set(1); // 1+1=2, "v:2" — but initial is 1, set(1) is same value, no emission
		s.set(2); // 2+1=3, SKIP
		s.set(3); // 3+1=4, "v:4"
		expect(values).toEqual(["v:4"]);
	});

	it("SKIP returns cached value from get()", () => {
		const s = state(1);
		const fused = pipeRaw(
			s,
			(v) => (v % 2 === 0 ? SKIP : v * 10),
		);
		subscribe(fused, () => {});

		expect(fused.get()).toBe(10); // 1 → 10
		s.set(2); // SKIP
		expect(fused.get()).toBe(10); // still cached 10
		s.set(3); // 30
		expect(fused.get()).toBe(30);
	});

	it("get() without subscribers re-evaluates pipeline", () => {
		const s = state(5);
		const fused = pipeRaw(s, (v) => v * 3);
		// No subscribers — get() should still compute
		expect(fused.get()).toBe(15);
		s.set(10);
		expect(fused.get()).toBe(30);
	});

	it("participates in diamond resolution (type 3 forwarding)", () => {
		const s = state(1);
		const fused = pipeRaw(s, (v) => v * 2);
		let computeCount = 0;
		const d = derived([s, fused], () => {
			computeCount++;
			return s.get() + fused.get();
		});
		subscribe(d, () => {});

		computeCount = 0;
		s.set(5);
		// Diamond: s → fused and s → d directly. With type 3 forwarding,
		// d should recompute only once (after both deps resolve)
		expect(computeCount).toBe(1);
		expect(d.get()).toBe(15); // 5 + 10
	});

	it("reconnect after disconnect re-evaluates", () => {
		const s = state(1);
		const fused = pipeRaw(s, (v) => v + 100);
		const unsub = subscribe(fused, () => {});
		expect(fused.get()).toBe(101);
		unsub();

		s.set(5);
		// After disconnect, get() uses pull-based getter
		expect(fused.get()).toBe(105);

		// Re-subscribe
		const values: number[] = [];
		subscribe(fused, (v) => values.push(v as number));
		s.set(10);
		expect(values).toEqual([110]);
	});

	it("initial value computed correctly when source has initial", () => {
		const s = state(7);
		const fused = pipeRaw(s, (v) => v * 2);
		expect(fused.get()).toBe(14);
	});

	it("initial SKIP → get() returns undefined", () => {
		const s = state(0);
		const fused = pipeRaw(s, (v) => (v === 0 ? SKIP : v));
		expect(fused.get()).toBeUndefined();
	});
});

// ===========================================================================
// Inspector — edge cases beyond basic tests
// ===========================================================================

describe("Inspector", () => {
	it("disabled mode: register() is no-op", () => {
		Inspector.enabled = false;
		const s = state(1, { name: "hidden" });
		expect(Inspector.getName(s)).toBeUndefined();
		// graph should be empty (nothing registered)
		expect(Inspector.graph().size).toBe(0);
	});

	it("disabled mode: getName() returns undefined", () => {
		// Register while enabled
		Inspector.enabled = true;
		const s = state(1, { name: "visible" });
		expect(Inspector.getName(s)).toBe("visible");

		// Disable — getName returns undefined even for registered stores
		Inspector.enabled = false;
		expect(Inspector.getName(s)).toBeUndefined();
	});

	it("getKind() works regardless of enabled flag", () => {
		Inspector.enabled = true;
		const s = state(1);
		Inspector.enabled = false;
		// getKind doesn't check enabled
		expect(Inspector.getKind(s)).toBe("state");
	});

	it("graph() with unnamed stores uses store_N fallback keys", () => {
		const a = state(1); // unnamed
		const b = state(2, { name: "named" });
		const c = state(3); // unnamed

		const g = Inspector.graph();
		expect(g.has("named")).toBe(true);
		// Unnamed stores get store_0, store_1, etc.
		const keys = [...g.keys()].filter((k) => k.startsWith("store_"));
		expect(keys.length).toBe(2);
	});

	it("graph() returns correct values for mixed store types", () => {
		const s = state(1, { name: "s" });
		const d = derived([s], () => s.get() + 10, { name: "d" });
		const p = producer<number>(undefined, { name: "p" });
		const o = operator<number>([s], ({ emit }) => {
			return (_dep, type, data) => {
				if (type === DATA) emit(data);
			};
		});

		const g = Inspector.graph();
		expect(g.get("s")?.kind).toBe("state");
		expect(g.get("d")?.kind).toBe("derived");
		expect(g.get("p")?.kind).toBe("producer");
		// operator is unnamed, gets fallback key
		const opEntry = [...g.entries()].find(([, info]) => info.kind === "operator");
		expect(opEntry).toBeDefined();
	});

	it("trace() deduplicates via Object.is (same value not reported)", () => {
		const s = state(1);
		const changes: number[] = [];
		Inspector.trace(s, (v) => changes.push(v));

		// Force emission of same value (bypass state's own equals)
		// Use producer instead to control emissions
		const p = producer<number>(({ emit }) => {
			emit(1);
			emit(1); // same value
			emit(2);
			emit(2); // same value
			emit(3);
		});
		const traced: number[] = [];
		Inspector.trace(p, (v) => traced.push(v));
		// Subscribe to start the producer
		subscribe(p, () => {});
		// trace uses Object.is — duplicates suppressed
		expect(traced).toEqual([1, 2, 3]);
	});

	it("trace() on completed store calls END, stops tracing", () => {
		const p = producer<number>(({ emit, complete }) => {
			emit(1);
			complete();
		});
		const values: number[] = [];
		const unsub = Inspector.trace(p, (v) => values.push(v));
		subscribe(p, () => {});
		expect(values).toEqual([1]);
		// After completion, further trace unsub should be safe
		unsub(); // should not throw
	});

	it("inspect() reflects current value of store", () => {
		const s = state(0, { name: "counter" });
		s.set(42);
		expect(Inspector.inspect(s).value).toBe(42);
	});

	it("re-enabling after disable allows new registrations", () => {
		Inspector.enabled = false;
		const s1 = state(1, { name: "s1" });
		expect(Inspector.getName(s1)).toBeUndefined();

		Inspector.enabled = true;
		const s2 = state(2, { name: "s2" });
		expect(Inspector.getName(s2)).toBe("s2");
		// s1 was registered while disabled — still won't appear
		expect(Inspector.getName(s1)).toBeUndefined();
	});

	it("_reset() clears enabled override", () => {
		Inspector.enabled = false;
		Inspector._reset();
		// After reset, should default to dev mode (true in test env)
		const s = state(1, { name: "test" });
		expect(Inspector.getName(s)).toBe("test");
	});
});
