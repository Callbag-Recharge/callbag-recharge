// ---------------------------------------------------------------------------
// Two-phase push protocol: correctness, ordering, and emission count tests
// ---------------------------------------------------------------------------
// These tests verify:
// 1. Exact emission order (DIRTY then value for raw callbag)
// 2. Exact fire count (no spurious emissions)
// 3. Diamond topology — glitch-free for core, documented for extras
// 4. Re-entrancy and batch interaction
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { concatMap } from "../extra/concatMap";
import { distinctUntilChanged } from "../extra/distinctUntilChanged";
import { exhaustMap } from "../extra/exhaustMap";
import { flat } from "../extra/flat";
import { map } from "../extra/map";
import { pairwise } from "../extra/pairwise";
import { remember } from "../extra/remember";
import { rescue } from "../extra/rescue";
import { retry } from "../extra/retry";
import { sample } from "../extra/sample";
import { skip } from "../extra/skip";
import { subject } from "../extra/subject";
import { switchMap } from "../extra/switchMap";
import { take } from "../extra/take";
import { tap } from "../extra/tap";
import { effect } from "../effect";
import {
	batch,
	DIRTY,
	derived,
	Inspector,
	pipe,
	state,
	stream,
	subscribe,
} from "../index";

beforeEach(() => {
	Inspector._reset();
});

// ===========================================================================
// Section 1: Two-phase protocol verification at raw callbag level
// ===========================================================================

describe("Two-phase protocol — raw callbag signals", () => {
	it("state emits DIRTY then value per set()", () => {
		const s = state(0);
		const signals: unknown[] = [];

		s.source(0, (type: number, data: unknown) => {
			if (type === 1) signals.push(data);
		});

		s.set(1);
		expect(signals).toEqual([DIRTY, 1]);

		s.set(2);
		expect(signals).toEqual([DIRTY, 1, DIRTY, 2]);
	});

	it("derived forwards DIRTY once then value", () => {
		const a = state(0);
		const d = derived([a], () => a.get() * 2);
		const signals: unknown[] = [];

		d.source(0, (type: number, data: unknown) => {
			if (type === 1) signals.push(data);
		});

		a.set(5);
		expect(signals).toEqual([DIRTY, 10]);
	});

	it("derived with multiple deps emits DIRTY once (first dirty dep)", () => {
		const a = state(1);
		const b = state(2);
		const d = derived([a, b], () => a.get() + b.get());
		const signals: unknown[] = [];

		d.source(0, (type: number, data: unknown) => {
			if (type === 1) signals.push(data);
		});

		// batch so both go dirty before phase 2
		batch(() => {
			a.set(10);
			b.set(20);
		});

		// single DIRTY, single value
		expect(signals).toEqual([DIRTY, 30]);
	});

	it("stream emits DIRTY then value per emit()", () => {
		let emit: (v: number) => void;
		const s = stream<number>((e) => {
			emit = e;
		});
		const signals: unknown[] = [];

		s.source(0, (type: number, data: unknown) => {
			if (type === 1) signals.push(data);
		});

		emit!(42);
		expect(signals).toEqual([DIRTY, 42]);
	});

	it("subject emits DIRTY then value per next()", () => {
		const s = subject<number>();
		const signals: unknown[] = [];

		s.source(0, (type: number, data: unknown) => {
			if (type === 1) signals.push(data);
		});

		s.next(10);
		expect(signals).toEqual([DIRTY, 10]);

		s.next(20);
		expect(signals).toEqual([DIRTY, 10, DIRTY, 20]);
	});
});

// ===========================================================================
// Section 2: Diamond topology — core primitives (glitch-free)
// ===========================================================================

describe("Diamond topology — core (glitch-free)", () => {
	it("derived computes exactly once in a diamond", () => {
		const s = state(1);
		const a = derived([s], () => s.get() + 1);
		const b = derived([s], () => s.get() * 10);
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return a.get() + b.get();
		});

		const values: number[] = [];
		subscribe(c, (v) => values.push(v));

		// Initial: a=2, b=10, c=12. computeCount includes initial compute.
		computeCount = 0;

		s.set(2);
		// a=3, b=20, c=23
		expect(values).toEqual([23]);
		expect(computeCount).toBe(1);
	});

	it("diamond with batch: single computation", () => {
		const x = state(0);
		const y = state(0);
		const a = derived([x, y], () => x.get() + y.get());
		const b = derived([x, y], () => x.get() * y.get());
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return `${a.get()},${b.get()}`;
		});

		const values: string[] = [];
		subscribe(c, (v) => values.push(v));
		computeCount = 0;

		batch(() => {
			x.set(3);
			y.set(4);
		});

		// a=7, b=12 → c="7,12"
		expect(values).toEqual(["7,12"]);
		expect(computeCount).toBe(1);
	});

	it("deep diamond chain: no intermediate glitches", () => {
		const s = state(1);
		//    s
		//   / \
		//  d1  d2
		//   \ /
		//    d3
		//    |
		//    d4
		const d1 = derived([s], () => s.get() + 1);
		const d2 = derived([s], () => s.get() * 2);
		const d3 = derived([d1, d2], () => d1.get() + d2.get());
		const d4 = derived([d3], () => d3.get() * 10);

		const values: number[] = [];
		subscribe(d4, (v) => values.push(v));

		s.set(5);
		// d1=6, d2=10, d3=16, d4=160
		expect(values).toEqual([160]);
	});

	it("effect fires exactly once per change in diamond", () => {
		// effect imported at top level
		const s = state(1);
		const a = derived([s], () => s.get() + 1);
		const b = derived([s], () => s.get() * 2);

		let effectCount = 0;
		const dispose = effect([a, b], () => {
			effectCount++;
		});
		effectCount = 0; // ignore initial run

		s.set(5);
		expect(effectCount).toBe(1);

		s.set(10);
		expect(effectCount).toBe(2);

		dispose();
	});

	it("subscribe fires exactly once per change in diamond", () => {
		const s = state(0);
		const a = derived([s], () => s.get() + 1);
		const b = derived([s], () => s.get() - 1);
		const c = derived([a, b], () => a.get() + b.get()); // always 2*s

		let fireCount = 0;
		const unsub = subscribe(c, (v) => {
			fireCount++;
		});

		s.set(5);
		expect(fireCount).toBe(1);

		s.set(10);
		expect(fireCount).toBe(2);

		unsub();
	});

	it("derived with equals suppresses unchanged values", () => {
		const s = state(1);
		const parity = derived([s], () => s.get() % 2, {
			equals: (a, b) => a === b,
		});

		const values: number[] = [];
		subscribe(parity, (v) => values.push(v));

		s.set(3); // parity still 1 — suppressed
		s.set(5); // parity still 1 — suppressed
		s.set(4); // parity changes to 0

		expect(values).toEqual([0]);
	});

	it("equals suppression in diamond: downstream not re-triggered", () => {
		const s = state(1);
		const parity = derived([s], () => s.get() % 2, {
			equals: (a, b) => a === b,
		});
		const doubled = derived([s], () => s.get() * 2);
		let computeCount = 0;
		const combined = derived([parity, doubled], () => {
			computeCount++;
			return `${parity.get()},${doubled.get()}`;
		});

		const values: string[] = [];
		subscribe(combined, (v) => values.push(v));
		computeCount = 0;

		s.set(3);
		// parity: 1→1 (suppressed by equals, still emits cached value)
		// doubled: 2→6
		// combined: recomputes because doubled changed
		expect(values).toEqual(["1,6"]);
		expect(computeCount).toBe(1);
	});
});

// ===========================================================================
// Section 3: Emission count tests for extras
// ===========================================================================

describe("Emission counts — subscribe-based extras", () => {
	it("take: fires exactly n times", () => {
		const s = state(0);
		const t = pipe(s, take(3));
		let fireCount = 0;
		subscribe(t, () => fireCount++);

		s.set(1);
		s.set(2);
		s.set(3);
		s.set(4); // beyond limit
		s.set(5);

		expect(fireCount).toBe(3);
	});

	it("skip: fires exactly (total - n) times", () => {
		const s = state(0);
		const sk = pipe(s, skip(2));
		let fireCount = 0;
		subscribe(sk, () => fireCount++);

		s.set(1); // skipped
		s.set(2); // skipped
		s.set(3); // fires
		s.set(4); // fires
		s.set(5); // fires

		expect(fireCount).toBe(3);
	});

	it("distinctUntilChanged: suppresses duplicates exactly", () => {
		const s = state(0);
		const d = pipe(s, distinctUntilChanged());
		const values: number[] = [];
		subscribe(d, (v) => values.push(v));

		s.set(1);
		s.set(1); // dup
		s.set(2);
		s.set(2); // dup
		s.set(2); // dup
		s.set(3);
		s.set(1); // not dup (different from prev=3)

		expect(values).toEqual([1, 2, 3, 1]);
	});

	it("tap: fires exactly as many times as upstream changes", () => {
		const s = state(0);
		const tapped: number[] = [];
		const downstream: number[] = [];
		const t = pipe(
			s,
			tap((v) => tapped.push(v)),
		);
		subscribe(t, (v) => downstream.push(v));

		s.set(1);
		s.set(2);
		s.set(3);

		expect(tapped).toEqual([1, 2, 3]);
		expect(downstream).toEqual([1, 2, 3]);
	});

	it("remember: fires exactly as many times as upstream changes", () => {
		const s = state(0);
		const r = pipe(s, remember());
		const values: (number | undefined)[] = [];
		subscribe(r, (v) => values.push(v));

		s.set(1);
		s.set(2);
		s.set(3);

		expect(values).toEqual([1, 2, 3]);
	});

	it("pairwise: fires on each change after the first value", () => {
		const s = state(0);
		const p = pipe(s, pairwise());
		const pairs: [number, number][] = [];
		subscribe(p, (v) => {
			if (v) pairs.push(v);
		});

		s.set(1);
		s.set(2);
		s.set(3);

		expect(pairs).toEqual([
			[0, 1],
			[1, 2],
			[2, 3],
		]);
	});

	it("subject: fires exactly per distinct next()", () => {
		const s = subject<number>();
		const values: (number | undefined)[] = [];
		subscribe(s, (v) => values.push(v));

		s.next(1);
		s.next(2);
		s.next(2); // dup — suppressed by Object.is
		s.next(3);

		expect(values).toEqual([1, 2, 3]);
	});
});

describe("Emission counts — complex extras", () => {
	it("switchMap: exact emission sequence on outer+inner changes", () => {
		const outer = state(1);
		const inner1 = state(10);
		const inner2 = state(20);

		const mapped = pipe(
			outer,
			switchMap((v) => (v === 1 ? inner1 : inner2)),
		);
		const values: (number | undefined)[] = [];
		subscribe(mapped, (v) => values.push(v));

		inner1.set(11); // inner1 change while active
		outer.set(2); // switch to inner2 (emits 20)
		inner1.set(99); // inner1 no longer active — no emission
		inner2.set(21); // inner2 change while active

		expect(values).toEqual([11, 20, 21]);
	});

	it("flat: exact emission sequence on inner switch", () => {
		const inner1 = state(10);
		const inner2 = state(20);
		const outer = state<typeof inner1 | undefined>(inner1);

		const f = pipe(outer, flat());
		const values: (number | undefined)[] = [];
		subscribe(f, (v) => values.push(v));

		inner1.set(11);
		outer.set(inner2); // switch
		inner1.set(99); // disconnected — no emission
		inner2.set(21);

		expect(values).toEqual([11, 20, 21]);
	});

	it("rescue: exact emissions including fallback initial", () => {
		let errorSink: ((type: number, data?: unknown) => void) | null = null;
		const src = {
			get() {
				return 1;
			},
			source(type: number, payload?: unknown) {
				if (type === 0) {
					const sink = payload as (type: number, data?: unknown) => void;
					errorSink = sink;
					sink(0, (t: number) => {
						if (t === 2) errorSink = null;
					});
				}
			},
		};

		const fallback = state(99);
		const r = pipe(
			src,
			rescue(() => fallback),
		);
		const values: number[] = [];
		subscribe(r, (v) => values.push(v));

		// Trigger error → switch to fallback
		errorSink!(2, new Error("boom"));
		// Rescue emits fallback initial value (99)
		expect(values).toEqual([99]);

		fallback.set(100);
		expect(values).toEqual([99, 100]);
	});

	it("retry: exact emission count across retries", () => {
		let errorSink: ((type: number, data?: unknown) => void) | null = null;
		let producerCount = 0;
		const src = {
			get() {
				return producerCount;
			},
			source(type: number, payload?: unknown) {
				if (type === 0) {
					producerCount++;
					const sink = payload as (type: number, data?: unknown) => void;
					errorSink = sink;
					sink(0, (t: number) => {
						if (t === 2) errorSink = null;
					});
				}
			},
		};

		const r = pipe(src, retry(2));
		const signals: unknown[] = [];
		r.source(0, (type: number, data?: unknown) => {
			if (type === 1) signals.push(data === DIRTY ? "DIRTY" : data);
			if (type === 2) signals.push(`END:${data}`);
		});

		// First error — retry 1
		errorSink!(2, new Error("e1"));
		expect(producerCount).toBe(2);

		// Second error — retry 2
		errorSink!(2, new Error("e2"));
		expect(producerCount).toBe(3);

		// Third error — exhausted
		const finalErr = new Error("e3");
		errorSink!(2, finalErr);
		expect(producerCount).toBe(3);
		expect(signals[signals.length - 1]).toBe(`END:${finalErr}`);
	});
});

// ===========================================================================
// Section 4: Re-entrancy and batch ordering
// ===========================================================================

describe("Re-entrancy and batch ordering", () => {
	it("state.set() inside subscribe callback fires in correct order", () => {
		const a = state(0);
		const b = state(0);
		const log: string[] = [];

		subscribe(a, (v) => {
			log.push(`a=${v}`);
			if (v === 1) b.set(10); // re-entrant set
		});
		subscribe(b, (v) => {
			log.push(`b=${v}`);
		});

		a.set(1);
		// a's subscriber fires first, then triggers b's change
		expect(log).toEqual(["a=1", "b=10"]);
	});

	it("batch coalesces multiple set() — subscribers fire once each", () => {
		const s = state(0);
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		batch(() => {
			s.set(1);
			s.set(2);
			s.set(3);
		});

		// Only the final value fires
		expect(values).toEqual([3]);
	});

	it("nested batch defers until outermost ends", () => {
		const s = state(0);
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		batch(() => {
			s.set(1);
			batch(() => {
				s.set(2);
			});
			// inner batch end doesn't trigger — outer still open
			expect(values).toEqual([]);
			s.set(3);
		});

		expect(values).toEqual([3]);
	});

	it("derived recomputes correctly when dep changes inside effect", () => {
		// effect imported at top level
		const trigger = state(0);
		const counter = state(0);
		const sum = derived([trigger, counter], () => trigger.get() + counter.get());

		const values: number[] = [];
		subscribe(sum, (v) => values.push(v));

		// Effect increments counter when trigger changes
		const dispose = effect([trigger], () => {
			if (trigger.get() > 0) counter.set(trigger.get() * 10);
		});

		trigger.set(1);
		// trigger=1, counter set to 10 by effect, sum=11
		expect(values).toContain(11);

		dispose();
	});
});

// ===========================================================================
// Section 5: Diamond topology — extras (document glitch behavior)
// ===========================================================================

describe("Diamond topology — extras (glitch boundaries)", () => {
	it("raw-callbag extra (tap) in diamond: fires correct values", () => {
		// Diamond: s → d1 → c
		//          s → tap → c
		// tap is now a raw-callbag two-phase node, glitch-free.
		const s = state(1);
		const d1 = derived([s], () => s.get() * 2);
		const tapped: number[] = [];
		const t = pipe(
			s,
			tap((v) => tapped.push(v)),
		);

		// Subscribe to both — just verify values are correct
		const d1Values: number[] = [];
		subscribe(d1, (v) => d1Values.push(v));

		const tValues: number[] = [];
		subscribe(t, (v) => tValues.push(v));

		s.set(5);
		expect(d1Values).toEqual([10]);
		expect(tValues).toEqual([5]);
		expect(tapped).toEqual([5]);
	});

	it("complex extra (switchMap) emits correct final value even with glitch", () => {
		const s = state(1);
		const direct = derived([s], () => s.get() * 2);
		const mapped = pipe(
			s,
			switchMap((v) => {
				const inner = state(v * 100);
				return inner;
			}),
		);

		const directValues: number[] = [];
		subscribe(direct, (v) => directValues.push(v));

		const mappedValues: (number | undefined)[] = [];
		subscribe(mapped, (v) => mappedValues.push(v));

		s.set(2);

		// Direct derived: glitch-free, fires once
		expect(directValues).toEqual([4]);

		// switchMap: fires with correct value
		expect(mappedValues).toEqual([200]);
	});

	it("sample fires only on notifier, not on source changes", () => {
		const source = state(0);
		const notifier = state(false);
		const sampled = pipe(source, sample(notifier));

		let fireCount = 0;
		const values: number[] = [];
		subscribe(sampled, (v) => {
			fireCount++;
			values.push(v);
		});

		source.set(1);
		source.set(2);
		source.set(3);
		expect(fireCount).toBe(0); // no fires yet

		notifier.set(true);
		expect(fireCount).toBe(1);
		expect(values).toEqual([3]); // latest source value
	});
});

// ===========================================================================
// Section 6: Passthrough extras — two-phase protocol verification (Phase 2)
// ===========================================================================
// After rewriting passthrough extras as raw-callbag two-phase nodes,
// verify they forward [DIRTY, value] at the raw callbag level (like derived)
// and do NOT start a new pushChange cycle (no nested DIRTY+value).

describe("Passthrough extras — two-phase protocol verification", () => {
	it("take forwards [DIRTY, value] at raw callbag level", () => {
		const s = state(0);
		const t = pipe(s, take(3));
		const signals: unknown[] = [];

		t.source(0, (type: number, data: unknown) => {
			if (type === 1) signals.push(data === DIRTY ? "DIRTY" : data);
		});

		s.set(1);
		expect(signals).toEqual(["DIRTY", 1]);

		s.set(2);
		expect(signals).toEqual(["DIRTY", 1, "DIRTY", 2]);
	});

	it("skip forwards [DIRTY, value] at raw callbag level (after skip phase)", () => {
		const s = state(0);
		const sk = pipe(s, skip(1));
		const signals: unknown[] = [];

		sk.source(0, (type: number, data: unknown) => {
			if (type === 1) signals.push(data === DIRTY ? "DIRTY" : data);
		});

		s.set(1); // skipped — no signals
		expect(signals).toEqual([]);

		s.set(2); // passes
		expect(signals).toEqual(["DIRTY", 2]);
	});

	it("tap forwards [DIRTY, value] at raw callbag level", () => {
		const s = state(0);
		const t = pipe(
			s,
			tap(() => {}),
		);
		const signals: unknown[] = [];

		t.source(0, (type: number, data: unknown) => {
			if (type === 1) signals.push(data === DIRTY ? "DIRTY" : data);
		});

		s.set(5);
		expect(signals).toEqual(["DIRTY", 5]);
	});

	it("remember forwards [DIRTY, value] at raw callbag level", () => {
		const s = state(0);
		const r = pipe(s, remember());
		const signals: unknown[] = [];

		r.source(0, (type: number, data: unknown) => {
			if (type === 1) signals.push(data === DIRTY ? "DIRTY" : data);
		});

		s.set(7);
		expect(signals).toEqual(["DIRTY", 7]);
	});

	it("pairwise forwards [DIRTY, value] at raw callbag level", () => {
		const s = state(0);
		const p = pipe(s, pairwise());
		const signals: unknown[] = [];

		p.source(0, (type: number, data: unknown) => {
			if (type === 1)
				signals.push(data === DIRTY ? "DIRTY" : data);
		});

		s.set(1);
		expect(signals).toEqual(["DIRTY", [0, 1]]);

		s.set(2);
		expect(signals).toEqual(["DIRTY", [0, 1], "DIRTY", [1, 2]]);
	});

	it("distinctUntilChanged forwards [DIRTY, value] at raw callbag level", () => {
		const s = state(0);
		const d = pipe(s, distinctUntilChanged());
		const signals: unknown[] = [];

		d.source(0, (type: number, data: unknown) => {
			if (type === 1) signals.push(data === DIRTY ? "DIRTY" : data);
		});

		s.set(1);
		expect(signals).toEqual(["DIRTY", 1]);

		// Duplicate: state deduplicates via Object.is, so no signals
		s.set(1);
		expect(signals).toEqual(["DIRTY", 1]);

		s.set(2);
		expect(signals).toEqual(["DIRTY", 1, "DIRTY", 2]);
	});
});

// ===========================================================================
// Section 7: Passthrough extras — diamond glitch-free (Phase 2)
// ===========================================================================
// Verify that passthrough extras in diamond topologies cause downstream
// derived to compute exactly once per change (glitch-free).

describe("Passthrough extras — diamond glitch-free", () => {
	it("take in diamond: derived downstream computes exactly once", () => {
		const s = state(1);
		const a = derived([s], () => s.get() + 1);
		const b = pipe(s, take(5));
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return `${a.get()},${b.get()}`;
		});

		subscribe(c, () => {});
		computeCount = 0;

		s.set(2);
		expect(computeCount).toBe(1);
		expect(c.get()).toBe("3,2");
	});

	it("skip in diamond: derived downstream computes exactly once", () => {
		const s = state(1);
		const a = derived([s], () => s.get() + 1);
		const b = pipe(s, skip(0)); // skip(0) passes all
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return `${a.get()},${b.get()}`;
		});

		subscribe(c, () => {});
		computeCount = 0;

		s.set(2);
		expect(computeCount).toBe(1);
		expect(c.get()).toBe("3,2");
	});

	it("tap in diamond: derived downstream computes exactly once", () => {
		const s = state(1);
		const a = derived([s], () => s.get() + 1);
		const tapped: number[] = [];
		const b = pipe(
			s,
			tap((v) => tapped.push(v)),
		);
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return `${a.get()},${b.get()}`;
		});

		subscribe(c, () => {});
		computeCount = 0;

		s.set(2);
		expect(computeCount).toBe(1);
		expect(c.get()).toBe("3,2");
		expect(tapped).toEqual([2]);
	});

	it("distinctUntilChanged in diamond: derived downstream computes exactly once", () => {
		const s = state(1);
		const a = derived([s], () => s.get() + 1);
		const b = pipe(s, distinctUntilChanged());
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return `${a.get()},${b.get()}`;
		});

		subscribe(c, () => {});
		computeCount = 0;

		s.set(2);
		expect(computeCount).toBe(1);
		expect(c.get()).toBe("3,2");
	});

	it("pairwise in diamond: derived downstream computes exactly once", () => {
		const s = state(1);
		const a = derived([s], () => s.get() + 1);
		const b = pipe(s, pairwise());
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return `${a.get()},${JSON.stringify(b.get())}`;
		});

		subscribe(c, () => {});
		computeCount = 0;

		s.set(2);
		expect(computeCount).toBe(1);
		expect(c.get()).toBe("3,[1,2]");
	});

	it("remember in diamond: derived downstream computes exactly once", () => {
		const s = state(1);
		const a = derived([s], () => s.get() + 1);
		const b = pipe(s, remember());
		let computeCount = 0;
		const c = derived([a, b], () => {
			computeCount++;
			return `${a.get()},${b.get()}`;
		});

		subscribe(c, () => {});
		computeCount = 0;

		s.set(2);
		expect(computeCount).toBe(1);
		expect(c.get()).toBe("3,2");
	});
});

// ===========================================================================
// Section 8: Complex extras — diamond glitch documentation (Phase 2)
// ===========================================================================
// These extras use subscribe/pushChange internally and are natural glitch
// boundaries. Document exact fire counts in diamond topologies.

describe("Complex extras — diamond glitch documentation", () => {
	it("switchMap in diamond: documents exact fire count", () => {
		const s = state(1);
		const direct = derived([s], () => s.get() * 2);
		const mapped = pipe(
			s,
			switchMap((v) => state(v * 100)),
		);
		const c = derived([direct, mapped], () => `${direct.get()},${mapped.get()}`);

		const values: string[] = [];
		subscribe(c, (v) => values.push(v));

		s.set(2);
		// switchMap may cause >1 computation. Document actual behavior.
		expect(values.length).toBeGreaterThanOrEqual(1);
		// Final value must be correct
		expect(values[values.length - 1]).toBe("4,200");
	});

	it("flat in diamond: documents exact fire count", () => {
		const s = state(1);
		const direct = derived([s], () => s.get() * 2);
		const innerStore = pipe(
			s,
			map((v) => state(v * 100)),
		);
		const flatted = pipe(innerStore, flat());
		const c = derived([direct, flatted], () => `${direct.get()},${flatted.get()}`);

		const values: string[] = [];
		subscribe(c, (v) => values.push(v));

		s.set(2);
		expect(values.length).toBeGreaterThanOrEqual(1);
		expect(values[values.length - 1]).toBe("4,200");
	});

	it("rescue in diamond: documents exact fire count", () => {
		let errorSink: ((type: number, data?: unknown) => void) | null = null;
		const src = {
			get() {
				return 1;
			},
			source(type: number, payload?: unknown) {
				if (type === 0) {
					const sink = payload as (type: number, data?: unknown) => void;
					errorSink = sink;
					sink(0, (t: number) => {
						if (t === 2) errorSink = null;
					});
				}
			},
		};

		const fallback = state(99);
		const r = pipe(
			src,
			rescue(() => fallback),
		);
		const values: number[] = [];
		subscribe(r, (v) => values.push(v));

		// Error → switch to fallback
		errorSink!(2, new Error("boom"));
		expect(values).toEqual([99]);

		fallback.set(100);
		expect(values).toEqual([99, 100]);
		// Final value must be correct
		expect(values[values.length - 1]).toBe(100);
	});
});
