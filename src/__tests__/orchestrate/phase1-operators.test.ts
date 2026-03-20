import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inspector } from "../../core/inspector";
import { subscribe } from "../../extra/subscribe";
import { effect, pipe, producer, state } from "../../index";
import {
	fromTrigger,
	gate,
	route,
	track,
	withBreaker,
	withRetry,
	withTimeout,
} from "../../orchestrate";
import { circuitBreaker } from "../../utils";

// ==========================================================================
// 1a. fromTrigger
// ==========================================================================
describe("fromTrigger", () => {
	it("emits values on fire()", () => {
		const trigger = fromTrigger<number>();
		const values: number[] = [];
		const unsub = subscribe(trigger, (v) => values.push(v!));

		trigger.fire(1);
		trigger.fire(2);
		trigger.fire(3);
		unsub();

		expect(values).toEqual([1, 2, 3]);
	});

	it("emits same value multiple times (no dedup)", () => {
		const trigger = fromTrigger<string>();
		const values: string[] = [];
		const unsub = subscribe(trigger, (v) => values.push(v!));

		trigger.fire("go");
		trigger.fire("go");
		trigger.fire("go");
		unsub();

		expect(values).toEqual(["go", "go", "go"]);
	});

	it("get() returns last fired value", () => {
		const trigger = fromTrigger<number>();
		expect(trigger.get()).toBeUndefined();

		trigger.fire(42);
		expect(trigger.get()).toBe(42);
	});

	it("supports initial value", () => {
		const trigger = fromTrigger<number>({ initial: 10 });
		expect(trigger.get()).toBe(10);
	});

	it("fire() before subscribe stores value for get()", () => {
		const trigger = fromTrigger<number>();
		trigger.fire(99);
		expect(trigger.get()).toBe(99);

		// Late subscriber gets the value via get() but no callback
		const values: number[] = [];
		const unsub = subscribe(trigger, (v) => values.push(v!));
		expect(values).toEqual([]); // no callback for current value
		trigger.fire(100);
		expect(values).toEqual([100]);
		unsub();
	});

	it("multiple subscribers receive the same values", () => {
		const trigger = fromTrigger<number>();
		const v1: number[] = [];
		const v2: number[] = [];
		const u1 = subscribe(trigger, (v) => v1.push(v!));
		const u2 = subscribe(trigger, (v) => v2.push(v!));

		trigger.fire(1);
		trigger.fire(2);
		u1();
		u2();

		expect(v1).toEqual([1, 2]);
		expect(v2).toEqual([1, 2]);
	});

	it("reconnect works after disconnect", () => {
		const trigger = fromTrigger<number>();
		const v1: number[] = [];
		const u1 = subscribe(trigger, (v) => v1.push(v!));
		trigger.fire(1);
		u1();

		const v2: number[] = [];
		const u2 = subscribe(trigger, (v) => v2.push(v!));
		trigger.fire(2);
		u2();

		expect(v1).toEqual([1]);
		expect(v2).toEqual([2]);
	});

	it("fire() while disconnected updates get() but does not replay on reconnect", () => {
		const trigger = fromTrigger<number>();

		// Subscribe, fire, disconnect
		const v1: number[] = [];
		const u1 = subscribe(trigger, (v) => v1.push(v!));
		trigger.fire(1);
		u1();
		expect(v1).toEqual([1]);

		// Fire while disconnected — no subscribers
		trigger.fire(42);
		expect(trigger.get()).toBe(42); // get() reflects last fired value

		// Reconnect — should NOT replay 42 (button semantics: press is lost)
		const v2: number[] = [];
		const u2 = subscribe(trigger, (v) => v2.push(v!));
		expect(v2).toEqual([]); // no replay

		// But fire() works again after reconnect
		trigger.fire(99);
		expect(v2).toEqual([99]);
		expect(trigger.get()).toBe(99);
		u2();
	});

	it("get() stays consistent with _lastValue across lifecycle", () => {
		const trigger = fromTrigger<string>({ initial: "init" });
		expect(trigger.get()).toBe("init");

		const u1 = subscribe(trigger, () => {});
		trigger.fire("a");
		expect(trigger.get()).toBe("a");
		u1(); // disconnect

		trigger.fire("b"); // fire while disconnected
		expect(trigger.get()).toBe("b");

		const u2 = subscribe(trigger, () => {}); // reconnect
		expect(trigger.get()).toBe("b"); // still consistent
		u2();
	});
});

// ==========================================================================
// 1b. route
// ==========================================================================
describe("route", () => {
	it("splits values based on predicate", () => {
		const n = state(0);
		const [evens, odds] = route(n, (v) => v % 2 === 0);

		const evenVals: number[] = [];
		const oddVals: number[] = [];
		const u1 = subscribe(evens, (v) => evenVals.push(v));
		const u2 = subscribe(odds, (v) => oddVals.push(v));

		n.set(2);
		n.set(3);
		n.set(4);
		n.set(5);

		u1();
		u2();

		expect(evenVals).toEqual([2, 4]);
		expect(oddVals).toEqual([3, 5]);
	});

	it("get() returns filtered value from source", () => {
		const n = state(10);
		const [evens, odds] = route(n, (v) => v % 2 === 0);

		expect(evens.get()).toBe(10);
		expect(odds.get()).toBeUndefined();

		n.set(11);
		expect(evens.get()).toBeUndefined();
		expect(odds.get()).toBe(11);
	});

	it("forwards upstream errors to both outputs", () => {
		const p = producer<number>();
		const [match, miss] = route(p, (v) => (v ?? 0) > 0);

		// Subscribe to both before erroring
		const obs1 = Inspector.observe(match);
		const obs2 = Inspector.observe(miss);

		p.emit(1);
		p.error(new Error("fail"));

		expect(obs1.ended).toBe(true);
		expect(obs1.endError).toBeInstanceOf(Error);
		expect(obs2.ended).toBe(true);
		expect(obs2.endError).toBeInstanceOf(Error);
	});

	it("forwards upstream completion to both outputs", () => {
		const p = producer<number>(
			({ emit, complete }) => {
				emit(1);
				complete();
			},
			{ initial: 0 },
		);

		const [match, miss] = route(p, (v) => v > 0);

		const obs1 = Inspector.observe(match);
		const obs2 = Inspector.observe(miss);

		expect(obs1.ended).toBe(true);
		expect(obs1.endError).toBeUndefined();
		expect(obs2.ended).toBe(true);
		expect(obs2.endError).toBeUndefined();
	});

	it("reconnect resets state", () => {
		const n = state(0);
		const [evens] = route(n, (v) => v % 2 === 0);

		const v1: number[] = [];
		const u1 = subscribe(evens, (v) => v1.push(v));
		n.set(2);
		u1();

		const v2: number[] = [];
		const u2 = subscribe(evens, (v) => v2.push(v));
		n.set(4);
		u2();

		expect(v1).toEqual([2]);
		expect(v2).toEqual([4]);
	});
});

// ==========================================================================
// 1c. withTimeout
// ==========================================================================
describe("withTimeout", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("forwards values and resets timer", () => {
		const input = state(0);
		const guarded = pipe(input, withTimeout(100));

		const values: number[] = [];
		const unsub = subscribe(guarded, (v) => values.push(v));

		input.set(1);
		vi.advanceTimersByTime(50);
		input.set(2);
		vi.advanceTimersByTime(50);
		input.set(3);

		unsub();
		expect(values).toEqual([1, 2, 3]);
	});

	it("errors with TimeoutError after ms of silence", () => {
		const input = state(0);
		const guarded = pipe(input, withTimeout(100));

		const obs = Inspector.observe(guarded);

		vi.advanceTimersByTime(100);

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeInstanceOf(Error);
		expect((obs.endError as Error).name).toBe("TimeoutError");
	});

	it("cleans up timer on upstream completion", () => {
		const p = producer<number>(
			({ emit, complete }) => {
				emit(1);
				complete();
			},
			{ initial: 0 },
		);

		const guarded = pipe(p, withTimeout(100));
		const obs = Inspector.observe(guarded);

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();

		// Timer should be cleaned up — no TimeoutError
		vi.advanceTimersByTime(200);
	});

	it("forwards upstream errors", () => {
		const p = producer<number>(
			({ error }) => {
				error(new Error("upstream"));
			},
			{ initial: 0 },
		);

		const guarded = pipe(p, withTimeout(100));
		const obs = Inspector.observe(guarded);

		expect(obs.ended).toBe(true);
		expect((obs.endError as Error).message).toBe("upstream");
	});

	it("get() returns initial value from input", () => {
		const input = state(42);
		const guarded = pipe(input, withTimeout(100));
		expect(guarded.get()).toBe(42);
	});
});

// ==========================================================================
// 1d. withBreaker
// ==========================================================================
describe("withBreaker", () => {
	it("passes values when breaker is closed", () => {
		const breaker = circuitBreaker({ failureThreshold: 3 });
		const input = state(0);
		const guarded = pipe(input, withBreaker(breaker));

		const values: number[] = [];
		const unsub = subscribe(guarded, (v) => values.push(v));

		input.set(1);
		input.set(2);
		unsub();

		expect(values).toEqual([1, 2]);
	});

	it("skips values when breaker is open (default skip mode)", () => {
		const breaker = circuitBreaker({ failureThreshold: 1 });
		// Open the breaker
		breaker.recordFailure();

		const input = state(0);
		const guarded = pipe(input, withBreaker(breaker));

		const values: number[] = [];
		const unsub = subscribe(guarded, (v) => values.push(v));

		input.set(1);
		input.set(2);
		unsub();

		expect(values).toEqual([]);
	});

	it("errors when breaker is open in error mode", () => {
		const breaker = circuitBreaker({ failureThreshold: 1 });
		breaker.recordFailure();

		const input = state(0);
		const guarded = pipe(input, withBreaker(breaker, { onOpen: "error" }));

		const obs = Inspector.observe(guarded);

		input.set(1);

		expect(obs.ended).toBe(true);
		expect((obs.endError as Error).name).toBe("CircuitOpenError");
	});

	it("records failures from upstream errors", () => {
		const breaker = circuitBreaker({ failureThreshold: 3 });
		const p = producer<number>(
			({ error }) => {
				error(new Error("upstream fail"));
			},
			{ initial: 0 },
		);

		const guarded = pipe(p, withBreaker(breaker));
		const obs = Inspector.observe(guarded);

		expect(obs.ended).toBe(true);
		expect(breaker.failureCount).toBe(1);
	});

	it("exposes breakerState store", () => {
		const breaker = circuitBreaker({ failureThreshold: 1 });
		const input = state(0);
		const guarded = pipe(input, withBreaker(breaker));

		// Subscribe to activate the operator
		const unsub = subscribe(guarded, () => {});

		expect((guarded as any).breakerState.get()).toBe("closed");

		// Open breaker and trigger a value
		breaker.recordFailure();
		input.set(1);

		expect((guarded as any).breakerState.get()).toBe("open");
		unsub();
	});
});

// ==========================================================================
// 1e. withRetry
// ==========================================================================
describe("withRetry", () => {
	it("retries on error up to count", () => {
		let attempts = 0;
		const source = producer<number>(
			({ emit, error }) => {
				attempts++;
				if (attempts < 3) {
					error(new Error(`fail ${attempts}`));
				} else {
					emit(42);
				}
			},
			{ initial: 0, resubscribable: true },
		);

		const retried = pipe(source, withRetry(5));

		const values: number[] = [];
		const unsub = subscribe(retried, (v) => values.push(v));

		expect(attempts).toBe(3);
		expect(values).toContain(42);
		unsub();
	});

	it("errors after exhausting retries", () => {
		const source = producer<number>(
			({ error }) => {
				error(new Error("always fail"));
			},
			{ initial: 0, resubscribable: true },
		);

		const retried = pipe(source, withRetry(2));
		const obs = Inspector.observe(retried);

		expect(obs.ended).toBe(true);
		expect((obs.endError as Error).message).toBe("always fail");
	});

	it("exposes retryMeta store", () => {
		let attempts = 0;
		const source = producer<number>(
			({ emit, error }) => {
				attempts++;
				if (attempts < 3) {
					error(new Error(`fail ${attempts}`));
				} else {
					emit(42);
				}
			},
			{ initial: 0, resubscribable: true },
		);

		const retried = pipe(source, withRetry(5));

		const unsub = subscribe(retried, () => {});
		const meta = (retried as any).retryMeta.get();

		expect(meta.attempt).toBe(2); // 2 retries before success
		unsub();
	});

	it("respects while predicate", () => {
		let attempts = 0;
		const source = producer<number>(
			({ error }) => {
				attempts++;
				error(new Error(attempts <= 2 ? "retryable" : "fatal"));
			},
			{ initial: 0, resubscribable: true },
		);

		const retried = pipe(
			source,
			withRetry({
				count: 10,
				while: (err) => (err as Error).message === "retryable",
			}),
		);

		const obs = Inspector.observe(retried);
		expect(obs.ended).toBe(true);
		expect((obs.endError as Error).message).toBe("fatal");
	});

	it("uses delay strategy", async () => {
		vi.useFakeTimers();
		let attempts = 0;

		const source = producer<number>(
			({ emit, error }) => {
				attempts++;
				if (attempts < 3) {
					error(new Error("fail"));
				} else {
					emit(42);
				}
			},
			{ initial: 0, resubscribable: true },
		);

		const retried = pipe(
			source,
			withRetry({
				count: 5,
				delay: (attempt) => (attempt + 1) * 100,
			}),
		);

		const values: number[] = [];
		const unsub = subscribe(retried, (v) => values.push(v));

		expect(attempts).toBe(1); // first attempt fails
		vi.advanceTimersByTime(100);
		expect(attempts).toBe(2); // second attempt fails
		vi.advanceTimersByTime(200);
		expect(attempts).toBe(3); // third attempt succeeds
		expect(values).toContain(42);

		unsub();
		vi.useRealTimers();
	});

	it("forwards completion from upstream", () => {
		const source = producer<number>(
			({ emit, complete }) => {
				emit(1);
				complete();
			},
			{ initial: 0 },
		);

		const retried = pipe(source, withRetry(3));
		const obs = Inspector.observe(retried);

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
		expect(obs.values).toContain(1);
	});
});

// ==========================================================================
// 1f. track
// ==========================================================================
describe("track", () => {
	it("starts in idle state", () => {
		const input = state(0);
		const tracked = pipe(input, track()) as any;

		const unsub = subscribe(tracked, () => {});
		expect(tracked.meta.get().status).toBe("idle");
		unsub();
	});

	it("transitions to active on first value", () => {
		const input = state(0);
		const tracked = pipe(input, track()) as any;

		const unsub = subscribe(tracked, () => {});
		input.set(1);
		expect(tracked.meta.get().status).toBe("active");
		expect(tracked.meta.get().count).toBe(1);
		unsub();
	});

	it("counts values", () => {
		const input = state(0);
		const tracked = pipe(input, track()) as any;

		const unsub = subscribe(tracked, () => {});
		input.set(1);
		input.set(2);
		input.set(3);
		expect(tracked.meta.get().count).toBe(3);
		unsub();
	});

	it("transitions to completed on upstream complete", () => {
		const source = producer<number>(
			({ emit, complete }) => {
				emit(1);
				emit(2);
				complete();
			},
			{ initial: 0 },
		);

		const tracked = pipe(source, track()) as any;
		const obs = Inspector.observe(tracked);

		expect(obs.ended).toBe(true);
		expect(tracked.meta.get().status).toBe("completed");
		expect(tracked.meta.get().count).toBe(2);
	});

	it("transitions to errored on upstream error", () => {
		const source = producer<number>(
			({ emit, error }) => {
				emit(1);
				error(new Error("oops"));
			},
			{ initial: 0 },
		);

		const tracked = pipe(source, track()) as any;
		const obs = Inspector.observe(tracked);

		expect(obs.ended).toBe(true);
		expect(tracked.meta.get().status).toBe("errored");
		expect(tracked.meta.get().error).toBeInstanceOf(Error);
		expect(tracked.meta.get().count).toBe(1);
	});

	it("forwards values unchanged", () => {
		const input = state(0);
		const tracked = pipe(input, track());

		const values: number[] = [];
		const unsub = subscribe(tracked, (v) => values.push(v));
		input.set(1);
		input.set(2);
		unsub();

		expect(values).toEqual([1, 2]);
	});

	it("meta is reactive with effect", () => {
		const input = state(0);
		const tracked = pipe(input, track()) as any;

		const statuses: string[] = [];
		const unsub = subscribe(tracked, () => {});
		const dispose = effect([tracked.meta], () => {
			statuses.push(tracked.meta.get().status);
		});

		input.set(1);
		input.set(2);

		unsub();
		dispose();

		expect(statuses).toContain("active");
	});

	it("records duration on completion", () => {
		const source = producer<number>(
			({ emit, complete }) => {
				emit(1);
				complete();
			},
			{ initial: 0 },
		);

		const tracked = pipe(source, track()) as any;
		const _obs = Inspector.observe(tracked);

		expect(tracked.meta.get().duration).toBeDefined();
		expect(tracked.meta.get().duration).toBeGreaterThanOrEqual(0);
	});
});

// ==========================================================================
// 1g. gate
// ==========================================================================
describe("gate", () => {
	it("queues values when closed", () => {
		const input = state(0);
		const gated = pipe(input, gate()) as any;

		const values: number[] = [];
		const unsub = subscribe(gated, (v: number) => values.push(v));

		input.set(1);
		input.set(2);

		expect(values).toEqual([]);
		expect(gated.pending.get()).toEqual([1, 2]);

		unsub();
	});

	it("approve() forwards next pending value", () => {
		const input = state(0);
		const gated = pipe(input, gate()) as any;

		const values: number[] = [];
		const unsub = subscribe(gated, (v: number) => values.push(v));

		input.set(1);
		input.set(2);
		gated.approve();

		expect(values).toEqual([1]);
		expect(gated.pending.get()).toEqual([2]);

		unsub();
	});

	it("approve(n) forwards multiple pending values", () => {
		const input = state(0);
		const gated = pipe(input, gate()) as any;

		const values: number[] = [];
		const unsub = subscribe(gated, (v: number) => values.push(v));

		input.set(1);
		input.set(2);
		input.set(3);
		gated.approve(2);

		expect(values).toEqual([1, 2]);
		expect(gated.pending.get()).toEqual([3]);

		unsub();
	});

	it("reject() discards pending values", () => {
		const input = state(0);
		const gated = pipe(input, gate()) as any;

		const values: number[] = [];
		const unsub = subscribe(gated, (v: number) => values.push(v));

		input.set(1);
		input.set(2);
		gated.reject();

		expect(values).toEqual([]);
		expect(gated.pending.get()).toEqual([2]);

		unsub();
	});

	it("modify() transforms and forwards", () => {
		const input = state(0);
		const gated = pipe(input, gate()) as any;

		const values: number[] = [];
		const unsub = subscribe(gated, (v: number) => values.push(v));

		input.set(5);
		gated.modify((v: number) => v * 10);

		expect(values).toEqual([50]);
		expect(gated.pending.get()).toEqual([]);

		unsub();
	});

	it("open() flushes pending and auto-approves", () => {
		const input = state(0);
		const gated = pipe(input, gate()) as any;

		const values: number[] = [];
		const unsub = subscribe(gated, (v: number) => values.push(v));

		input.set(1);
		input.set(2);
		gated.open();

		expect(values).toEqual([1, 2]);
		expect(gated.isOpen.get()).toBe(true);

		// Future values pass through
		input.set(3);
		expect(values).toEqual([1, 2, 3]);

		unsub();
	});

	it("close() re-enables gating", () => {
		const input = state(0);
		const gated = pipe(input, gate({ startOpen: true })) as any;

		const values: number[] = [];
		const unsub = subscribe(gated, (v: number) => values.push(v));

		input.set(1);
		expect(values).toEqual([1]);

		gated.close();
		input.set(2);
		expect(values).toEqual([1]); // gated again
		expect(gated.pending.get()).toEqual([2]);

		unsub();
	});

	it("startOpen option auto-approves from the start", () => {
		const input = state(0);
		const gated = pipe(input, gate({ startOpen: true })) as any;

		const values: number[] = [];
		const unsub = subscribe(gated, (v: number) => values.push(v));

		input.set(1);
		input.set(2);

		expect(values).toEqual([1, 2]);
		expect(gated.isOpen.get()).toBe(true);

		unsub();
	});

	it("maxPending drops oldest values", () => {
		const input = state(0);
		const gated = pipe(input, gate({ maxPending: 2 })) as any;

		const unsub = subscribe(gated, () => {});

		input.set(1);
		input.set(2);
		input.set(3);

		expect(gated.pending.get()).toEqual([2, 3]);

		unsub();
	});

	it("forwards upstream errors", () => {
		const p = producer<number>(
			({ error }) => {
				error(new Error("fail"));
			},
			{ initial: 0 },
		);

		const gated = pipe(p, gate()) as any;
		const obs = Inspector.observe(gated);

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeInstanceOf(Error);
	});

	it("forwards upstream completion", () => {
		const p = producer<number>(
			({ emit, complete }) => {
				emit(1);
				complete();
			},
			{ initial: 0 },
		);

		const gated = pipe(p, gate()) as any;
		const obs = Inspector.observe(gated);

		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});

	it("pending store is reactive", () => {
		const input = state(0);
		const gated = pipe(input, gate()) as any;

		const pendingLengths: number[] = [];
		const unsub = subscribe(gated, () => {});
		const dispose = effect([gated.pending], () => {
			pendingLengths.push(gated.pending.get().length);
		});

		input.set(1);
		input.set(2);
		gated.approve();

		unsub();
		dispose();

		expect(pendingLengths).toContain(1);
		expect(pendingLengths).toContain(2);
	});

	it("resets queue on reconnect", () => {
		const input = state(0);
		const gated = pipe(input, gate()) as any;

		const unsub1 = subscribe(gated, () => {});
		input.set(1);
		expect(gated.pending.get()).toEqual([1]);
		unsub1();

		const unsub2 = subscribe(gated, () => {});
		expect(gated.pending.get()).toEqual([]);
		unsub2();
	});
});

// ==========================================================================
// Edge cases for P1-P6 fixes
// ==========================================================================
describe("route — predicate exception (P5)", () => {
	it("forwards predicate error to matching output", () => {
		const n = state(0);
		const [match, miss] = route(n, () => {
			throw new Error("pred boom");
		});

		const obs1 = Inspector.observe(match);
		const obs2 = Inspector.observe(miss);

		n.set(1);

		expect(obs1.ended).toBe(true);
		expect((obs1.endError as Error).message).toBe("pred boom");
		expect(obs2.ended).toBe(true);
		expect((obs2.endError as Error).message).toBe("pred boom");
	});

	it("getter returns undefined on predicate exception", () => {
		const n = state(0);
		let shouldThrow = false;
		const [match, miss] = route(n, () => {
			if (shouldThrow) throw new Error("boom");
			return true;
		});

		expect(match.get()).toBe(0);
		expect(miss.get()).toBeUndefined();

		shouldThrow = true;
		expect(match.get()).toBeUndefined();
		expect(miss.get()).toBeUndefined();
	});
});

describe("gate — maxPending validation (P6)", () => {
	it("throws RangeError for maxPending: 0", () => {
		expect(() => gate({ maxPending: 0 })).toThrow(RangeError);
	});

	it("throws RangeError for negative maxPending", () => {
		expect(() => gate({ maxPending: -1 })).toThrow(RangeError);
	});

	it("allows maxPending: 1", () => {
		const input = state(0);
		const gated = pipe(input, gate({ maxPending: 1 })) as any;
		const unsub = subscribe(gated, () => {});

		input.set(1);
		input.set(2);
		expect(gated.pending.get()).toEqual([2]); // oldest dropped
		unsub();
	});
});

describe("gate — isOpen reconnect reset (P1)", () => {
	it("resets isOpen to startOpen=false after open() + teardown + reconnect", () => {
		const input = state(0);
		const gated = pipe(input, gate()) as any;

		const u1 = subscribe(gated, () => {});
		gated.open();
		expect(gated.isOpen.get()).toBe(true);
		u1();

		// Reconnect — should reset to closed
		const values: number[] = [];
		const u2 = subscribe(gated, (v: number) => values.push(v));
		expect(gated.isOpen.get()).toBe(false);

		input.set(1);
		expect(values).toEqual([]); // gated again
		expect(gated.pending.get()).toEqual([1]);
		u2();
	});

	it("resets isOpen to startOpen=true after close() + teardown + reconnect", () => {
		const input = state(0);
		const gated = pipe(input, gate({ startOpen: true })) as any;

		const u1 = subscribe(gated, () => {});
		gated.close();
		expect(gated.isOpen.get()).toBe(false);
		u1();

		// Reconnect — should reset to open
		const values: number[] = [];
		const u2 = subscribe(gated, (v: number) => values.push(v));
		expect(gated.isOpen.get()).toBe(true);

		input.set(1);
		expect(values).toEqual([1]); // auto-approved
		u2();
	});
});

describe("withRetry — delay null stops without incrementing (P3)", () => {
	it("does not increment attempt when delay returns null", () => {
		let attempts = 0;
		const source = producer<number>(
			({ error }) => {
				attempts++;
				error(new Error("fail"));
			},
			{ initial: 0, resubscribable: true },
		);

		const retried = pipe(
			source,
			withRetry({
				count: 5,
				delay: () => null, // always stop
			}),
		);

		const obs = Inspector.observe(retried);
		expect(obs.ended).toBe(true);
		expect(attempts).toBe(1); // no retries

		const meta = (retried as any).retryMeta.get();
		expect(meta.attempt).toBe(0); // never incremented
	});
});

describe("withRetry — stopped guard on teardown (P4)", () => {
	it("does not error when torn down during delay", () => {
		vi.useFakeTimers();
		let attempts = 0;

		const source = producer<number>(
			({ error }) => {
				attempts++;
				error(new Error("fail"));
			},
			{ initial: 0, resubscribable: true },
		);

		const retried = pipe(
			source,
			withRetry({
				count: 5,
				delay: () => 1000,
			}),
		);

		const unsub = subscribe(retried, () => {});
		expect(attempts).toBe(1);

		// Teardown during delay — should not throw
		unsub();
		vi.advanceTimersByTime(1000);
		expect(attempts).toBe(1); // no reconnect after teardown

		vi.useRealTimers();
	});
});

// ==========================================================================
// Integration: composing multiple operators
// ==========================================================================
describe("Phase 1 integration", () => {
	it("trigger → route → track", () => {
		const trigger = fromTrigger<number>();
		const [high, low] = route(trigger, (v) => (v ?? 0) > 50);

		const highTracked = pipe(high, track()) as any;
		const lowTracked = pipe(low, track()) as any;

		const highVals: number[] = [];
		const lowVals: number[] = [];
		const u1 = subscribe(highTracked, (v: number) => highVals.push(v));
		const u2 = subscribe(lowTracked, (v: number) => lowVals.push(v));

		trigger.fire(75);
		trigger.fire(25);
		trigger.fire(90);

		expect(highVals).toEqual([75, 90]);
		expect(lowVals).toEqual([25]);
		expect(highTracked.meta.get().count).toBe(2);
		expect(lowTracked.meta.get().count).toBe(1);

		u1();
		u2();
	});

	it("gate → withTimeout composition", () => {
		vi.useFakeTimers();

		const input = state(0);
		const gated = pipe(input, gate()) as any;
		const guarded = pipe(gated, withTimeout(1000));

		const obs = Inspector.observe(guarded);

		input.set(1);
		// Value is gated — no emission — timeout should fire
		vi.advanceTimersByTime(1000);

		expect(obs.ended).toBe(true);
		expect((obs.endError as Error).name).toBe("TimeoutError");

		vi.useRealTimers();
	});
});
