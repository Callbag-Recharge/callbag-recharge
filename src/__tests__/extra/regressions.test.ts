import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { START } from "../../core/protocol";
import { combine } from "../../extra/combine";
import { concatMap } from "../../extra/concatMap";
import { debounce } from "../../extra/debounce";
import { distinctUntilChanged } from "../../extra/distinctUntilChanged";
import { exhaustMap } from "../../extra/exhaustMap";
import { filter } from "../../extra/filter";
import { flat } from "../../extra/flat";
import { map } from "../../extra/map";
import { pipeRaw, SKIP } from "../../extra/pipeRaw";
import { remember } from "../../extra/remember";
import { rescue } from "../../extra/rescue";
import { sample } from "../../extra/sample";
import { scan } from "../../extra/scan";
import { subject } from "../../extra/subject";
import { subscribe } from "../../extra/subscribe";
import { switchMap } from "../../extra/switchMap";
import { tap } from "../../extra/tap";
import { throttle } from "../../extra/throttle";
import { Inspector, pipe, producer, state } from "../../index";
import { retry } from "../../utils/retry";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ===========================================================================
// Regression tests for issues discovered during operator() refactor
// ===========================================================================

// Helper: observe raw DATA emissions at callbag protocol level, bypassing
// subscribe()'s Object.is dedup. This is essential for verifying tier-2
// extras don't add their own dedup layer.
function observeRaw<T>(store: { source: (type: number, payload?: any) => void }) {
	const data: T[] = [];
	store.source(START, (type: number, d: any) => {
		if (type === START) return;
		if (type === 1) data.push(d);
	});
	return data;
}

// ---------------------------------------------------------------------------
// 1. Tier-2 extras must NOT dedup (removed equals: Object.is)
//    These operators are cycle boundaries — every emit must propagate.
//    Tests observe raw DATA at the callbag level to bypass subscribe's dedup.
// ---------------------------------------------------------------------------

describe("tier-2: no built-in dedup", () => {
	it("debounce: same output value from different inputs is not suppressed", () => {
		// debounce internally uses subscribe() which deduplicates input values.
		// This test verifies the output producer does not add ANOTHER dedup layer.
		// Sequence: emit(1) → timer → output=1, emit(2) → emit(1) → timer → output=1
		const s = producer<number>();
		const d = pipe(s, debounce(50));
		const data = observeRaw<number>(d);

		s.emit(1);
		vi.advanceTimersByTime(50); // output: 1

		s.emit(2); // resets timer
		vi.advanceTimersByTime(10);
		s.emit(1); // resets timer again (subscribe sees 2→1, not deduped)
		vi.advanceTimersByTime(50); // output: 1 again — must not be suppressed

		expect(data).toEqual([1, 1]);
	});

	it("throttle: same output value from different inputs is not suppressed", () => {
		const s = producer<number>();
		const t = pipe(s, throttle(50));
		const data = observeRaw<number>(t);

		s.emit(1); // passes — first in window
		vi.advanceTimersByTime(50); // window expires

		s.emit(2); // passes — first in new window (output: 2)
		vi.advanceTimersByTime(50);

		s.emit(1); // passes — first in new window (same as first output, must not dedup)

		expect(data).toEqual([1, 2, 1]);
	});

	it("sample: emits same latestInput when notifier fires twice", () => {
		const s = producer<number>();
		const notifier = state(0);
		const sampled = pipe(s, sample(notifier));
		const data = observeRaw<number>(sampled);

		s.emit(5);
		notifier.set(1); // emit latestInput=5
		notifier.set(2); // emit latestInput=5 again

		expect(data).toEqual([5, 5]);
	});

	it("switchMap: re-switch to inner with same value emits at protocol level", () => {
		const outer = state("a");
		const innerA = state(10);
		const innerB = state(10); // same value
		const mapped = pipe(
			outer,
			switchMap((v) => (v === "a" ? innerA : innerB)),
		);
		const data = observeRaw<number | undefined>(mapped);

		outer.set("b"); // switch to innerB (get()=10) — must emit even though same

		expect(data).toContain(10);
	});

	it("flat: switch to new inner with same value emits at protocol level", () => {
		const inner1 = state(5);
		const inner2 = state(5); // same value
		const outer = state<ReturnType<typeof state<number>>>(inner1);
		const f = pipe(outer, flat());
		const data = observeRaw<number | undefined>(f);

		outer.set(inner2); // switch — emit(inner2.get()=5)

		expect(data).toContain(5);
	});

	it("rescue: fallback with same initial value as src emits at protocol level", () => {
		let errorSink: ((type: number, data?: unknown) => void) | null = null;
		const src = {
			get() {
				return 42;
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

		const fallback = state(42); // same value as src
		const r = pipe(
			src,
			rescue(() => fallback),
		);
		const data = observeRaw<number>(r);

		// Error on src → switch to fallback which has same value 42
		errorSink?.(2, new Error("boom"));

		// rescue must emit 42 from fallback even though src had 42
		expect(data).toContain(42);
	});

	it("retry: reconnect emits same value at protocol level", () => {
		let errorSink: ((type: number, data?: unknown) => void) | null = null;
		let connectCount = 0;
		const src = {
			get() {
				return 10;
			},
			source(type: number, payload?: unknown) {
				if (type === 0) {
					connectCount++;
					const sink = payload as (type: number, data?: unknown) => void;
					errorSink = sink;
					sink(0, (t: number) => {
						if (t === 2) errorSink = null;
					});
				}
			},
		};

		const r = pipe(src, retry(2));
		const data = observeRaw<number>(r);

		// Initial connect: skipped (producer's { initial } already has the value).
		// Error → retry reconnects, calls emit(src.get()) = emit(10).
		errorSink?.(2, new Error("fail"));

		expect(connectCount).toBe(2);
		expect(data.filter((v) => v === 10).length).toBeGreaterThanOrEqual(1);
	});

	it("concatMap: sequential inners with same value both emit", () => {
		const outer = state("");
		const innerA = producer<number>(({ emit }) => {
			emit(42);
		});
		const innerB = state(42);

		const mapped = pipe(
			outer,
			concatMap((v) => (v === "a" ? innerA : innerB)),
		);
		const data = observeRaw<number | undefined>(mapped);

		// Trigger outer emission to create initial inner
		outer.set("a");
		outer.set("b");
		innerA.complete(); // innerA completes → process "b" → innerB emits 42

		expect(data.filter((v) => v === 42).length).toBeGreaterThanOrEqual(2);
	});

	it("exhaustMap: sequential inners with same value both emit", () => {
		const outer = state(-1);
		const innerA = producer<number>(({ emit }) => {
			emit(42);
		});
		const innerB = state(42);

		const mapped = pipe(
			outer,
			exhaustMap((v) => (v === 0 ? innerA : innerB)),
		);
		const data = observeRaw<number | undefined>(mapped);

		// Trigger outer emission to create initial inner
		outer.set(0);
		innerA.complete();
		outer.set(1); // now accepted → innerB emits 42

		expect(data.filter((v) => v === 42).length).toBeGreaterThanOrEqual(2);
	});
});

// ---------------------------------------------------------------------------
// 2. Pull-based get() when disconnected — operator getter
//    scan, filter, pipeRaw must return correct values without a subscriber
// ---------------------------------------------------------------------------

describe("pull-based get() without subscriber", () => {
	it("scan: get() applies reducer without subscriber", () => {
		const s = state(1);
		const scanned = pipe(
			s,
			scan((acc, v) => acc + v, 0),
		);

		// No subscriber — pull-based getter
		expect(scanned.get()).toBe(1); // 0 + 1

		s.set(2);
		expect(scanned.get()).toBe(3); // 1 + 2
	});

	it("scan: get() is idempotent — no double-apply on repeated calls", () => {
		const s = state(1);
		const scanned = pipe(
			s,
			scan((acc, v) => acc + v, 0),
		);

		expect(scanned.get()).toBe(1);
		expect(scanned.get()).toBe(1); // same input — must not re-apply reducer
		expect(scanned.get()).toBe(1);
	});

	it("filter: get() returns last passing value without subscriber", () => {
		const s = state(2);
		const filtered = pipe(
			s,
			filter((v: number) => v % 2 === 0),
		);

		expect(filtered.get()).toBe(2);
		s.set(3); // odd — filtered out
		expect(filtered.get()).toBe(2); // still returns last passing
		s.set(4);
		expect(filtered.get()).toBe(4);
	});

	it("pipeRaw: get() evaluates pipeline without subscriber", () => {
		const s = state(2);
		const piped = pipeRaw(s, (v: number) => v * 10);

		expect(piped.get()).toBe(20);
		s.set(3);
		expect(piped.get()).toBe(30);
	});

	it("pipeRaw: SKIP returns cached value on get()", () => {
		const s = state(2);
		const piped = pipeRaw(s, (v: number) => (v > 5 ? v : SKIP));

		expect(piped.get()).toBeUndefined(); // initial 2 < 5 → SKIP, no cache
		s.set(10);
		expect(piped.get()).toBe(10);
		s.set(3); // SKIP — returns cached 10
		expect(piped.get()).toBe(10);
	});

	it("map: get() maps without subscriber", () => {
		const s = state(3);
		const mapped = pipe(
			s,
			map((v: number) => v * 2),
		);

		expect(mapped.get()).toBe(6);
		s.set(5);
		expect(mapped.get()).toBe(10);
	});

	it("distinctUntilChanged: get() delegates to input when disconnected", () => {
		const s = state(1);
		const d = pipe(s, distinctUntilChanged());

		expect(d.get()).toBe(1);
		s.set(2);
		expect(d.get()).toBe(2);
	});

	it("combine: get() reads all deps when disconnected", () => {
		const a = state(1);
		const b = state(2);
		const c = combine(a, b);

		expect(c.get()).toEqual([1, 2]);
		a.set(10);
		expect(c.get()).toEqual([10, 2]);
	});

	it("tap: get() delegates to input when disconnected", () => {
		const s = state(42);
		const t = pipe(
			s,
			tap(() => {}),
		);

		expect(t.get()).toBe(42);
		s.set(99);
		expect(t.get()).toBe(99);
	});
});

// ---------------------------------------------------------------------------
// 3. remember: cache clearing on disconnect and re-reading on reconnect
// ---------------------------------------------------------------------------

describe("remember regression", () => {
	it("cache clears on teardown (resetOnTeardown)", () => {
		const s = producer<number>();
		const r = pipe(s, remember());
		const unsub = subscribe(r, () => {});

		s.emit(42);
		expect(r.get()).toBe(42);

		unsub();
		expect(r.get()).toBeUndefined(); // must be cleared
	});

	it("re-reads input.get() on reconnect (seed in init)", () => {
		const s = producer<number>();
		const r = pipe(s, remember());

		// First subscription
		const unsub1 = subscribe(r, () => {});
		s.emit(42);
		unsub1();

		// Re-subscribe — producer retains 42, remember should re-seed
		subscribe(r, () => {});
		expect(r.get()).toBe(42);
	});
});

// ---------------------------------------------------------------------------
// 4. scan: getter resets tracking on reconnect — pull then push transition
// ---------------------------------------------------------------------------

describe("scan reconnect regression", () => {
	it("accumulator resets to seed on reconnect (rxjs semantics)", () => {
		const s = state(1);
		const scanned = pipe(
			s,
			scan((acc, v) => acc + v, 0),
		);

		// Pull mode (no subscriber): getter applies reducer
		expect(scanned.get()).toBe(1); // 0 + 1 = 1

		// Subscribe → push mode; acc resets to seed=0 on reconnect
		const values: number[] = [];
		const unsub = subscribe(scanned, (v) => values.push(v));
		s.set(2);
		// acc reset to 0 on subscribe, push receives 2 → reducer(0, 2) = 2
		expect(scanned.get()).toBe(2);
		unsub();

		// Pull mode again — acc retains push-mode value (2), getter applies reducer
		s.set(10);
		expect(scanned.get()).toBe(12); // 2 + 10 = 12
	});

	it("getter tracking resets on reconnect cycle", () => {
		const s = state(5);
		const scanned = pipe(
			s,
			scan((acc, v) => acc + v, 0),
		);

		// First pull
		expect(scanned.get()).toBe(5); // 0 + 5

		// Subscribe and unsub: acc resets to seed=0 on reconnect
		const unsub = subscribe(scanned, () => {});
		unsub();

		// After reconnect cycle, acc was reset to seed=0, getter re-applies: reducer(0, 5) = 5
		expect(scanned.get()).toBe(5);

		// Repeated get() without changes IS idempotent
		expect(scanned.get()).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// 5. combine: bitmask dirty tracking (idempotent for redundant DIRTY)
// ---------------------------------------------------------------------------

describe("combine bitmask regression", () => {
	it("handles diamond: two deps dirty from same source", () => {
		const s = state(1);
		const a = pipe(
			s,
			map((v: number) => v * 2),
		);
		const b = pipe(
			s,
			map((v: number) => v + 10),
		);
		const c = combine(a, b);
		const values: [number, number][] = [];
		subscribe(c, (v) => values.push(v as [number, number]));

		s.set(2);

		// Both deps change from same source — should emit once with both updated
		expect(values).toEqual([[4, 12]]);
	});

	it("redundant DIRTY on same dep does not cause extra emit", () => {
		const a = state(1);
		const b = state(2);
		const c = combine(a, b);
		const values: unknown[] = [];
		subscribe(c, (v) => values.push(v));

		a.set(10);
		b.set(20);

		// Each set is independent — two emits expected
		expect(values).toEqual([
			[10, 2],
			[10, 20],
		]);
	});
});

// ---------------------------------------------------------------------------
// 6. subject: conditional equality semantics
//    Subject deduplicates only when sinks are connected. This cannot be
//    expressed through producer's options (equals runs unconditionally).
// ---------------------------------------------------------------------------

describe("subject conditional dedup regression", () => {
	it("deduplicates when sinks are connected", () => {
		const s = subject<number>();
		const values: (number | undefined)[] = [];
		subscribe(s, (v) => values.push(v));

		s.next(1);
		s.next(1); // same — suppressed at subject level
		s.next(2);

		expect(values).toEqual([1, 2]);
	});

	it("always accepts value when no sinks connected", () => {
		const s = subject<number>();

		s.next(1);
		expect(s.get()).toBe(1);

		// Same value with no sinks — must still update (no dedup)
		s.next(1);
		expect(s.get()).toBe(1);

		// Different value
		s.next(2);
		expect(s.get()).toBe(2);
	});

	it("value set without sinks is visible to later subscriber", () => {
		const s = subject<number>();

		s.next(42);
		expect(s.get()).toBe(42);

		// Now subscribe — should see 42 via get()
		const values: (number | undefined)[] = [];
		subscribe(s, (v) => values.push(v));

		expect(s.get()).toBe(42);

		// Setting same value with sinks — deduplicates at subject level
		s.next(42);
		expect(values).toEqual([]); // suppressed
	});

	it("next() with same value after disconnect-reconnect cycle is NOT suppressed", () => {
		const s = subject<number>();

		// Connect, set, disconnect
		const unsub = subscribe(s, () => {});
		s.next(5);
		unsub();

		// Set same value while disconnected — always accepted (no sinks = no dedup)
		s.next(5);
		expect(s.get()).toBe(5);

		// Reconnect
		const values: (number | undefined)[] = [];
		subscribe(s, (v) => values.push(v));

		// Now next(5) again with sinks — dedup kicks in
		s.next(5);
		expect(values).toEqual([]);

		// Different value goes through
		s.next(6);
		expect(values).toEqual([6]);
	});

	it("dedup at protocol level: same value suppresses DIRTY+DATA", () => {
		// Verify subject dedup prevents DIRTY/DATA signals entirely
		const s = subject<number>();
		const signals: Array<{ type: number; data: any }> = [];
		s.source(START, (type: number, data?: any) => {
			if (type === START) return;
			signals.push({ type, data });
		});

		s.next(1);
		const countAfterFirst = signals.length;
		s.next(1); // same value with sinks — should produce NO signals

		expect(signals.length).toBe(countAfterFirst);
	});
});

// ---------------------------------------------------------------------------
// 7. seed() vs emit() — seed sets value without firing DATA
// ---------------------------------------------------------------------------

describe("operator seed regression", () => {
	it("remember uses seed to avoid DATA during init", () => {
		const s = state(42);
		const r = pipe(s, remember());

		// This should not throw — seed() sets value without pushing DATA.
		// The old bug: emit() during init fired DATA before subscribe.ts
		// set its `prev` variable → "Cannot access 'prev' before initialization"
		const values: (number | undefined)[] = [];
		subscribe(r, (v) => values.push(v));

		expect(r.get()).toBe(42);
		s.set(99);
		expect(values).toEqual([99]);
	});

	it("seed does not fire DATA to sinks", () => {
		// Directly verify seed behavior: operator with seed in init should
		// not push DATA during initialization
		const s = state(10);
		const op = pipe(s, remember());
		const data = observeRaw(op);

		// After connecting, remember seed(input.get()) runs but should not
		// appear as DATA emission
		expect(data).toEqual([]);
		expect(op.get()).toBe(10);
	});
});
