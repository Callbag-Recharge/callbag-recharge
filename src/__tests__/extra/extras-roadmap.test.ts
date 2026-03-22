import { beforeEach, describe, expect, it } from "vitest";
import { DIRTY, END, RESOLVED, START } from "../../core/protocol";
import { elementAt } from "../../extra/elementAt";
import { empty } from "../../extra/empty";
import { find } from "../../extra/find";
import { first } from "../../extra/first";
import { fromIter } from "../../extra/fromIter";
import { last } from "../../extra/last";
import { never } from "../../extra/never";
import { of } from "../../extra/of";
import { partition } from "../../extra/partition";
import { repeat } from "../../extra/repeat";
import { subscribe } from "../../extra/subscribe";
import { throwError } from "../../extra/throwError";
import { batch, Inspector, pipe, producer, state } from "../../index";

beforeEach(() => {
	Inspector._reset();
});

// ---------------------------------------------------------------------------
// of
// ---------------------------------------------------------------------------

describe("of", () => {
	it("emits all values synchronously then completes", () => {
		const s = of(1, 2, 3);
		const obs = Inspector.observe(s);

		expect(obs.values).toEqual([1, 2, 3]);
		expect(obs.ended).toBe(true);
	});

	it("get() returns last emitted value after subscription", () => {
		const s = of(10, 20, 30);
		Inspector.activate(s);
		expect(s.get()).toBe(30);
	});

	it("emits single value", () => {
		const s = of("hello");
		const obs = Inspector.observe(s);
		expect(obs.values).toEqual(["hello"]);
	});

	it("completes immediately with no values when called with no args", () => {
		const s = of();
		const obs = Inspector.observe(s);
		expect(obs.values).toEqual([]);
		expect(obs.ended).toBe(true);
	});

	it("new subscriber after completion receives END immediately", () => {
		const s = of(1);
		Inspector.activate(s); // first subscriber triggers completion

		const obs2 = Inspector.observe(s);
		expect(obs2.ended).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// empty
// ---------------------------------------------------------------------------

describe("empty", () => {
	it("completes immediately without emitting any values", () => {
		const s = empty();
		const obs = Inspector.observe(s);

		expect(obs.values).toEqual([]);
		expect(obs.ended).toBe(true);
	});

	it("get() returns undefined", () => {
		const s = empty();
		expect(s.get()).toBeUndefined();
	});

	it("new subscriber after completion receives END immediately", () => {
		const s = empty();
		Inspector.activate(s);

		const obs2 = Inspector.observe(s);
		expect(obs2.ended).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// throwError
// ---------------------------------------------------------------------------

describe("throwError", () => {
	it("errors immediately with the given value", () => {
		const s = throwError(new Error("boom"));
		const obs = Inspector.observe(s);

		expect(obs.errored).toBe(true);
		expect(obs.endError).toBeInstanceOf(Error);
		expect((obs.endError as Error).message).toBe("boom");
	});

	it("emits no values before erroring", () => {
		const s = throwError("fail");
		const obs = Inspector.observe(s);

		expect(obs.values).toEqual([]);
	});

	it("get() returns undefined", () => {
		const s = throwError("fail");
		expect(s.get()).toBeUndefined();
	});

	it("new subscriber after error receives END immediately", () => {
		const s = throwError("oops");
		Inspector.activate(s);

		const obs2 = Inspector.observe(s);
		expect(obs2.ended).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// never
// ---------------------------------------------------------------------------

describe("never", () => {
	it("never emits, errors, or completes", () => {
		const s = never();
		const obs = Inspector.observe(s);

		expect(obs.values).toEqual([]);
		expect(obs.ended).toBe(false);
	});

	it("get() returns undefined", () => {
		const s = never();
		expect(s.get()).toBeUndefined();
	});

	// Raw sink acceptable: testing callbag protocol talkback handshake
	it("can be unsubscribed without error", () => {
		const s = never();
		let talkback: any;

		s.source(START, (type: number, data: any) => {
			if (type === START) talkback = data;
		});

		expect(() => talkback(END)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// first
// ---------------------------------------------------------------------------

describe("first", () => {
	it("emits only the first value then completes", () => {
		const s = state(1);
		const f = pipe(s, first());
		const obs = Inspector.observe(f);

		s.set(2);
		s.set(3);

		// first() should emit only the first change (2), then complete
		expect(obs.values).toEqual([2]);
		expect(obs.ended).toBe(true);
	});

	it("get() returns first value after completion", () => {
		const s = state(10);
		const f = pipe(s, first());
		subscribe(f, () => {});

		s.set(20);
		expect(f.get()).toBe(20);

		s.set(30);
		expect(f.get()).toBe(20); // frozen
	});

	it("new subscriber after completion receives END immediately", () => {
		const s = state(0);
		const f = pipe(s, first());
		subscribe(f, () => {});
		s.set(1); // triggers first, completes

		const obs = Inspector.observe(f);
		expect(obs.ended).toBe(true);
	});

	it("works with fromIter source", () => {
		const s = fromIter([10, 20, 30]);
		const f = pipe(s, first());
		const obs = Inspector.observe(f);

		expect(obs.values).toEqual([10]);
	});

	it("completes if upstream completes without emitting", () => {
		const s = empty();
		const f = pipe(s, first());
		const obs = Inspector.observe(f);

		expect(obs.ended).toBe(true);
		expect(f.get()).toBeUndefined();
	});

	it("disconnects upstream after first value", () => {
		const s = state(0);
		const f = pipe(s, first());
		subscribe(f, () => {});

		s.set(1); // first value — should disconnect

		// Further changes should not affect anything
		s.set(2);
		s.set(3);
		expect(f.get()).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// last
// ---------------------------------------------------------------------------

describe("last", () => {
	it("emits only the final value when upstream completes", () => {
		const s = fromIter([1, 2, 3]);
		const l = pipe(s, last());
		const obs = Inspector.observe(l);

		expect(obs.values).toEqual([3]);
	});

	it("get() returns last value after completion", () => {
		const s = fromIter([10, 20, 30]);
		const l = pipe(s, last());
		Inspector.activate(l);

		expect(l.get()).toBe(30);
	});

	it("completes with END when upstream completes without values", () => {
		const s = empty();
		const l = pipe(s, last());
		const obs = Inspector.observe(l);

		expect(obs.values).toEqual([]);
		expect(obs.ended).toBe(true);
		expect(l.get()).toBeUndefined();
	});

	it("works with producer that emits then completes", () => {
		const p = producer<number>(({ emit, complete }) => {
			emit(5);
			emit(10);
			emit(15);
			complete();
			return undefined;
		});

		const l = pipe(p, last());
		const obs = Inspector.observe(l);

		expect(obs.values).toEqual([15]);
	});

	it("tears down upstream on unsubscribe before completion", () => {
		const s = state(0);
		const l = pipe(s, last());
		const unsub = subscribe(l, () => {});
		unsub.unsubscribe(); // should not throw
	});

	it("new subscriber after completion receives END immediately", () => {
		const s = fromIter([1, 2]);
		const l = pipe(s, last());
		Inspector.activate(l); // activate

		const obs2 = Inspector.observe(l);
		expect(obs2.ended).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// find
// ---------------------------------------------------------------------------

describe("find", () => {
	it("emits first value matching predicate then completes", () => {
		const s = fromIter([1, 2, 3, 4, 5]);
		const f = pipe(
			s,
			find((v) => v > 3),
		);
		const obs = Inspector.observe(f);

		expect(obs.values).toEqual([4]);
		expect(obs.ended).toBe(true);
	});

	it("get() returns matched value after completion", () => {
		const s = fromIter([1, 2, 3]);
		const f = pipe(
			s,
			find((v) => v === 2),
		);
		Inspector.activate(f);

		expect(f.get()).toBe(2);
	});

	it("completes without emitting if no match found", () => {
		const s = fromIter([1, 2, 3]);
		const f = pipe(
			s,
			find((v) => v > 10),
		);
		const obs = Inspector.observe(f);

		expect(obs.values).toEqual([]);
		expect(obs.ended).toBe(true);
		expect(f.get()).toBeUndefined();
	});

	it("works with state source", () => {
		const s = state(0);
		const f = pipe(
			s,
			find((v) => v > 5),
		);
		const values: number[] = [];
		subscribe(f, (v) => values.push(v));

		s.set(3); // no match
		s.set(6); // match — should emit and complete
		s.set(10); // should be ignored

		expect(values).toEqual([6]);
		expect(f.get()).toBe(6);
	});

	it("disconnects upstream after finding match", () => {
		const s = state(0);
		const f = pipe(
			s,
			find((v) => v === 5),
		);
		subscribe(f, () => {});

		s.set(5); // match — disconnect
		s.set(10); // should not affect

		expect(f.get()).toBe(5);
	});

	it("new subscriber after completion receives END immediately", () => {
		const s = fromIter([1, 2, 3]);
		const f = pipe(
			s,
			find((v) => v === 2),
		);
		Inspector.activate(f);

		const obs2 = Inspector.observe(f);
		expect(obs2.ended).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// elementAt
// ---------------------------------------------------------------------------

describe("elementAt", () => {
	it("emits value at index 0", () => {
		const s = fromIter([10, 20, 30]);
		const e = pipe(s, elementAt(0));
		const obs = Inspector.observe(e);

		expect(obs.values).toEqual([10]);
	});

	it("emits value at index 2", () => {
		const s = fromIter([10, 20, 30]);
		const e = pipe(s, elementAt(2));
		const obs = Inspector.observe(e);

		expect(obs.values).toEqual([30]);
		expect(obs.ended).toBe(true);
	});

	it("completes without emitting if index is out of range", () => {
		const s = fromIter([1, 2]);
		const e = pipe(s, elementAt(5));
		const obs = Inspector.observe(e);

		expect(obs.values).toEqual([]);
		expect(obs.ended).toBe(true);
		expect(e.get()).toBeUndefined();
	});

	it("get() returns the value at the given index", () => {
		const s = fromIter(["a", "b", "c"]);
		const e = pipe(s, elementAt(1));
		Inspector.activate(e);

		expect(e.get()).toBe("b");
	});

	it("works with state source", () => {
		const s = state(0);
		const e = pipe(s, elementAt(2));
		const values: number[] = [];
		subscribe(e, (v) => values.push(v));

		s.set(1); // index 0
		s.set(2); // index 1
		s.set(3); // index 2 — should emit and complete
		s.set(4); // ignored

		expect(values).toEqual([3]);
		expect(e.get()).toBe(3);
	});

	it("disconnects upstream after reaching target index", () => {
		const s = state(0);
		const e = pipe(s, elementAt(1));
		subscribe(e, () => {});

		s.set(1); // index 0
		s.set(2); // index 1 — emit and disconnect
		s.set(3); // should not affect

		expect(e.get()).toBe(2);
	});

	it("new subscriber after completion receives END immediately", () => {
		const s = fromIter([1, 2, 3]);
		const e = pipe(s, elementAt(0));
		Inspector.activate(e);

		const obs2 = Inspector.observe(e);
		expect(obs2.ended).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// partition
// ---------------------------------------------------------------------------

describe("partition", () => {
	it("splits values based on predicate", () => {
		const s = state(0);
		const [evens, odds] = partition<number>((v) => v % 2 === 0)(s);
		const evenValues: number[] = [];
		const oddValues: number[] = [];
		subscribe(evens, (v) => evenValues.push(v));
		subscribe(odds, (v) => oddValues.push(v));

		s.set(1);
		s.set(2);
		s.set(3);
		s.set(4);

		expect(evenValues).toEqual([2, 4]);
		expect(oddValues).toEqual([1, 3]);
	});

	it("get() returns last value for each branch", () => {
		const s = state(0);
		const [evens, odds] = partition<number>((v) => v % 2 === 0)(s);
		subscribe(evens, () => {});
		subscribe(odds, () => {});

		s.set(1);
		expect(odds.get()).toBe(1);
		expect(evens.get()).toBeUndefined();

		s.set(2);
		expect(evens.get()).toBe(2);
		expect(odds.get()).toBe(1);
	});

	it("shares a single upstream subscription", () => {
		let startCount = 0;
		const s = producer<number>(({ emit }) => {
			startCount++;
			emit(1);
			return undefined;
		});

		const [a, b] = partition<number>((v) => v > 0)(s);
		subscribe(a, () => {});
		subscribe(b, () => {});

		// partition should only connect once to upstream
		expect(startCount).toBe(1);
	});

	it("disconnects upstream when both branches unsubscribe", () => {
		const s = state(0);
		const [evens, odds] = partition<number>((v) => v % 2 === 0)(s);
		const unsub1 = subscribe(evens, () => {});
		const unsub2 = subscribe(odds, () => {});

		unsub1.unsubscribe();
		unsub2.unsubscribe();
		// should not throw — upstream is disconnected
	});

	it("keeps upstream alive if one branch still has sinks", () => {
		const s = state(0);
		const [evens, odds] = partition<number>((v) => v % 2 === 0)(s);
		const evenValues: number[] = [];
		subscribe(evens, (v) => evenValues.push(v));
		const unsubOdds = subscribe(odds, () => {});

		unsubOdds.unsubscribe(); // remove odds subscriber
		s.set(2); // evens should still receive

		expect(evenValues).toEqual([2]);
	});

	it("propagates END to both branches", () => {
		const p = producer<number>(({ emit, complete }) => {
			emit(1);
			emit(2);
			complete();
			return undefined;
		});

		const [trues, falses] = partition<number>((v) => v > 1)(p);
		const obsTrue = Inspector.observe(trues);
		const obsFalse = Inspector.observe(falses);

		expect(obsTrue.ended).toBe(true);
		expect(obsFalse.ended).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// repeat
// ---------------------------------------------------------------------------

describe("repeat", () => {
	it("re-subscribes to source on completion", () => {
		const r = repeat(() => fromIter([1, 2]), 3);
		const obs = Inspector.observe(r);

		expect(obs.values).toEqual([1, 2, 1, 2, 1, 2]);
	});

	it("completes after specified number of subscriptions", () => {
		const r = repeat(() => fromIter([1]), 2);
		const obs = Inspector.observe(r);

		expect(obs.values).toEqual([1, 1]);
		expect(obs.ended).toBe(true);
	});

	it("get() returns last emitted value from any round", () => {
		const r = repeat(() => fromIter([10, 20]), 2);
		Inspector.activate(r);

		expect(r.get()).toBe(20);
	});

	it("repeat with count=1 behaves like no repeat", () => {
		const r = repeat(() => fromIter([1, 2, 3]), 1);
		const obs = Inspector.observe(r);

		expect(obs.values).toEqual([1, 2, 3]);
	});

	it("handles empty source (repeats the completion)", () => {
		const r = repeat(() => empty(), 3);
		const obs = Inspector.observe(r);

		expect(obs.values).toEqual([]);
		expect(obs.ended).toBe(true);
	});

	it("cleans up current subscription on unsubscribe", () => {
		const r = repeat(() => state(0));
		const unsub = subscribe(r, () => {});
		unsub.unsubscribe(); // should not throw
	});

	it("creates fresh source on each repetition via factory", () => {
		let callCount = 0;
		const r = repeat(
			() =>
				producer<number>(({ emit, complete }) => {
					callCount++;
					emit(callCount);
					complete();
					return undefined;
				}),
			3,
		);
		const obs = Inspector.observe(r);

		expect(obs.values).toEqual([1, 2, 3]);
		expect(callCount).toBe(3);
	});

	it("new subscriber after all repetitions receives END immediately", () => {
		const r = repeat(() => fromIter([1]), 1);
		Inspector.activate(r); // activate — completes

		const obs2 = Inspector.observe(r);
		expect(obs2.ended).toBe(true);
	});

	it("propagates upstream errors instead of retrying", () => {
		const r = repeat(
			() =>
				producer<number>(({ emit, error }) => {
					emit(1);
					error(new Error("boom"));
					return undefined;
				}),
			3,
		);
		const obs = Inspector.observe(r);

		// Should emit 1 then error — NOT retry
		expect(obs.values).toEqual([1]);
		expect(obs.endError).toBeInstanceOf(Error);
		expect((obs.endError as Error).message).toBe("boom");
	});

	it("does not stack overflow with infinite repeat of sync-completing source", () => {
		// repeat(factory) with no count + empty() would blow the stack without trampoline
		let iterations = 0;
		const r = repeat(() => {
			iterations++;
			// Stop after enough iterations to prove no stack overflow
			if (iterations > 10000) {
				// Return a source that never completes to break the loop
				return never();
			}
			return empty();
		});

		Inspector.activate(r);

		expect(iterations).toBeGreaterThan(10000);
	});
});

// ---------------------------------------------------------------------------
// Review fix: partition RESOLVED on non-matching branch
// ---------------------------------------------------------------------------

describe("partition (RESOLVED signals)", () => {
	it("sends RESOLVED to non-matching branch when DATA arrives", () => {
		const s = state(0);
		const [evens, odds] = partition<number>((v) => v % 2 === 0)(s);
		const obsEven = Inspector.observe(evens);
		const obsOdd = Inspector.observe(odds);

		s.set(2); // even — true branch gets DATA, false branch should get RESOLVED

		// Both branches got DIRTY, then:
		// - evens got DATA (via its sink)
		expect(obsEven.signals).toContain(DIRTY);
		expect(obsEven.values).toContain(2);
		// - odds got RESOLVED (non-matching)
		expect(obsOdd.signals).toContain(DIRTY);
		expect(obsOdd.signals).toContain(RESOLVED);
	});

	it("late subscriber after upstream completion receives END", () => {
		const p = producer<number>(({ emit, complete }) => {
			emit(1);
			complete();
			return undefined;
		});

		const [trues, falses] = partition<number>((v) => v > 0)(p);
		// First activate both branches
		Inspector.activate(trues);
		Inspector.activate(falses);

		// Now try subscribing after completion
		const obsTrue2 = Inspector.observe(trues);
		const obsFalse2 = Inspector.observe(falses);

		expect(obsTrue2.ended).toBe(true);
		expect(obsFalse2.ended).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Review fix: find sends RESOLVED on non-matching DATA
// ---------------------------------------------------------------------------

describe("find (RESOLVED signals)", () => {
	it("sends RESOLVED on non-matching DATA", () => {
		const s = state(0);
		const f = pipe(
			s,
			find((v: number) => v > 5),
		);
		const obs = Inspector.observe(f);

		// Use batch() so DIRTY is dispatched (Skip DIRTY optimization
		// skips DIRTY for single-dep subscribers in unbatched paths)
		batch(() => s.set(3)); // non-matching — should get DIRTY then RESOLVED

		expect(obs.signals).toContain(DIRTY);
		expect(obs.signals).toContain(RESOLVED);
	});
});

// ---------------------------------------------------------------------------
// Review fix: last forwards errors without emitting buffered value
// ---------------------------------------------------------------------------

describe("last (error handling)", () => {
	it("forwards error without emitting buffered value", () => {
		const p = producer<number>(({ emit, error }) => {
			emit(5);
			emit(10);
			error(new Error("fail"));
			return undefined;
		});

		const l = pipe(p, last());
		const obs = Inspector.observe(l);

		// Should NOT emit buffered value (10) — just forward the error
		expect(obs.values).toEqual([]);
		expect(obs.endError).toBeInstanceOf(Error);
		expect((obs.endError as Error).message).toBe("fail");
	});
});
