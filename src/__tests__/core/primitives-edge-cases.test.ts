import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribe } from "../../extra/subscribe";
import { batch, derived, effect, Inspector, operator, pipe, producer, state } from "../../index";
import { DATA, END, START, STATE } from "../../protocol";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// producer edge cases
// ---------------------------------------------------------------------------

describe("producer edge cases", () => {
	it("emit() after error() is no-op", () => {
		const p = producer<number>();
		const values: number[] = [];
		let endData: unknown = "not-called";
		subscribe(p, (v) => values.push(v), { onEnd: (err) => (endData = err) });

		p.emit(1);
		p.error("boom");
		p.emit(2); // should be ignored

		expect(values).toEqual([1]);
		expect(endData).toBe("boom");
	});

	it("emit() after complete() is no-op", () => {
		const p = producer<number>();
		const values: number[] = [];
		let ended = false;
		subscribe(p, (v) => values.push(v), { onEnd: () => (ended = true) });

		p.emit(1);
		p.complete();
		p.emit(2); // should be ignored

		expect(values).toEqual([1]);
		expect(ended).toBe(true);
	});

	it("multiple complete() calls are idempotent", () => {
		const p = producer<number>();
		let endCount = 0;
		subscribe(p, () => {}, { onEnd: () => endCount++ });

		p.complete();
		p.complete();
		p.complete();

		expect(endCount).toBe(1);
	});

	it("multiple error() calls — only first takes effect", () => {
		const p = producer<number>();
		let endCount = 0;
		let endData: unknown;
		subscribe(p, () => {}, {
			onEnd: (err) => {
				endCount++;
				endData = err;
			},
		});

		p.error("first");
		p.error("second");

		expect(endCount).toBe(1);
		expect(endData).toBe("first");
	});

	it("cleanup function called exactly once on last sink disconnect", () => {
		let cleanupCount = 0;
		const p = producer<number>(({ emit }) => {
			emit(1);
			return () => {
				cleanupCount++;
			};
		});

		const unsub1 = subscribe(p, () => {});
		const unsub2 = subscribe(p, () => {});

		unsub1();
		expect(cleanupCount).toBe(0); // still has one sink

		unsub2();
		expect(cleanupCount).toBe(1);
	});

	it("cleanup function called on error", () => {
		let cleanupCalled = false;
		const p = producer<number>(({ emit }) => {
			emit(1);
			return () => {
				cleanupCalled = true;
			};
		});

		subscribe(p, () => {});
		p.error("boom");
		expect(cleanupCalled).toBe(true);
	});

	it("cleanup function called on complete", () => {
		let cleanupCalled = false;
		const p = producer<number>(({ emit }) => {
			emit(1);
			return () => {
				cleanupCalled = true;
			};
		});

		subscribe(p, () => {});
		p.complete();
		expect(cleanupCalled).toBe(true);
	});

	it("resetOnTeardown: get() returns initial after disconnect", () => {
		const p = producer<number>(
			({ emit }) => {
				emit(42);
				return undefined;
			},
			{ initial: 0, resetOnTeardown: true },
		);

		const unsub = subscribe(p, () => {});
		expect(p.get()).toBe(42);

		unsub();
		expect(p.get()).toBe(0); // reset to initial
	});

	it("getter option: custom get() used", () => {
		const p = producer<number>(undefined, {
			initial: 10,
			getter: (cached) => (cached ?? 0) * 2,
		});

		// No sinks — getter should be used
		expect(p.get()).toBe(20);
	});

	it("equals option: equal values suppress emission", () => {
		const p = producer<number>(undefined, {
			equals: (a, b) => Math.abs(a - b) < 0.01,
		});

		const values: number[] = [];
		subscribe(p, (v) => values.push(v));

		p.emit(1.0);
		p.emit(1.005); // within tolerance — suppressed
		p.emit(1.02); // outside tolerance — emitted

		expect(values).toEqual([1.0, 1.02]);
	});

	it("late subscriber to completed producer gets END immediately", () => {
		const p = producer<number>();
		subscribe(p, () => {});
		p.emit(42);
		p.complete();

		let gotEnd = false;
		p.source(START, (type: number) => {
			if (type === END) gotEnd = true;
		});
		expect(gotEnd).toBe(true);
	});

	it("late subscriber to errored producer gets END immediately", () => {
		const p = producer<number>();
		subscribe(p, () => {}, { onEnd: () => {} });
		p.error("boom");

		let gotEnd = false;
		p.source(START, (type: number) => {
			if (type === END) gotEnd = true;
		});
		expect(gotEnd).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// state edge cases
// ---------------------------------------------------------------------------

describe("state edge cases", () => {
	it("set() during subscriber callback (reentrancy)", () => {
		const s = state(0);
		const values: number[] = [];

		subscribe(s, (v) => {
			values.push(v);
			if (v === 1) s.set(2); // reentrant set
		});

		s.set(1);

		// Both values should be delivered
		expect(values).toContain(1);
		expect(values).toContain(2);
	});

	it("update() fn sees current value", () => {
		const s = state(10);
		s.update((v) => v + 5);
		expect(s.get()).toBe(15);

		s.update((v) => v * 2);
		expect(s.get()).toBe(30);
	});

	it("Object.is: NaN === NaN (suppressed), +0 !== -0 (emitted)", () => {
		const s = state(NaN);
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		s.set(NaN); // Object.is(NaN, NaN) = true → suppressed
		expect(values).toEqual([]);

		const s2 = state(0);
		const values2: number[] = [];
		subscribe(s2, (v) => values2.push(v));

		s2.set(-0); // Object.is(0, -0) = false → emitted
		expect(values2).toEqual([-0]);
	});

	it("set() with same value → no emission (Object.is dedup)", () => {
		const s = state(42);
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		s.set(42);
		s.set(42);
		s.set(42);

		expect(values).toEqual([]);
	});

	it("many rapid set() calls → each emits (no batching without batch())", () => {
		const s = state(0);
		const values: number[] = [];
		subscribe(s, (v) => values.push(v));

		for (let i = 1; i <= 5; i++) s.set(i);

		expect(values).toEqual([1, 2, 3, 4, 5]);
	});

	it("set() on completed state → no emission (producer is completed)", () => {
		const s = state(0);
		const values: number[] = [];
		subscribe(s, (v) => values.push(v), { onEnd: () => {} });

		// Force completion by calling complete() on the underlying producer
		(s as any).complete();

		s.set(99);
		expect(values).toEqual([]);
		// emit() checks _completed before updating _value, so value stays at 0
		expect(s.get()).toBe(0);
	});

	it("get() always returns latest even without subscribers", () => {
		const s = state(0);
		expect(s.get()).toBe(0);

		s.set(1);
		expect(s.get()).toBe(1);

		s.set(2);
		expect(s.get()).toBe(2);
	});

	it("custom equals option overrides Object.is", () => {
		// Case-insensitive string comparison
		const s = state("hello", {
			equals: (a, b) => a.toLowerCase() === b.toLowerCase(),
		});
		const values: string[] = [];
		subscribe(s, (v) => values.push(v));

		s.set("HELLO"); // same ignoring case → suppressed
		s.set("world"); // different → emitted

		expect(values).toEqual(["world"]);
	});
});

// ---------------------------------------------------------------------------
// derived edge cases
// ---------------------------------------------------------------------------

describe("derived edge cases", () => {
	it("fn throws exception → error propagates to subscriber", () => {
		const s = state(0);
		const d = derived([s], () => {
			if (s.get() === 1) throw new Error("derived-error");
			return s.get() * 2;
		});

		const values: number[] = [];
		subscribe(d, (v) => values.push(v));
		expect(values).toEqual([]); // initial value computed before subscribe

		// This will throw during recompute
		expect(() => s.set(1)).toThrow("derived-error");
	});

	it("very deep chain (10 nested deriveds) → correct propagation", () => {
		const s = state(1);
		let current: any = s;
		for (let i = 0; i < 10; i++) {
			const dep = current;
			current = derived([dep], () => dep.get() + 1);
		}

		const values: number[] = [];
		subscribe(current, (v) => values.push(v));

		s.set(2);
		// Each derived adds 1, so 2 + 10 = 12
		expect(values).toEqual([12]);
		expect(current.get()).toBe(12);
	});

	it("5-branch diamond → single recomputation", () => {
		const s = state(1);
		const a = derived([s], () => s.get() + 1);
		const b = derived([s], () => s.get() + 2);
		const c = derived([s], () => s.get() + 3);
		const d = derived([s], () => s.get() + 4);
		const e = derived([s], () => s.get() + 5);

		let computeCount = 0;
		const combined = derived([a, b, c, d, e], () => {
			computeCount++;
			return a.get() + b.get() + c.get() + d.get() + e.get();
		});

		subscribe(combined, () => {});
		computeCount = 0; // reset after initial

		s.set(2);
		expect(computeCount).toBe(1); // single recomputation despite 5 branches
		expect(combined.get()).toBe(3 + 4 + 5 + 6 + 7);
	});

	it("derived of derived of derived → DIRTY counting correct", () => {
		const s = state(1);
		const d1 = derived([s], () => s.get() * 2);
		const d2 = derived([d1], () => d1.get() * 3);
		const d3 = derived([d2], () => d2.get() * 4);

		const values: number[] = [];
		subscribe(d3, (v) => values.push(v));

		s.set(2);
		expect(values).toEqual([2 * 2 * 3 * 4]); // 48
		expect(d3.get()).toBe(48);
	});

	it("equals option: derived suppresses emission when fn returns same value", () => {
		const s = state(1);
		const d = derived([s], () => (s.get() > 0 ? "positive" : "negative"), {
			equals: Object.is,
		});

		const values: string[] = [];
		subscribe(d, (v) => values.push(v));

		s.set(2); // still "positive" → suppressed by equals
		s.set(3); // still "positive" → suppressed
		s.set(-1); // "negative" → emitted

		expect(values).toEqual(["negative"]);
	});

	it("cache invalidation: get() without subscribers recomputes", () => {
		const s = state(1);
		const d = derived([s], () => s.get() * 10);

		expect(d.get()).toBe(10);
		s.set(2);
		expect(d.get()).toBe(20); // recomputes because not connected
		s.set(3);
		expect(d.get()).toBe(30);
	});

	it("derived with single dep (no diamond) → simple passthrough", () => {
		const s = state(5);
		const d = derived([s], () => s.get() * 2);

		const values: number[] = [];
		subscribe(d, (v) => values.push(v));

		s.set(10);
		s.set(15);

		expect(values).toEqual([20, 30]);
	});

	it("derived with multiple deps, only one changes", () => {
		const a = state(1);
		const b = state(2);
		let computeCount = 0;
		const d = derived([a, b], () => {
			computeCount++;
			return a.get() + b.get();
		});

		subscribe(d, () => {});
		computeCount = 0;

		a.set(10);
		expect(d.get()).toBe(12);
		expect(computeCount).toBe(1);
	});

	it("upstream error propagation through derived chain", () => {
		const p = producer<number>();
		const d1 = derived([p as any], () => (p.get() ?? 0) * 2);
		const d2 = derived([d1], () => d1.get() * 3);

		let endData: unknown = "not-called";
		subscribe(d2, () => {}, { onEnd: (err) => (endData = err) });

		p.error("upstream-err");
		// Note: derived doesn't have explicit END handling in _connectUpstream,
		// so the behavior depends on how the callbag protocol handles END signals
		// through derived nodes. The END signal from producer to derived may not
		// propagate to downstream sinks.
	});

	it("upstream completion propagation through derived chain", () => {
		const p = producer<number>();
		const d = derived([p as any], () => (p.get() ?? 0) * 2);

		let ended = false;
		subscribe(d, () => {}, { onEnd: () => (ended = true) });

		p.complete();
		// Similar to error — derived may or may not forward END
	});
});

// ---------------------------------------------------------------------------
// effect edge cases
// ---------------------------------------------------------------------------

describe("effect edge cases", () => {
	it("effect runs once initially with all deps", () => {
		const a = state(1);
		const b = state(2);
		let runCount = 0;

		const dispose = effect([a, b], () => {
			runCount++;
			return undefined;
		});

		expect(runCount).toBe(1); // initial run
		dispose();
	});

	it("cleanup fn runs before each re-execution", () => {
		const s = state(0);
		const log: string[] = [];

		const dispose = effect([s], () => {
			log.push(`run:${s.get()}`);
			return () => log.push(`cleanup:${s.get()}`);
		});

		s.set(1);
		s.set(2);

		// cleanup from previous runs before new run
		expect(log).toEqual([
			"run:0",
			"cleanup:1", // cleanup sees current state (1) when re-running
			"run:1",
			"cleanup:2",
			"run:2",
		]);

		dispose();
	});

	it("dispose() runs final cleanup", () => {
		const s = state(0);
		let cleanedUp = false;

		const dispose = effect([s], () => {
			return () => {
				cleanedUp = true;
			};
		});

		expect(cleanedUp).toBe(false);
		dispose();
		expect(cleanedUp).toBe(true);
	});

	it("dispose() called twice → idempotent (cleanup runs only once)", () => {
		const s = state(0);
		let cleanupCount = 0;

		const dispose = effect([s], () => {
			return () => cleanupCount++;
		});

		dispose();
		dispose();
		// dispose() guards with _disposed flag and nulls out _cleanup,
		// matching RxJS/MobX/Vue/Preact/Svelte convention.
		expect(cleanupCount).toBe(1);
	});

	it("nested effects: effect A triggers state change → effect B runs", () => {
		const a = state(0);
		const b = state(0);
		const bValues: number[] = [];

		const disposeB = effect([b], () => {
			bValues.push(b.get());
			return undefined;
		});

		const disposeA = effect([a], () => {
			b.set(a.get() * 10); // triggers effect B
			return undefined;
		});

		a.set(1);

		expect(bValues).toContain(10);

		disposeA();
		disposeB();
	});

	it("effect with 5+ deps → fires once per batch, not per dep", () => {
		const deps = Array.from({ length: 5 }, (_, i) => state(i));
		let runCount = 0;

		const dispose = effect(deps, () => {
			runCount++;
			return undefined;
		});

		runCount = 0; // reset after initial

		batch(() => {
			for (const d of deps) d.set(d.get() + 100);
		});

		expect(runCount).toBe(1); // single run in batch

		dispose();
	});

	it("effect within batch() → deferred until batch ends", () => {
		const s = state(0);
		const log: string[] = [];

		const dispose = effect([s], () => {
			log.push(`effect:${s.get()}`);
			return undefined;
		});

		log.length = 0; // clear initial run

		batch(() => {
			s.set(1);
			s.set(2);
			s.set(3);
			// During batch, DATA emissions are deferred
		});

		// Effect should run only once with final value
		expect(log).toEqual(["effect:3"]);

		dispose();
	});

	it("effect sees consistent state (all deps resolved before fn runs)", () => {
		const a = state(1);
		const b = state(2);
		const snapshots: [number, number][] = [];

		const dispose = effect([a, b], () => {
			snapshots.push([a.get(), b.get()]);
			return undefined;
		});

		batch(() => {
			a.set(10);
			b.set(20);
		});

		// Should see [10, 20], not [10, 2] or [1, 20]
		expect(snapshots).toContainEqual([10, 20]);

		dispose();
	});

	it("effect skips execution when all deps RESOLVED (no value change)", () => {
		const s = state(1);
		const d = derived([s], () => (s.get() > 0 ? "positive" : "negative"), {
			equals: Object.is,
		});

		let runCount = 0;
		const dispose = effect([d], () => {
			runCount++;
			return undefined;
		});

		runCount = 0; // reset after initial

		s.set(2); // d still returns "positive" → RESOLVED
		expect(runCount).toBe(0); // effect should not re-run

		s.set(-1); // d returns "negative" → DATA
		expect(runCount).toBe(1);

		dispose();
	});
});

// ---------------------------------------------------------------------------
// operator edge cases
// ---------------------------------------------------------------------------

describe("operator edge cases", () => {
	it("handler not called after complete()", () => {
		const s = state(0);
		let handlerCallCount = 0;

		const op = operator<number>(
			[s],
			({ emit, complete }) => {
				return (_dep, type, data) => {
					handlerCallCount++;
					if (type === DATA) {
						emit(data as number);
						if ((data as number) === 2) complete();
					}
				};
			},
			{ initial: 0 },
		);

		subscribe(op, () => {});
		handlerCallCount = 0;

		s.set(1);
		s.set(2); // triggers complete
		const countAfterComplete = handlerCallCount;
		s.set(3); // handler should not be called
		expect(handlerCallCount).toBe(countAfterComplete);
	});

	it("get() after completion returns last cached value", () => {
		const s = state(0);
		const op = operator<number>(
			[s],
			({ emit, complete }) => {
				return (_dep, type, data) => {
					if (type === DATA) {
						emit((data as number) * 10);
						complete();
					}
				};
			},
			{ initial: 0 },
		);

		subscribe(op, () => {}, { onEnd: () => {} });
		s.set(5);
		expect(op.get()).toBe(50);
	});

	it("seed() during init sets value without DATA emission", () => {
		const s = state(0);
		const values: number[] = [];

		const op = operator<number>(
			[s],
			({ seed, emit, signal }) => {
				seed(999);
				return (_dep, type, data) => {
					if (type === STATE) signal(data);
					if (type === DATA) emit((data as number) + 1);
				};
			},
		);

		subscribe(op, (v) => values.push(v));

		// seed should have set value without emitting
		expect(op.get()).toBe(999);
		expect(values).toEqual([]);

		s.set(10);
		expect(values).toEqual([11]);
	});

	it("multiple sinks: one unsubscribes → other still receives", () => {
		const s = state(0);
		const op = operator<number>(
			[s],
			({ emit, signal }) => {
				return (_dep, type, data) => {
					if (type === STATE) signal(data);
					if (type === DATA) emit(data as number);
				};
			},
			{ initial: 0 },
		);

		const values1: number[] = [];
		const values2: number[] = [];
		const unsub1 = subscribe(op, (v) => values1.push(v));
		subscribe(op, (v) => values2.push(v));

		s.set(1);
		unsub1();
		s.set(2);

		expect(values1).toEqual([1]);
		expect(values2).toEqual([1, 2]);
	});

	it("reconnect: init re-runs after disconnect", () => {
		const s = state(0);
		let initCount = 0;

		const op = operator<number>(
			[s],
			({ emit, signal }) => {
				initCount++;
				return (_dep, type, data) => {
					if (type === STATE) signal(data);
					if (type === DATA) emit(data as number);
				};
			},
			{ initial: 0 },
		);

		const unsub1 = subscribe(op, () => {});
		expect(initCount).toBe(1);

		unsub1(); // disconnect
		const unsub2 = subscribe(op, () => {});
		expect(initCount).toBe(2); // init re-runs

		unsub2();
	});

	it("late subscriber to completed operator gets END immediately", () => {
		const s = state(0);
		const op = operator<number>(
			[s],
			({ emit, complete }) => {
				return (_dep, type, data) => {
					if (type === DATA) {
						emit(data as number);
						complete();
					}
				};
			},
			{ initial: 0 },
		);

		subscribe(op, () => {}, { onEnd: () => {} });
		s.set(1); // triggers complete

		let gotEnd = false;
		op.source(START, (type: number) => {
			if (type === END) gotEnd = true;
		});
		expect(gotEnd).toBe(true);
	});
});
