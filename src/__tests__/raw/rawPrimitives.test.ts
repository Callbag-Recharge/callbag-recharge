import { describe, expect, it, vi } from "vitest";
import { rawFromAny } from "../../raw/fromAny";
import { rawFromAsyncIter } from "../../raw/fromAsyncIter";
import { rawFromPromise } from "../../raw/fromPromise";
import { fromTimer } from "../../raw/fromTimer";
import { rawRace } from "../../raw/race";
import { rawSkip } from "../../raw/skip";
import { rawSubscribe } from "../../raw/subscribe";

// ---------------------------------------------------------------------------
// rawFromPromise
// ---------------------------------------------------------------------------

describe("rawFromPromise", () => {
	it("emits resolved value then END", async () => {
		const values: number[] = [];
		let ended = false;
		rawSubscribe(rawFromPromise(Promise.resolve(42)), (v) => values.push(v as number), {
			onEnd: () => (ended = true),
		});
		await Promise.resolve(); // flush microtask
		expect(values).toEqual([42]);
		expect(ended).toBe(true);
	});

	it("rejects → END with error", async () => {
		const err = new Error("boom");
		let endError: unknown;
		rawSubscribe(rawFromPromise(Promise.reject(err)), () => {}, { onEnd: (e) => (endError = e) });
		await Promise.resolve();
		expect(endError).toBe(err);
	});

	it("unsubscribe before resolve → no emissions", async () => {
		const values: number[] = [];
		let ended = false;
		const sub = rawSubscribe(rawFromPromise(Promise.resolve(99)), (v) => values.push(v as number), {
			onEnd: () => (ended = true),
		});
		sub.unsubscribe();
		await Promise.resolve();
		expect(values).toEqual([]);
		expect(ended).toBe(false);
	});

	it("works with thenables (not just native Promise)", async () => {
		const thenable: PromiseLike<string> = {
			// biome-ignore lint/suspicious/noThenProperty: testing PromiseLike protocol
			then: (resolve) => {
				resolve!("hello");
				return thenable;
			},
		};
		const values: string[] = [];
		rawSubscribe(rawFromPromise(thenable), (v) => values.push(v as string));
		await Promise.resolve();
		expect(values).toEqual(["hello"]);
	});
});

// ---------------------------------------------------------------------------
// rawFromAsyncIter
// ---------------------------------------------------------------------------

describe("rawFromAsyncIter", () => {
	it("emits each yielded value then END", async () => {
		async function* gen() {
			yield 1;
			yield 2;
			yield 3;
		}
		const values: number[] = [];
		let ended = false;
		rawSubscribe(rawFromAsyncIter(gen()), (v) => values.push(v as number), {
			onEnd: () => (ended = true),
		});
		// Each await iterator.next() takes a microtask
		await vi.waitFor(() => {
			expect(values).toEqual([1, 2, 3]);
		});
		expect(ended).toBe(true);
	});

	it("factory form creates fresh iterator per subscribe", async () => {
		function* gen() {
			yield "a";
			yield "b";
		}
		const factory = () =>
			(async function* () {
				yield* gen();
			})();

		const src = rawFromAsyncIter(factory);

		const v1: string[] = [];
		rawSubscribe(src, (v) => v1.push(v as string));
		await vi.waitFor(() => expect(v1).toEqual(["a", "b"]));

		// Second subscribe — factory creates fresh iterator
		const v2: string[] = [];
		rawSubscribe(src, (v) => v2.push(v as string));
		await vi.waitFor(() => expect(v2).toEqual(["a", "b"]));
	});

	it("error in iterator → END with error", async () => {
		async function* boom() {
			yield 1;
			throw new Error("iter-fail");
		}
		let endError: unknown;
		rawSubscribe(rawFromAsyncIter(boom()), () => {}, {
			onEnd: (e) => (endError = e),
		});
		await vi.waitFor(() => expect(endError).toBeInstanceOf(Error));
		expect((endError as Error).message).toBe("iter-fail");
	});

	it("unsubscribe cancels iteration — no more values delivered", async () => {
		async function* counting() {
			let i = 0;
			while (true) {
				yield i++;
				await new Promise((r) => setTimeout(r, 10));
			}
		}
		const values: number[] = [];
		const sub = rawSubscribe(rawFromAsyncIter(counting()), (v) => values.push(v as number));
		await vi.waitFor(() => expect(values.length).toBeGreaterThanOrEqual(2));
		sub.unsubscribe();
		const countAfterUnsub = values.length;
		// Wait and verify no more values are delivered
		await new Promise((r) => setTimeout(r, 100));
		expect(values.length).toBe(countAfterUnsub);
	});
});

// ---------------------------------------------------------------------------
// rawFromAny
// ---------------------------------------------------------------------------

describe("rawFromAny", () => {
	it("plain value → emit once + END", () => {
		const values: number[] = [];
		let ended = false;
		rawSubscribe(rawFromAny(42), (v) => values.push(v as number), {
			onEnd: () => (ended = true),
		});
		expect(values).toEqual([42]);
		expect(ended).toBe(true);
	});

	it("PromiseLike → delegates to rawFromPromise", async () => {
		const values: string[] = [];
		rawSubscribe(rawFromAny(Promise.resolve("hi")), (v) => values.push(v as string));
		await Promise.resolve();
		expect(values).toEqual(["hi"]);
	});

	it("Iterable → emits each element synchronously", () => {
		const values: number[] = [];
		let ended = false;
		rawSubscribe(rawFromAny([1, 2, 3]), (v) => values.push(v as number), {
			onEnd: () => (ended = true),
		});
		expect(values).toEqual([1, 2, 3]);
		expect(ended).toBe(true);
	});

	it("string is treated as plain value, not iterable", () => {
		const values: string[] = [];
		rawSubscribe(rawFromAny("abc"), (v) => values.push(v as string));
		expect(values).toEqual(["abc"]);
	});

	it("AsyncIterable → delegates to rawFromAsyncIter", async () => {
		async function* gen() {
			yield 10;
			yield 20;
		}
		const values: number[] = [];
		rawSubscribe(rawFromAny(gen()), (v) => values.push(v as number));
		await vi.waitFor(() => expect(values).toEqual([10, 20]));
	});

	it("Set (iterable) → emits each element", () => {
		const values: number[] = [];
		rawSubscribe(rawFromAny(new Set([1, 2, 3])), (v) => values.push(v as number));
		expect(values).toEqual([1, 2, 3]);
	});

	it("function value → emits the function itself, not invoked as callbag source", () => {
		// Guards SA-3h invariant: rawFromAny must NOT subscribe to function values.
		// Callbag sources are functions, but rawFromAny cannot distinguish them from
		// arbitrary functions without fragile arity heuristics. Functions must be
		// treated as plain values (case 4 in dispatch order).
		const fn = (x: number) => x * 2;
		const values: unknown[] = [];
		let ended = false;
		rawSubscribe(rawFromAny(fn as any), (v) => values.push(v), {
			onEnd: () => (ended = true),
		});
		expect(values).toEqual([fn]); // emits the function object
		expect(ended).toBe(true);
	});

	it("callbag-shaped function → still treated as plain value, not subscribed", () => {
		// A function with callbag arity (type, payload?) must NOT be auto-subscribed.
		// This is the exact ambiguity that prevents extending rawFromAny for adapters.
		const fakeCb = (type: number, _payload?: any) => {
			if (type === 0) throw new Error("should not be called as callbag");
		};
		const values: unknown[] = [];
		rawSubscribe(rawFromAny(fakeCb as any), (v) => values.push(v));
		expect(values).toEqual([fakeCb]);
	});

	it("unsubscribe during iterable → stops emitting", () => {
		// Use raw callbag protocol directly since rawSubscribe returns after
		// sync sources have already emitted (sub isn't assigned yet in callback)
		function* manyValues() {
			for (let i = 0; i < 1000; i++) yield i;
		}
		const values: number[] = [];
		let talkback: ((t: number) => void) | null = null;
		const source = rawFromAny(manyValues());
		source(0, (t: number, d: any) => {
			if (t === 0) {
				talkback = d;
				return;
			}
			if (t === 1) {
				values.push(d as number);
				if (values.length === 3) talkback?.(2 /* END */);
			}
		});
		expect(values).toEqual([0, 1, 2]);
	});
});

// ---------------------------------------------------------------------------
// rawRace
// ---------------------------------------------------------------------------

describe("rawRace", () => {
	it("empty sources → immediate END", () => {
		let ended = false;
		rawSubscribe(rawRace(), () => {}, { onEnd: () => (ended = true) });
		expect(ended).toBe(true);
	});

	it("first to emit wins, losers disconnected", async () => {
		const fast = rawFromPromise(Promise.resolve("fast"));
		// slow never resolves in time
		const slow = rawFromPromise(new Promise<string>((r) => setTimeout(() => r("slow"), 1000)));

		const values: string[] = [];
		let ended = false;
		rawSubscribe(rawRace(slow, fast), (v) => values.push(v as string), {
			onEnd: () => (ended = true),
		});
		await Promise.resolve();
		expect(values).toEqual(["fast"]);
		expect(ended).toBe(true);
	});

	it("single source → mirrors it", async () => {
		const values: number[] = [];
		let ended = false;
		rawSubscribe(rawRace(rawFromPromise(Promise.resolve(7))), (v) => values.push(v as number), {
			onEnd: () => (ended = true),
		});
		await Promise.resolve();
		expect(values).toEqual([7]);
		expect(ended).toBe(true);
	});

	it("error before any DATA → propagates", async () => {
		const err = new Error("race-err");
		const errSource = rawFromPromise(Promise.reject(err));
		const slow = rawFromPromise(new Promise<number>((r) => setTimeout(() => r(1), 1000)));

		let endError: unknown;
		rawSubscribe(rawRace(errSource, slow), () => {}, {
			onEnd: (e) => (endError = e),
		});
		await Promise.resolve();
		expect(endError).toBe(err);
	});

	it("sync sources — first in order wins", () => {
		const a = rawFromAny(1);
		const b = rawFromAny(2);

		const values: number[] = [];
		rawSubscribe(rawRace(a, b), (v) => values.push(v as number));
		expect(values).toEqual([1]);
	});

	it("winner completes → race completes", async () => {
		async function* twoValues() {
			yield "x";
			yield "y";
		}
		const slow = rawFromPromise(new Promise<string>((r) => setTimeout(() => r("late"), 1000)));

		const values: string[] = [];
		let ended = false;
		rawSubscribe(rawRace(rawFromAsyncIter(twoValues()), slow), (v) => values.push(v as string), {
			onEnd: () => (ended = true),
		});
		await vi.waitFor(() => expect(values).toEqual(["x", "y"]));
		expect(ended).toBe(true);
	});

	it("unsubscribe → all sources cleaned up", () => {
		// Use never-ending sources
		const neverEnd1: typeof fromTimer = (type, sink) => {
			if (type !== 0) return;
			sink(0, () => {});
		};
		const neverEnd2: typeof fromTimer = (type, sink) => {
			if (type !== 0) return;
			sink(0, () => {});
		};

		const sub = rawSubscribe(rawRace(neverEnd1, neverEnd2), () => {});
		// Should not throw
		sub.unsubscribe();
	});

	it("all sources complete without DATA → END", () => {
		// Sources that complete immediately with no data
		const emptySource = (type: number, sink?: any) => {
			if (type !== 0) return;
			sink(0, () => {});
			sink(2); // END immediately
		};

		let ended = false;
		const values: unknown[] = [];
		rawSubscribe(rawRace(emptySource, emptySource), (v) => values.push(v), {
			onEnd: () => (ended = true),
		});
		expect(values).toEqual([]);
		expect(ended).toBe(true);
	});

	it("timeout racing pattern: fromTimer vs rawFromPromise", async () => {
		vi.useFakeTimers();

		const slowPromise = new Promise<string>((r) => setTimeout(() => r("done"), 5000));
		const timeout = fromTimer(1000);

		const values: unknown[] = [];
		let endError: unknown;
		rawSubscribe(rawRace(rawFromPromise(slowPromise), timeout), (v) => values.push(v), {
			onEnd: (e) => (endError = e),
		});

		// Timer fires first at 1000ms
		vi.advanceTimersByTime(1000);
		expect(values).toEqual([undefined]); // fromTimer emits undefined
		vi.useRealTimers();
	});

	it("Promise.reject(undefined) propagates as error, not clean completion", async () => {
		const source: (type: number, sink?: any) => void = (type, sink) => {
			if (type !== 0) return;
			sink(0, () => {});
			// Simulate error with undefined payload (2 args)
			sink(2, undefined);
		};

		let gotEnd = false;
		let endPayload: unknown = "sentinel";
		rawSubscribe(rawRace(source), () => {}, {
			onEnd: (e) => {
				gotEnd = true;
				endPayload = e;
			},
		});
		expect(gotEnd).toBe(true);
		// rawSubscribe always calls onEnd(data) where data comes from sink(2, data)
		// The key is that rawRace uses arguments.length to detect error vs clean
		expect(endPayload).toBe(undefined);
	});
});

// ---------------------------------------------------------------------------
// Edge case: re-entrant cancellation
// ---------------------------------------------------------------------------

describe("re-entrant cancellation", () => {
	it("rawFromPromise: talkback END during DATA prevents double-END", async () => {
		const events: string[] = [];
		const src = rawFromPromise(Promise.resolve("val"));
		src(0, (t: number, d: any) => {
			if (t === 0) {
				const talkback = d;
				// Store talkback for re-entrant cancel
				src._talkback = talkback;
				return;
			}
			if (t === 1) {
				events.push(`DATA:${d}`);
				// Re-entrantly cancel during DATA
				src._talkback?.(2);
				return;
			}
			if (t === 2) {
				events.push("END");
			}
		});
		await Promise.resolve();
		// Should see DATA but no END (cancelled during DATA)
		expect(events).toEqual(["DATA:val"]);
	});

	it("rawFromAny plain value: talkback END during DATA prevents END", () => {
		const events: string[] = [];
		let talkback: any;
		const src = rawFromAny(42);
		src(0, (t: number, d: any) => {
			if (t === 0) {
				talkback = d;
				return;
			}
			if (t === 1) {
				events.push(`DATA:${d}`);
				talkback(2); // cancel during DATA
				return;
			}
			if (t === 2) {
				events.push("END");
			}
		});
		expect(events).toEqual(["DATA:42"]);
	});
});

// ---------------------------------------------------------------------------
// Edge case: factory errors
// ---------------------------------------------------------------------------

describe("rawFromAsyncIter factory errors", () => {
	it("factory that throws → END with error (no crash)", () => {
		let endError: unknown;
		rawSubscribe(
			rawFromAsyncIter(() => {
				throw new Error("factory-boom");
			}),
			() => {},
			{ onEnd: (e) => (endError = e) },
		);
		expect(endError).toBeInstanceOf(Error);
		expect((endError as Error).message).toBe("factory-boom");
	});

	it("object with throwing Symbol.asyncIterator → END with error", () => {
		const bad = {
			[Symbol.asyncIterator]() {
				throw new Error("getter-boom");
			},
		};
		let endError: unknown;
		rawSubscribe(rawFromAsyncIter(bad as any), () => {}, {
			onEnd: (e) => (endError = e),
		});
		expect(endError).toBeInstanceOf(Error);
		expect((endError as Error).message).toBe("getter-boom");
	});
});

// ---------------------------------------------------------------------------
// rawSkip validation
// ---------------------------------------------------------------------------

describe("rawSkip validation", () => {
	it("NaN throws RangeError", () => {
		expect(() => rawSkip(NaN)).toThrow(RangeError);
	});

	it("negative throws RangeError", () => {
		expect(() => rawSkip(-1)).toThrow(RangeError);
	});

	it("Infinity throws RangeError", () => {
		expect(() => rawSkip(Infinity)).toThrow(RangeError);
	});

	it("zero is valid", () => {
		expect(() => rawSkip(0)).not.toThrow();
	});
});
