import { beforeEach, describe, expect, it } from "vitest";
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
import { Inspector, pipe, producer, state } from "../../index";
import { DIRTY, END, RESOLVED, START, STATE } from "../../protocol";

beforeEach(() => {
	Inspector._reset();
});

// ---------------------------------------------------------------------------
// of
// ---------------------------------------------------------------------------

describe("of", () => {
	it("emits all values synchronously then completes", () => {
		const values: number[] = [];
		let ended = false;
		const s = of(1, 2, 3);

		s.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) ended = true;
		});

		expect(values).toEqual([1, 2, 3]);
		expect(ended).toBe(true);
	});

	it("get() returns last emitted value after subscription", () => {
		const s = of(10, 20, 30);
		s.source(START, () => {});
		expect(s.get()).toBe(30);
	});

	it("emits single value", () => {
		const values: string[] = [];
		const s = of("hello");
		s.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
		});
		expect(values).toEqual(["hello"]);
	});

	it("completes immediately with no values when called with no args", () => {
		let ended = false;
		const values: unknown[] = [];
		const s = of();
		s.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) ended = true;
		});
		expect(values).toEqual([]);
		expect(ended).toBe(true);
	});

	it("new subscriber after completion receives END immediately", () => {
		const s = of(1);
		s.source(START, () => {}); // first subscriber triggers completion

		let gotEnd = false;
		s.source(START, (type: number) => {
			if (type === END) gotEnd = true;
		});
		expect(gotEnd).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// empty
// ---------------------------------------------------------------------------

describe("empty", () => {
	it("completes immediately without emitting any values", () => {
		const values: unknown[] = [];
		let ended = false;
		const s = empty();

		s.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) ended = true;
		});

		expect(values).toEqual([]);
		expect(ended).toBe(true);
	});

	it("get() returns undefined", () => {
		const s = empty();
		expect(s.get()).toBeUndefined();
	});

	it("new subscriber after completion receives END immediately", () => {
		const s = empty();
		s.source(START, () => {});

		let gotEnd = false;
		s.source(START, (type: number) => {
			if (type === END) gotEnd = true;
		});
		expect(gotEnd).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// throwError
// ---------------------------------------------------------------------------

describe("throwError", () => {
	it("errors immediately with the given value", () => {
		let errorData: unknown;
		let ended = false;
		const s = throwError(new Error("boom"));

		s.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === END) {
				ended = true;
				errorData = data;
			}
		});

		expect(ended).toBe(true);
		expect(errorData).toBeInstanceOf(Error);
		expect((errorData as Error).message).toBe("boom");
	});

	it("emits no values before erroring", () => {
		const values: unknown[] = [];
		const s = throwError("fail");

		s.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
		});

		expect(values).toEqual([]);
	});

	it("get() returns undefined", () => {
		const s = throwError("fail");
		expect(s.get()).toBeUndefined();
	});

	it("new subscriber after error receives END immediately", () => {
		const s = throwError("oops");
		s.source(START, () => {});

		let gotEnd = false;
		s.source(START, (type: number) => {
			if (type === END) gotEnd = true;
		});
		expect(gotEnd).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// never
// ---------------------------------------------------------------------------

describe("never", () => {
	it("never emits, errors, or completes", () => {
		const values: unknown[] = [];
		let ended = false;
		const s = never();

		s.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) ended = true;
		});

		expect(values).toEqual([]);
		expect(ended).toBe(false);
	});

	it("get() returns undefined", () => {
		const s = never();
		expect(s.get()).toBeUndefined();
	});

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
		const values: number[] = [];
		let ended = false;

		f.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) ended = true;
		});

		s.set(2);
		s.set(3);

		// first() should emit only the first change (2), then complete
		expect(values).toEqual([2]);
		expect(ended).toBe(true);
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

		let gotEnd = false;
		f.source(START, (type: number) => {
			if (type === END) gotEnd = true;
		});
		expect(gotEnd).toBe(true);
	});

	it("works with fromIter source", () => {
		const s = fromIter([10, 20, 30]);
		const f = pipe(s, first());
		const values: number[] = [];

		f.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
		});

		expect(values).toEqual([10]);
	});

	it("completes if upstream completes without emitting", () => {
		const s = empty();
		const f = pipe(s, first());
		let ended = false;

		f.source(START, (type: number) => {
			if (type === START) return;
			if (type === END) ended = true;
		});

		expect(ended).toBe(true);
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
		const values: number[] = [];

		l.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
		});

		expect(values).toEqual([3]);
	});

	it("get() returns last value after completion", () => {
		const s = fromIter([10, 20, 30]);
		const l = pipe(s, last());
		l.source(START, () => {});

		expect(l.get()).toBe(30);
	});

	it("completes with END when upstream completes without values", () => {
		const s = empty();
		const l = pipe(s, last());
		let ended = false;
		const values: unknown[] = [];

		l.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) ended = true;
		});

		expect(values).toEqual([]);
		expect(ended).toBe(true);
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
		const values: number[] = [];

		l.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
		});

		expect(values).toEqual([15]);
	});

	it("tears down upstream on unsubscribe before completion", () => {
		const s = state(0);
		const l = pipe(s, last());
		const unsub = subscribe(l, () => {});
		unsub(); // should not throw
	});

	it("new subscriber after completion receives END immediately", () => {
		const s = fromIter([1, 2]);
		const l = pipe(s, last());
		l.source(START, () => {}); // activate

		let gotEnd = false;
		l.source(START, (type: number) => {
			if (type === END) gotEnd = true;
		});
		expect(gotEnd).toBe(true);
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
		const values: number[] = [];
		let ended = false;

		f.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) ended = true;
		});

		expect(values).toEqual([4]);
		expect(ended).toBe(true);
	});

	it("get() returns matched value after completion", () => {
		const s = fromIter([1, 2, 3]);
		const f = pipe(
			s,
			find((v) => v === 2),
		);
		f.source(START, () => {});

		expect(f.get()).toBe(2);
	});

	it("completes without emitting if no match found", () => {
		const s = fromIter([1, 2, 3]);
		const f = pipe(
			s,
			find((v) => v > 10),
		);
		const values: unknown[] = [];
		let ended = false;

		f.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) ended = true;
		});

		expect(values).toEqual([]);
		expect(ended).toBe(true);
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
		f.source(START, () => {});

		let gotEnd = false;
		f.source(START, (type: number) => {
			if (type === END) gotEnd = true;
		});
		expect(gotEnd).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// elementAt
// ---------------------------------------------------------------------------

describe("elementAt", () => {
	it("emits value at index 0", () => {
		const s = fromIter([10, 20, 30]);
		const e = pipe(s, elementAt(0));
		const values: number[] = [];

		e.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
		});

		expect(values).toEqual([10]);
	});

	it("emits value at index 2", () => {
		const s = fromIter([10, 20, 30]);
		const e = pipe(s, elementAt(2));
		const values: number[] = [];
		let ended = false;

		e.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) ended = true;
		});

		expect(values).toEqual([30]);
		expect(ended).toBe(true);
	});

	it("completes without emitting if index is out of range", () => {
		const s = fromIter([1, 2]);
		const e = pipe(s, elementAt(5));
		const values: unknown[] = [];
		let ended = false;

		e.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) ended = true;
		});

		expect(values).toEqual([]);
		expect(ended).toBe(true);
		expect(e.get()).toBeUndefined();
	});

	it("get() returns the value at the given index", () => {
		const s = fromIter(["a", "b", "c"]);
		const e = pipe(s, elementAt(1));
		e.source(START, () => {});

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
		e.source(START, () => {});

		let gotEnd = false;
		e.source(START, (type: number) => {
			if (type === END) gotEnd = true;
		});
		expect(gotEnd).toBe(true);
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

		unsub1();
		unsub2();
		// should not throw — upstream is disconnected
	});

	it("keeps upstream alive if one branch still has sinks", () => {
		const s = state(0);
		const [evens, odds] = partition<number>((v) => v % 2 === 0)(s);
		const evenValues: number[] = [];
		subscribe(evens, (v) => evenValues.push(v));
		const unsubOdds = subscribe(odds, () => {});

		unsubOdds(); // remove odds subscriber
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
		let trueEnded = false;
		let falseEnded = false;

		trues.source(START, (type: number) => {
			if (type === END) trueEnded = true;
		});
		falses.source(START, (type: number) => {
			if (type === END) falseEnded = true;
		});

		expect(trueEnded).toBe(true);
		expect(falseEnded).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// repeat
// ---------------------------------------------------------------------------

describe("repeat", () => {
	it("re-subscribes to source on completion", () => {
		const r = repeat(() => fromIter([1, 2]), 3);
		const values: number[] = [];

		r.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
		});

		expect(values).toEqual([1, 2, 1, 2, 1, 2]);
	});

	it("completes after specified number of subscriptions", () => {
		const r = repeat(() => fromIter([1]), 2);
		const values: number[] = [];
		let ended = false;

		r.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) ended = true;
		});

		expect(values).toEqual([1, 1]);
		expect(ended).toBe(true);
	});

	it("get() returns last emitted value from any round", () => {
		const r = repeat(() => fromIter([10, 20]), 2);
		r.source(START, () => {});

		expect(r.get()).toBe(20);
	});

	it("repeat with count=1 behaves like no repeat", () => {
		const r = repeat(() => fromIter([1, 2, 3]), 1);
		const values: number[] = [];

		r.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
		});

		expect(values).toEqual([1, 2, 3]);
	});

	it("handles empty source (repeats the completion)", () => {
		const r = repeat(() => empty(), 3);
		let ended = false;
		const values: unknown[] = [];

		r.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) ended = true;
		});

		expect(values).toEqual([]);
		expect(ended).toBe(true);
	});

	it("cleans up current subscription on unsubscribe", () => {
		const r = repeat(() => state(0));
		const unsub = subscribe(r, () => {});
		unsub(); // should not throw
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
		const values: number[] = [];

		r.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
		});

		expect(values).toEqual([1, 2, 3]);
		expect(callCount).toBe(3);
	});

	it("new subscriber after all repetitions receives END immediately", () => {
		const r = repeat(() => fromIter([1]), 1);
		r.source(START, () => {}); // activate — completes

		let gotEnd = false;
		r.source(START, (type: number) => {
			if (type === END) gotEnd = true;
		});
		expect(gotEnd).toBe(true);
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
		const values: number[] = [];
		let errorData: unknown;

		r.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) errorData = data;
		});

		// Should emit 1 then error — NOT retry
		expect(values).toEqual([1]);
		expect(errorData).toBeInstanceOf(Error);
		expect((errorData as Error).message).toBe("boom");
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

		r.source(START, () => {});

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
		const evenSignals: unknown[] = [];
		const oddSignals: unknown[] = [];

		evens.source(START, (type: number, data: any) => {
			if (type === STATE) evenSignals.push(data);
		});
		odds.source(START, (type: number, data: any) => {
			if (type === STATE) oddSignals.push(data);
		});

		s.set(2); // even — true branch gets DATA, false branch should get RESOLVED

		// Both branches got DIRTY, then:
		// - evens got DATA (via its sink)
		// - odds got RESOLVED (non-matching)
		expect(oddSignals).toContain(DIRTY);
		expect(oddSignals).toContain(RESOLVED);
	});

	it("late subscriber after upstream completion receives END", () => {
		const p = producer<number>(({ emit, complete }) => {
			emit(1);
			complete();
			return undefined;
		});

		const [trues, falses] = partition<number>((v) => v > 0)(p);
		// First activate both branches
		trues.source(START, () => {});
		falses.source(START, () => {});

		// Now try subscribing after completion
		let trueGotEnd = false;
		let falseGotEnd = false;
		trues.source(START, (type: number) => {
			if (type === END) trueGotEnd = true;
		});
		falses.source(START, (type: number) => {
			if (type === END) falseGotEnd = true;
		});

		expect(trueGotEnd).toBe(true);
		expect(falseGotEnd).toBe(true);
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
		const signals: unknown[] = [];

		f.source(START, (type: number, data: any) => {
			if (type === STATE) signals.push(data);
		});

		s.set(3); // non-matching — should get DIRTY then RESOLVED

		expect(signals).toContain(DIRTY);
		expect(signals).toContain(RESOLVED);
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
		const values: number[] = [];
		let errorData: unknown;

		l.source(START, (type: number, data: any) => {
			if (type === START) return;
			if (type === 1) values.push(data);
			if (type === END) errorData = data;
		});

		// Should NOT emit buffered value (10) — just forward the error
		expect(values).toEqual([]);
		expect(errorData).toBeInstanceOf(Error);
		expect((errorData as Error).message).toBe("fail");
	});
});
