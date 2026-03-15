import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elementAt } from "../../extra/elementAt";
import { find } from "../../extra/find";
import { first } from "../../extra/first";
import { fromIter } from "../../extra/fromIter";
import { last } from "../../extra/last";
import { partition } from "../../extra/partition";
import { subscribe } from "../../extra/subscribe";
import { Inspector, pipe, producer, state } from "../../index";
import { END, START } from "../../protocol";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// first
// ---------------------------------------------------------------------------

describe("first", () => {
	it("emits first DATA then completes", () => {
		const s = state(0);
		const f = pipe(s, first());
		const values: number[] = [];
		let ended = false;
		subscribe(f, (v) => values.push(v as number), { onEnd: () => (ended = true) });

		s.set(1);
		s.set(2);
		s.set(3);

		expect(values).toEqual([1]);
		expect(ended).toBe(true);
	});

	it("get() returns undefined before first DATA, then captured value", () => {
		const p = producer<number>();
		const f = pipe(p, first());
		expect(f.get()).toBeUndefined();

		subscribe(f, () => {});
		p.emit(42);
		expect(f.get()).toBe(42);
	});

	it("upstream error is forwarded (not converted to completion)", () => {
		const p = producer<number>();
		const f = pipe(p, first());
		let endData: unknown = "not-called";
		subscribe(f, () => {}, { onEnd: (err) => (endData = err) });

		p.error("boom");

		expect(endData).toBe("boom");
	});

	it("upstream completes before emitting → clean complete with no DATA", () => {
		const p = producer<number>();
		const f = pipe(p, first());
		const values: unknown[] = [];
		let endData: unknown = "not-called";
		subscribe(f, (v) => values.push(v), { onEnd: (err) => (endData = err) });

		p.complete();

		expect(values).toEqual([]);
		expect(endData).toBeUndefined(); // clean completion, no error
	});

	it("disconnects upstream after first value (no further DATA)", () => {
		let emitCount = 0;
		const p = producer<number>(({ emit }) => {
			// This runs on first subscriber connect
		});
		const f = pipe(p, first());
		subscribe(f, () => emitCount++);

		p.emit(1);
		p.emit(2); // should not reach first's subscriber (it completed)
		p.emit(3);

		expect(emitCount).toBe(1);
	});

	it("works in pipe chain: pipe(source, first())", () => {
		const s = state(10);
		const f = pipe(s, first());
		const values: number[] = [];
		subscribe(f, (v) => values.push(v as number));

		s.set(20);
		s.set(30);

		expect(values).toEqual([20]);
	});

	it("late subscriber after completion gets END immediately", () => {
		const s = state(0);
		const f = pipe(s, first());
		subscribe(f, () => {});
		s.set(1); // completes first

		let gotStart = false;
		let gotEnd = false;
		f.source(START, (type: number) => {
			if (type === START) gotStart = true;
			if (type === END) gotEnd = true;
		});

		expect(gotStart).toBe(true);
		expect(gotEnd).toBe(true);
	});

	it("get() retains value after completion", () => {
		const s = state(0);
		const f = pipe(s, first());
		subscribe(f, () => {});
		s.set(99);

		expect(f.get()).toBe(99);
		// Further upstream changes don't affect it
		s.set(200);
		expect(f.get()).toBe(99);
	});
});

// ---------------------------------------------------------------------------
// last
// ---------------------------------------------------------------------------

describe("last", () => {
	it("buffers all values, emits last on upstream completion", () => {
		const p = producer<number>();
		const l = pipe(p, last());
		const values: unknown[] = [];
		subscribe(l, (v) => values.push(v));

		p.emit(1);
		p.emit(2);
		p.emit(3);
		expect(values).toEqual([]); // still buffering

		p.complete();
		expect(values).toEqual([3]);
	});

	it("get() returns undefined before completion, then last value", () => {
		const p = producer<number>();
		const l = pipe(p, last());
		subscribe(l, () => {});

		expect(l.get()).toBeUndefined();
		p.emit(10);
		// last doesn't emit until completion, so get() still undefined
		expect(l.get()).toBeUndefined();

		p.complete();
		expect(l.get()).toBe(10);
	});

	it("upstream error → forwards error, does NOT emit buffered value", () => {
		const p = producer<number>();
		const l = pipe(p, last());
		const values: unknown[] = [];
		let endData: unknown = "not-called";
		subscribe(l, (v) => values.push(v), { onEnd: (err) => (endData = err) });

		p.emit(42);
		p.error("fail");

		expect(values).toEqual([]); // no emission
		expect(endData).toBe("fail");
	});

	it("empty upstream (completes with no DATA) → complete with no emission", () => {
		const p = producer<number>();
		const l = pipe(p, last());
		const values: unknown[] = [];
		let endData: unknown = "not-called";
		subscribe(l, (v) => values.push(v), { onEnd: (err) => (endData = err) });

		p.complete();

		expect(values).toEqual([]);
		expect(endData).toBeUndefined(); // clean completion
	});

	it("multiple values → only last emitted", () => {
		const p = producer<string>();
		const l = pipe(p, last());
		const values: unknown[] = [];
		subscribe(l, (v) => values.push(v));

		p.emit("a");
		p.emit("b");
		p.emit("c");
		p.complete();

		expect(values).toEqual(["c"]);
	});

	it("works with fromIter (synchronous completion)", () => {
		const src = fromIter([10, 20, 30]);
		const l = pipe(src, last());
		const values: unknown[] = [];
		subscribe(l, (v) => values.push(v));

		expect(values).toEqual([30]);
	});

	it("late subscriber after completion gets END immediately", () => {
		const p = producer<number>();
		const l = pipe(p, last());
		subscribe(l, () => {});
		p.emit(1);
		p.complete();

		let gotEnd = false;
		l.source(START, (type: number) => {
			if (type === END) gotEnd = true;
		});
		expect(gotEnd).toBe(true);
	});

	it("get() retains last value after completion", () => {
		const p = producer<number>();
		const l = pipe(p, last());
		subscribe(l, () => {});
		p.emit(5);
		p.emit(10);
		p.complete();

		expect(l.get()).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// find
// ---------------------------------------------------------------------------

describe("find", () => {
	it("emits first matching value then completes", () => {
		const s = state(0);
		const f = pipe(
			s,
			find((v) => v > 5),
		);
		const values: number[] = [];
		let ended = false;
		subscribe(f, (v) => values.push(v as number), { onEnd: () => (ended = true) });

		s.set(3);
		s.set(7); // match
		s.set(10); // ignored

		expect(values).toEqual([7]);
		expect(ended).toBe(true);
	});

	it("get() returns undefined until match, then matched value", () => {
		const p = producer<number>();
		const f = pipe(
			p,
			find((v) => v > 10),
		);
		subscribe(f, () => {});

		expect(f.get()).toBeUndefined();
		p.emit(5);
		expect(f.get()).toBeUndefined();
		p.emit(20);
		expect(f.get()).toBe(20);
	});

	it("no match → complete on upstream END with no emission", () => {
		const p = producer<number>();
		const f = pipe(
			p,
			find((v) => v > 100),
		);
		const values: unknown[] = [];
		let endData: unknown = "not-called";
		subscribe(f, (v) => values.push(v), { onEnd: (err) => (endData = err) });

		p.emit(1);
		p.emit(2);
		p.complete();

		expect(values).toEqual([]);
		expect(endData).toBeUndefined(); // clean completion
	});

	it("upstream error before match → forward error", () => {
		const p = producer<number>();
		const f = pipe(
			p,
			find((v) => v > 100),
		);
		let endData: unknown = "not-called";
		subscribe(f, () => {}, { onEnd: (err) => (endData = err) });

		p.emit(1); // no match
		p.error("oops");

		expect(endData).toBe("oops");
	});

	it("predicate receives correct value", () => {
		const s = state(0);
		const seen: number[] = [];
		const f = pipe(
			s,
			find((v) => {
				seen.push(v);
				return v === 3;
			}),
		);
		subscribe(f, () => {});

		s.set(1);
		s.set(2);
		s.set(3);

		expect(seen).toEqual([1, 2, 3]);
	});

	it("disconnects upstream after match", () => {
		const p = producer<number>();
		const f = pipe(
			p,
			find((v) => v === 5),
		);
		let callCount = 0;
		subscribe(f, () => callCount++);

		p.emit(5); // match
		p.emit(6); // should not reach subscriber

		expect(callCount).toBe(1);
	});

	it("works in pipe chain with state source", () => {
		const s = state("hello");
		const f = pipe(
			s,
			find((v) => v.length > 5),
		);
		const values: string[] = [];
		subscribe(f, (v) => values.push(v as string));

		s.set("hi");
		s.set("goodbye"); // length 7, matches

		expect(values).toEqual(["goodbye"]);
	});

	it("late subscriber after completion gets END immediately", () => {
		const s = state(0);
		const f = pipe(
			s,
			find((v) => v === 1),
		);
		subscribe(f, () => {});
		s.set(1); // completes

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
	it("emits value at given index (0-based)", () => {
		const p = producer<string>();
		const e = pipe(p, elementAt(2));
		const values: unknown[] = [];
		subscribe(e, (v) => values.push(v));

		p.emit("a"); // index 0
		p.emit("b"); // index 1
		p.emit("c"); // index 2 → emit
		p.emit("d"); // ignored

		expect(values).toEqual(["c"]);
	});

	it("index 0 → same as first()", () => {
		const s = state(0);
		const e = pipe(s, elementAt(0));
		const values: number[] = [];
		let ended = false;
		subscribe(e, (v) => values.push(v as number), { onEnd: () => (ended = true) });

		s.set(42);

		expect(values).toEqual([42]);
		expect(ended).toBe(true);
	});

	it("index beyond stream length → complete on upstream END", () => {
		const p = producer<number>();
		const e = pipe(p, elementAt(100));
		const values: unknown[] = [];
		let endData: unknown = "not-called";
		subscribe(e, (v) => values.push(v), { onEnd: (err) => (endData = err) });

		p.emit(1);
		p.emit(2);
		p.complete();

		expect(values).toEqual([]);
		expect(endData).toBeUndefined(); // clean completion
	});

	it("upstream error before reaching index → forward error", () => {
		const p = producer<number>();
		const e = pipe(p, elementAt(5));
		let endData: unknown = "not-called";
		subscribe(e, () => {}, { onEnd: (err) => (endData = err) });

		p.emit(1);
		p.error("err");

		expect(endData).toBe("err");
	});

	it("get() returns undefined until target index", () => {
		const p = producer<number>();
		const e = pipe(p, elementAt(1));
		subscribe(e, () => {});

		expect(e.get()).toBeUndefined();
		p.emit(10); // index 0
		expect(e.get()).toBeUndefined();
		p.emit(20); // index 1 → captured
		expect(e.get()).toBe(20);
	});

	it("negative index → never emits, complete on END", () => {
		const p = producer<number>();
		const e = pipe(p, elementAt(-1));
		const values: unknown[] = [];
		let endData: unknown = "not-called";
		subscribe(e, (v) => values.push(v), { onEnd: (err) => (endData = err) });

		p.emit(1);
		p.emit(2);
		p.complete();

		expect(values).toEqual([]);
		expect(endData).toBeUndefined();
	});

	it("count tracks only DATA emissions (not STATE)", () => {
		// elementAt counts DATA type only; STATE signals don't increment counter
		const p = producer<number>();
		const e = pipe(p, elementAt(1));
		const values: unknown[] = [];
		subscribe(e, (v) => values.push(v));

		p.emit(10); // DATA index 0
		p.emit(20); // DATA index 1 → emit

		expect(values).toEqual([20]);
	});

	it("late subscriber after completion gets END immediately", () => {
		const p = producer<number>();
		const e = pipe(p, elementAt(0));
		subscribe(e, () => {});
		p.emit(1); // completes

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
	it("splits values by predicate into [true, false] stores", () => {
		const s = state(0);
		const [evens, odds] = partition<number>((v) => v % 2 === 0)(s);
		const evenValues: unknown[] = [];
		const oddValues: unknown[] = [];
		subscribe(evens, (v) => evenValues.push(v));
		subscribe(odds, (v) => oddValues.push(v));

		s.set(2);
		s.set(3);
		s.set(4);
		s.set(5);

		expect(evenValues).toEqual([2, 4]);
		expect(oddValues).toEqual([3, 5]);
	});

	it("both branches share single upstream subscription (refcounted)", () => {
		let startCount = 0;
		const p = producer<number>(({ emit }) => {
			startCount++;
		});
		const [a, b] = partition<number>((v) => v > 0)(p);

		// First branch subscribes → upstream connects (startCount: 1)
		const unsub1 = subscribe(a, () => {});
		expect(startCount).toBe(1);

		// Second branch subscribes → upstream already connected (startCount still 1)
		const unsub2 = subscribe(b, () => {});
		expect(startCount).toBe(1);

		unsub1();
		unsub2();
	});

	it("unsubscribe one branch keeps other alive", () => {
		const s = state(0);
		const [trueS, falseS] = partition<number>((v) => v > 0)(s);
		const trueVals: unknown[] = [];
		const falseVals: unknown[] = [];

		const unsub1 = subscribe(trueS, (v) => trueVals.push(v));
		subscribe(falseS, (v) => falseVals.push(v));

		s.set(1); // true branch
		unsub1(); // disconnect true branch
		s.set(-1); // false branch still alive
		s.set(2); // true branch disconnected, won't receive

		expect(trueVals).toEqual([1]);
		expect(falseVals).toEqual([-1]);
	});

	it("unsubscribe both branches disconnects upstream", () => {
		let cleanedUp = false;
		const p = producer<number>(() => {
			return () => {
				cleanedUp = true;
			};
		});
		const [a, b] = partition<number>((v) => v > 0)(p);

		const unsub1 = subscribe(a, () => {});
		const unsub2 = subscribe(b, () => {});

		unsub1();
		expect(cleanedUp).toBe(false); // one branch still alive
		unsub2();
		expect(cleanedUp).toBe(true); // both disconnected → upstream cleaned up
	});

	it("matching branch gets DATA, non-matching gets RESOLVED (no DATA)", () => {
		const s = state(0);
		const [pos, neg] = partition<number>((v) => v > 0)(s);
		const posVals: unknown[] = [];
		const negVals: unknown[] = [];
		subscribe(pos, (v) => posVals.push(v));
		subscribe(neg, (v) => negVals.push(v));

		s.set(5); // pos gets DATA=5, neg gets RESOLVED (no DATA callback)

		expect(posVals).toEqual([5]);
		expect(negVals).toEqual([]); // neg didn't get DATA
	});

	it("error propagated to both branches", () => {
		const p = producer<number>();
		const [a, b] = partition<number>((v) => v > 0)(p);
		let errA: unknown = "not-called";
		let errB: unknown = "not-called";
		subscribe(a, () => {}, { onEnd: (err) => (errA = err) });
		subscribe(b, () => {}, { onEnd: (err) => (errB = err) });

		p.error("bang");

		expect(errA).toBe("bang");
		expect(errB).toBe("bang");
	});

	it("completion propagated to both branches", () => {
		const p = producer<number>();
		const [a, b] = partition<number>((v) => v > 0)(p);
		let endA = false;
		let endB = false;
		subscribe(a, () => {}, { onEnd: () => (endA = true) });
		subscribe(b, () => {}, { onEnd: () => (endB = true) });

		p.complete();

		expect(endA).toBe(true);
		expect(endB).toBe(true);
	});

	it("late subscriber after completion gets END immediately", () => {
		const p = producer<number>();
		const [a, _b] = partition<number>((v) => v > 0)(p);
		subscribe(a, () => {});
		p.complete();

		let gotEnd = false;
		a.source(START, (type: number) => {
			if (type === END) gotEnd = true;
		});
		expect(gotEnd).toBe(true);
	});

	it("get() returns last value for each branch", () => {
		const s = state(0);
		const [pos, neg] = partition<number>((v) => v > 0)(s);
		subscribe(pos, () => {});
		subscribe(neg, () => {});

		expect(pos.get()).toBeUndefined();
		expect(neg.get()).toBeUndefined();

		s.set(5);
		expect(pos.get()).toBe(5);
		expect(neg.get()).toBeUndefined();

		s.set(-3);
		expect(pos.get()).toBe(5);
		expect(neg.get()).toBe(-3);
	});

	it("works with state source and dynamic values", () => {
		const s = state("hello");
		const [long, short] = partition<string>((v) => v.length > 3)(s);
		const longVals: string[] = [];
		const shortVals: string[] = [];
		subscribe(long, (v) => longVals.push(v as string));
		subscribe(short, (v) => shortVals.push(v as string));

		s.set("hi");
		s.set("goodbye");
		s.set("ok");
		s.set("wonderful");

		expect(longVals).toEqual(["goodbye", "wonderful"]);
		expect(shortVals).toEqual(["hi", "ok"]);
	});
});
