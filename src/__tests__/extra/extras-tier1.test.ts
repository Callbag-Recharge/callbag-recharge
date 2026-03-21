import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { concatMap } from "../../extra/concatMap";
import { debounce } from "../../extra/debounce";
import { distinctUntilChanged } from "../../extra/distinctUntilChanged";
import { exhaustMap } from "../../extra/exhaustMap";
import { pairwise } from "../../extra/pairwise";
import { startWith } from "../../extra/startWith";
import { subscribe } from "../../extra/subscribe";
import { switchMap } from "../../extra/switchMap";
import { takeUntil } from "../../extra/takeUntil";
import { throttle } from "../../extra/throttle";
import { Inspector, pipe, producer, state } from "../../index";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// distinctUntilChanged
// ---------------------------------------------------------------------------

describe("distinctUntilChanged", () => {
	it("suppresses consecutive duplicate values", () => {
		const s = state(1);
		const d = pipe(s, distinctUntilChanged());
		const values: number[] = [];
		subscribe(d, (v) => values.push(v));

		s.set(1); // same
		s.set(2);
		s.set(2); // same
		s.set(3);

		expect(values).toEqual([2, 3]);
	});

	it("accepts a custom equality function", () => {
		const s = state({ x: 1 });
		const d = pipe(
			s,
			distinctUntilChanged((a, b) => a.x === b.x),
		);
		const values: { x: number }[] = [];
		subscribe(d, (v) => values.push(v));

		s.set({ x: 1 }); // equal by custom fn
		s.set({ x: 2 });

		expect(values).toEqual([{ x: 2 }]);
	});

	it("get() always reflects current value", () => {
		const s = state(5);
		const d = pipe(s, distinctUntilChanged());
		expect(d.get()).toBe(5);
		s.set(5);
		expect(d.get()).toBe(5);
		s.set(10);
		expect(d.get()).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// startWith
// ---------------------------------------------------------------------------

describe("startWith", () => {
	it("returns initial value when upstream is undefined", () => {
		const s = producer<number>();
		const d = pipe(s, startWith(42));
		expect(d.get()).toBe(42);
	});

	it("switches to upstream value once it emits", () => {
		const s = producer<number>();
		s.source(0, () => {});
		const d = pipe(s, startWith(0));

		expect(d.get()).toBe(0);

		s.emit(7);
		expect(d.get()).toBe(7);
	});

	it("passes through a non-undefined upstream value immediately", () => {
		const s = state(99);
		const d = pipe(s, startWith(0));
		expect(d.get()).toBe(99);
	});
});

// ---------------------------------------------------------------------------
// pairwise
// ---------------------------------------------------------------------------

describe("pairwise", () => {
	it("emits [prev, curr] after two observed values (rxjs semantics)", () => {
		const s = state(1);
		const p = pipe(s, pairwise());
		const pairs: [number, number][] = [];
		subscribe(p, (v) => {
			if (v) pairs.push(v);
		});

		s.set(2);
		s.set(3);

		// rxjs pairwise requires 2 observed emissions; first change buffers, second emits pair
		expect(pairs).toEqual([[2, 3]]);
	});

	it("get() returns undefined until two changes observed", () => {
		const s = state(10);
		const p = pipe(s, pairwise());
		// pairwise is stateful — it needs a sink to activate and track changes
		subscribe(p, () => {});
		expect(p.get()).toBeUndefined();
		s.set(20);
		// rxjs: first observed value is buffered, no pair yet
		expect(p.get()).toBeUndefined();
		s.set(30);
		expect(p.get()).toEqual([20, 30]);
	});

	it("first pair requires two observed changes (rxjs semantics)", () => {
		const s = state(5);
		const p = pipe(s, pairwise());
		const pairs: [number, number][] = [];
		subscribe(p, (v) => {
			if (v) pairs.push(v);
		});

		s.set(10);
		// rxjs: first observed value is buffered, no emission yet
		expect(pairs).toEqual([]);
		s.set(20);
		expect(pairs[0]).toEqual([10, 20]);
	});

	it("tears down upstream when last sink disconnects", () => {
		const s = state(0);
		const p = pipe(s, pairwise());
		const unsub = subscribe(p, () => {});
		unsub.unsubscribe();
		// no assertion needed — just must not throw
	});
});

// ---------------------------------------------------------------------------
// takeUntil
// ---------------------------------------------------------------------------

describe("takeUntil", () => {
	it("passes through values before notifier fires", () => {
		const s = state(0);
		const stop = state(false);
		const t = pipe(s, takeUntil(stop));
		const values: number[] = [];
		subscribe(t, (v) => values.push(v));

		s.set(1);
		s.set(2);
		expect(values).toEqual([1, 2]);
	});

	it("stops propagating after notifier fires", () => {
		const s = state(0);
		const stop = state(false);
		const t = pipe(s, takeUntil(stop));
		const values: number[] = [];
		subscribe(t, (v) => values.push(v));

		s.set(1);
		stop.set(true); // notifier fires
		s.set(2);
		s.set(3);

		expect(values).toEqual([1]);
	});

	it("new subscriber connecting after completion immediately receives END", () => {
		const s = state(42);
		const stop = state(false);
		const t = pipe(s, takeUntil(stop));
		subscribe(t, () => {}); // activate
		stop.set(true); // complete

		let gotStart = false;
		let gotEnd = false;
		t.source(0, (type: number) => {
			if (type === 0) gotStart = true;
			if (type === 2) gotEnd = true;
		});

		expect(gotStart).toBe(true);
		expect(gotEnd).toBe(true);
	});

	it("tears down upstream subscription when notifier fires", () => {
		const s = state(0);
		const stop = state(false);
		const t = pipe(s, takeUntil(stop));

		let sinkCallCount = 0;
		subscribe(t, () => sinkCallCount++);

		s.set(1);
		stop.set(true);
		s.set(2);
		s.set(3);

		expect(sinkCallCount).toBe(1);
	});

	it("get() returns frozen value after completion", () => {
		const s = state(42);
		const stop = state(false);
		const t = pipe(s, takeUntil(stop));
		// takeUntil is stateful — a sink must be connected so notifier tracking activates
		subscribe(t, () => {});

		stop.set(true);
		expect(t.get()).toBe(42);

		// Even after upstream changes
		s.set(99);
		expect(t.get()).toBe(42);
	});
});

// ---------------------------------------------------------------------------
// debounce
// ---------------------------------------------------------------------------

describe("debounce", () => {
	it("delays propagation by ms", () => {
		const s = state(0);
		const d = pipe(s, debounce(100));
		const values: number[] = [];
		subscribe(d, (v) => {
			if (v !== undefined) values.push(v);
		});

		s.set(1);
		expect(values).toEqual([]); // not yet

		vi.advanceTimersByTime(100);
		expect(values).toEqual([1]);
	});

	it("resets timer on rapid changes", () => {
		const s = state(0);
		const d = pipe(s, debounce(100));
		const values: number[] = [];
		subscribe(d, (v) => {
			if (v !== undefined) values.push(v);
		});

		s.set(1);
		vi.advanceTimersByTime(50);
		s.set(2);
		vi.advanceTimersByTime(50);
		// only 50ms since last change, should not have fired yet
		expect(values).toEqual([]);

		vi.advanceTimersByTime(50);
		expect(values).toEqual([2]);
	});

	it("clears pending timer on unsubscribe", () => {
		const s = state(0);
		const d = pipe(s, debounce(100));
		const values: number[] = [];
		const unsub = subscribe(d, (v) => {
			if (v !== undefined) values.push(v);
		});

		s.set(1);
		unsub.unsubscribe(); // unsubscribe before timer fires
		vi.advanceTimersByTime(200);

		expect(values).toEqual([]); // timer was cleared
	});
});

// ---------------------------------------------------------------------------
// throttle
// ---------------------------------------------------------------------------

describe("throttle", () => {
	it("passes first value immediately", () => {
		const s = state(0);
		const t = pipe(s, throttle(100));
		const values: number[] = [];
		subscribe(t, (v) => {
			if (v !== undefined) values.push(v);
		});

		s.set(1);
		expect(values).toEqual([1]);
	});

	it("ignores values within the throttle window", () => {
		const s = state(0);
		const t = pipe(s, throttle(100));
		const values: number[] = [];
		subscribe(t, (v) => {
			if (v !== undefined) values.push(v);
		});

		s.set(1);
		s.set(2);
		s.set(3);
		expect(values).toEqual([1]);
	});

	it("accepts the next value after the window expires", () => {
		const s = state(0);
		const t = pipe(s, throttle(100));
		const values: number[] = [];
		subscribe(t, (v) => {
			if (v !== undefined) values.push(v);
		});

		s.set(1);
		vi.advanceTimersByTime(100);
		s.set(2);
		expect(values).toEqual([1, 2]);
	});

	it("clears timer on unsubscribe", () => {
		const s = state(0);
		const t = pipe(s, throttle(100));
		const unsub = subscribe(t, () => {});
		s.set(1);
		unsub.unsubscribe();
		// must not throw, timer is cleared
	});

	it("throttle window resets correctly for back-to-back windows", () => {
		const s = state(0);
		const t = pipe(s, throttle(100));
		const values: number[] = [];
		subscribe(t, (v) => {
			if (v !== undefined) values.push(v);
		});

		s.set(1); // passes — first in window 1
		s.set(2); // throttled
		vi.advanceTimersByTime(100); // window 1 expires
		s.set(3); // passes — first in window 2
		s.set(4); // throttled
		vi.advanceTimersByTime(100); // window 2 expires

		expect(values).toEqual([1, 3]);
	});
});

// ---------------------------------------------------------------------------
// switchMap
// ---------------------------------------------------------------------------

describe("switchMap", () => {
	it("reflects the latest inner store's value", () => {
		const outer = state(0);
		const inner1 = state(10);
		const inner2 = state(20);

		const mapped = pipe(
			outer,
			switchMap((v) => (v === 1 ? inner1 : inner2)),
		);
		// switchMap is purely reactive — no inner until outer emits
		subscribe(mapped, () => {});

		// Before outer emits, no inner subscription exists
		expect(mapped.get()).toBeUndefined();

		// Trigger outer emission to create inner subscription
		outer.set(1);
		expect(mapped.get()).toBe(10);
		outer.set(2);
		expect(mapped.get()).toBe(20);
	});

	it("unsubscribes from previous inner on outer change", () => {
		const outer = state(0);
		const inner1 = state(10);
		const inner2 = state(20);

		const mapped = pipe(
			outer,
			switchMap((v) => (v === 1 ? inner1 : inner2)),
		);
		const values: (number | undefined)[] = [];
		subscribe(mapped, (v) => values.push(v));

		// Trigger outer emission to create initial inner subscription
		outer.set(1); // switches to inner1
		inner1.set(11); // should propagate (still subscribed to inner1)
		outer.set(2); // switches to inner2
		inner1.set(12); // should NOT propagate (unsubscribed from inner1)
		inner2.set(21);

		expect(values).toEqual([10, 11, 20, 21]);
	});

	it("tears down inner when last sink disconnects", () => {
		const outer = state("a");
		const inner = state(1);
		const mapped = pipe(
			outer,
			switchMap(() => inner),
		);
		const unsub = subscribe(mapped, () => {});
		unsub.unsubscribe();
		// must not throw
	});
});

// ---------------------------------------------------------------------------
// concatMap
// ---------------------------------------------------------------------------

describe("concatMap", () => {
	it("subscribes to inner when outer emits", () => {
		const outer = state(0);
		const inner = state(100);
		const mapped = pipe(
			outer,
			concatMap(() => inner),
		);
		subscribe(mapped, () => {}); // activate

		// Before outer emits, no inner subscription exists
		expect(mapped.get()).toBeUndefined();

		// Trigger outer emission
		outer.set(1);
		expect(mapped.get()).toBe(100);
	});

	it("queues outer values while inner is active", () => {
		const outer = state("");
		// inner stores that never complete — queue accumulates
		const innerA = state(1);
		const innerB = state(2);

		const mapped = pipe(
			outer,
			concatMap((v) => (v === "a" ? innerA : innerB)),
		);
		const values: (number | undefined)[] = [];
		subscribe(mapped, (v) => values.push(v));

		// Trigger outer emission to create initial inner
		outer.set("a"); // creates innerA subscription
		innerA.set(10);
		outer.set("b"); // queued — innerA still active (no END)
		innerB.set(20); // innerB not yet active

		expect(values).toEqual([1, 10]);
		expect(mapped.get()).toBe(10);
	});

	it("processes next queued value when inner completes", () => {
		const outer = state("");
		const innerA = producer<number>(({ emit }) => {
			emit(1);
		});
		const innerB = state(99);

		const mapped = pipe(
			outer,
			concatMap((v) => (v === "a" ? innerA : innerB)),
		);
		const values: (number | undefined)[] = [];
		subscribe(mapped, (v) => {
			if (v !== undefined) values.push(v);
		});

		// Trigger outer emission to create initial inner
		outer.set("a");
		outer.set("b"); // queued
		innerA.complete(); // innerA completes → process "b"

		expect(values).toEqual([1, 99]);
	});

	it("discards queue on unsubscribe", () => {
		const outer = state("a");
		const innerA = state(1);
		const mapped = pipe(
			outer,
			concatMap(() => innerA),
		);
		const unsub = subscribe(mapped, () => {});
		outer.set("b");
		unsub.unsubscribe(); // queue should be cleared, no throw
	});
});

// ---------------------------------------------------------------------------
// exhaustMap
// ---------------------------------------------------------------------------

describe("exhaustMap", () => {
	it("subscribes to inner when outer emits", () => {
		const outer = state("");
		const inner = state(42);
		const mapped = pipe(
			outer,
			exhaustMap(() => inner),
		);
		subscribe(mapped, () => {}); // activate

		// Before outer emits, no inner subscription
		expect(mapped.get()).toBeUndefined();

		// Trigger outer emission
		outer.set("x");
		expect(mapped.get()).toBe(42);
	});

	it("ignores new outer values while inner is active", () => {
		const outer = state("");
		const innerA = state(1);
		const innerB = state(2);

		const mapped = pipe(
			outer,
			exhaustMap((v) => (v === "a" ? innerA : innerB)),
		);
		const values: (number | undefined)[] = [];
		subscribe(mapped, (v) => values.push(v));

		// Trigger outer emission to create initial inner
		outer.set("a"); // creates innerA subscription
		innerA.set(10);
		outer.set("b"); // ignored — innerA still active
		innerB.set(20); // innerB is NOT active

		expect(values).toEqual([1, 10]);
	});

	it("accepts new outer value once inner completes", () => {
		const outer = state(-1);
		const innerA = producer<number>(({ emit }) => {
			emit(1);
		});
		const innerB = state(99);

		const mapped = pipe(
			outer,
			exhaustMap((v) => (v === 0 ? innerA : innerB)),
		);
		const values: (number | undefined)[] = [];
		subscribe(mapped, (v) => {
			if (v !== undefined) values.push(v);
		});

		// Trigger outer emission to create initial inner
		outer.set(0);
		outer.set(1); // ignored — innerA active
		innerA.complete(); // innerA completes → innerActive = false
		outer.set(2); // now accepted → innerB

		expect(values).toEqual([1, 99]);
	});

	it("tears down inner when last sink disconnects", () => {
		const outer = state("x");
		const inner = state(1);
		const mapped = pipe(
			outer,
			exhaustMap(() => inner),
		);
		const unsub = subscribe(mapped, () => {});
		unsub.unsubscribe();
		// must not throw
	});
});
