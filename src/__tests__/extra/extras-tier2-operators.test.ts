import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buffer } from "../../extra/buffer";
import { bufferTime } from "../../extra/bufferTime";
import { delay } from "../../extra/delay";
import { remember } from "../../extra/remember";
import { rescue } from "../../extra/rescue";
import { sample } from "../../extra/sample";
import { subject } from "../../extra/subject";
import { subscribe } from "../../extra/subscribe";
import { tap } from "../../extra/tap";
import { TimeoutError, timeout } from "../../extra/timeout";
import { Inspector, pipe, producer, state } from "../../index";
import { constant as backoffConstant } from "../../utils/backoff";
import { retry } from "../../utils/retry";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// tap
// ---------------------------------------------------------------------------

describe("tap", () => {
	it("calls fn for each value without altering it", () => {
		const s = state(1);
		const tapped: number[] = [];
		const t = pipe(
			s,
			tap((v) => tapped.push(v)),
		);
		const values: number[] = [];
		subscribe(t, (v) => values.push(v));

		s.set(2);
		s.set(3);

		expect(tapped).toEqual([2, 3]);
		expect(values).toEqual([2, 3]);
	});

	it("get() returns upstream value", () => {
		const s = state(42);
		const t = pipe(
			s,
			tap(() => {}),
		);
		expect(t.get()).toBe(42);
		s.set(99);
		expect(t.get()).toBe(99);
	});

	it("tears down on unsubscribe", () => {
		const s = state(0);
		const tapped: number[] = [];
		const t = pipe(
			s,
			tap((v) => tapped.push(v)),
		);
		const unsub = subscribe(t, () => {});
		s.set(1);
		unsub.unsubscribe();
		s.set(2);
		expect(tapped).toEqual([1]);
	});

	it("multiple sinks share the same tap side-effect", () => {
		const s = state(0);
		const tapped: number[] = [];
		const t = pipe(
			s,
			tap((v) => tapped.push(v)),
		);

		subscribe(t, () => {});
		subscribe(t, () => {});

		s.set(1);
		// tap fires once per upstream change via subscribe
		expect(tapped).toEqual([1]);
	});
});

// ---------------------------------------------------------------------------
// delay
// ---------------------------------------------------------------------------

describe("delay", () => {
	it("delays each value by ms", () => {
		const s = state(0);
		const d = pipe(s, delay(100));
		const values: number[] = [];
		subscribe(d, (v) => {
			if (v !== undefined) values.push(v);
		});

		s.set(1);
		expect(values).toEqual([]);

		vi.advanceTimersByTime(100);
		expect(values).toEqual([1]);
	});

	it("delivers each value independently (not debounced)", () => {
		const s = state(0);
		const d = pipe(s, delay(100));
		const values: number[] = [];
		subscribe(d, (v) => {
			if (v !== undefined) values.push(v);
		});

		s.set(1);
		vi.advanceTimersByTime(50);
		s.set(2);
		vi.advanceTimersByTime(50);
		// first value should have arrived
		expect(values).toEqual([1]);

		vi.advanceTimersByTime(50);
		expect(values).toEqual([1, 2]);
	});

	it("clears pending timers on unsubscribe", () => {
		const s = state(0);
		const d = pipe(s, delay(100));
		const values: number[] = [];
		const unsub = subscribe(d, (v) => {
			if (v !== undefined) values.push(v);
		});

		s.set(1);
		unsub.unsubscribe();
		vi.advanceTimersByTime(200);
		expect(values).toEqual([]);
	});

	it("re-subscribe after unsub starts fresh (no stale suppression)", () => {
		const s = state(0);
		const d = pipe(s, delay(100));

		// First subscription
		const unsub1 = subscribe(d, () => {});
		s.set(5);
		vi.advanceTimersByTime(100);
		expect(d.get()).toBe(5);
		unsub1.unsubscribe();

		// After unsub, currentValue should be reset
		expect(d.get()).toBeUndefined();

		// Re-subscribe and set a new value
		const values: number[] = [];
		subscribe(d, (v) => {
			if (v !== undefined) values.push(v);
		});
		s.set(7);
		vi.advanceTimersByTime(100);
		expect(values).toEqual([7]);
	});
});

// ---------------------------------------------------------------------------
// buffer
// ---------------------------------------------------------------------------

describe("buffer", () => {
	it("accumulates values and flushes on notifier", () => {
		const s = state(0);
		const notifier = state(false);
		const b = pipe(s, buffer(notifier));
		const values: number[][] = [];
		subscribe(b, (v) => {
			if (v.length > 0) values.push([...v]);
		});

		s.set(1);
		s.set(2);
		s.set(3);
		notifier.set(true);

		expect(values).toEqual([[1, 2, 3]]);
	});

	it("starts a new buffer after flush", () => {
		const s = state(0);
		const notifier = state(0);
		const b = pipe(s, buffer(notifier));
		const values: number[][] = [];
		subscribe(b, (v) => {
			if (v.length > 0) values.push([...v]);
		});

		s.set(1);
		s.set(2);
		notifier.set(1); // flush [1, 2]
		s.set(3);
		notifier.set(2); // flush [3]

		expect(values).toEqual([[1, 2], [3]]);
	});

	it("releases buffer on unsubscribe", () => {
		const s = state(0);
		const notifier = state(false);
		const b = pipe(s, buffer(notifier));
		const unsub = subscribe(b, () => {});
		s.set(1);
		s.set(2);
		unsub.unsubscribe();
		// no leak — buffer is cleared
	});

	it("get() returns last flushed array", () => {
		const s = state(0);
		const notifier = state(0);
		const b = pipe(s, buffer(notifier));
		subscribe(b, () => {});

		expect(b.get()).toEqual([]);
		s.set(1);
		expect(b.get()).toEqual([]); // not flushed yet
		notifier.set(1);
		expect(b.get()).toEqual([1]);
	});

	it("flushing empty buffer does not push downstream", () => {
		const s = state(0);
		const notifier = state(0);
		const b = pipe(s, buffer(notifier));
		let pushCount = 0;
		subscribe(b, () => pushCount++);

		// Notifier fires with nothing buffered
		notifier.set(1);
		notifier.set(2);

		expect(pushCount).toBe(0);
	});

	it("flushed array is frozen (immutable)", () => {
		const s = state(0);
		const notifier = state(false);
		const b = pipe(s, buffer(notifier));
		subscribe(b, () => {});

		s.set(1);
		notifier.set(true);
		const result = b.get();

		expect(Object.isFrozen(result)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// bufferTime
// ---------------------------------------------------------------------------

describe("bufferTime", () => {
	it("flushes buffer every ms", () => {
		const s = state(0);
		const b = pipe(s, bufferTime(100));
		const values: number[][] = [];
		subscribe(b, (v) => {
			if (v.length > 0) values.push([...v]);
		});

		s.set(1);
		s.set(2);
		vi.advanceTimersByTime(100);
		expect(values).toEqual([[1, 2]]);

		s.set(3);
		vi.advanceTimersByTime(100);
		expect(values).toEqual([[1, 2], [3]]);
	});

	it("does not flush empty buffer", () => {
		const s = state(0);
		const b = pipe(s, bufferTime(100));
		const values: number[][] = [];
		subscribe(b, (v) => {
			if (v.length > 0) values.push([...v]);
		});

		vi.advanceTimersByTime(100);
		expect(values).toEqual([]);
	});

	it("clears timer and buffer on unsubscribe", () => {
		const s = state(0);
		const b = pipe(s, bufferTime(100));
		const unsub = subscribe(b, () => {});
		s.set(1);
		unsub.unsubscribe();
		vi.advanceTimersByTime(200);
		// timer cleared, no leak
	});

	it("flushed array is frozen (immutable)", () => {
		const s = state(0);
		const b = pipe(s, bufferTime(100));
		subscribe(b, () => {});

		s.set(1);
		vi.advanceTimersByTime(100);
		const result = b.get();

		expect(Object.isFrozen(result)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// sample
// ---------------------------------------------------------------------------

describe("sample", () => {
	it("emits latest input value when notifier fires", () => {
		const s = state(0);
		const notifier = state(false);
		const sampled = pipe(s, sample(notifier));
		const values: number[] = [];
		subscribe(sampled, (v) => values.push(v));

		s.set(1);
		s.set(2);
		s.set(3);
		notifier.set(true);

		expect(values).toEqual([3]);
	});

	it("does not emit on input change alone", () => {
		const s = state(0);
		const notifier = state(false);
		const sampled = pipe(s, sample(notifier));
		const values: number[] = [];
		subscribe(sampled, (v) => values.push(v));

		s.set(1);
		s.set(2);

		expect(values).toEqual([]);
	});

	it("get() returns latest input value", () => {
		const s = state(10);
		const notifier = state(false);
		const sampled = pipe(s, sample(notifier));
		subscribe(sampled, () => {});

		expect(sampled.get()).toBe(10);
		s.set(20);
		expect(sampled.get()).toBe(20);
	});

	it("tears down both source and notifier on unsubscribe", () => {
		const s = state(0);
		const notifier = state(false);
		const sampled = pipe(s, sample(notifier));
		const unsub = subscribe(sampled, () => {});
		unsub.unsubscribe();
		// must not throw
	});

	it("emits on each notifier fire with latest value", () => {
		const s = state(0);
		const notifier = state(0);
		const sampled = pipe(s, sample(notifier));
		const values: number[] = [];
		subscribe(sampled, (v) => values.push(v));

		s.set(10);
		notifier.set(1);
		s.set(20);
		notifier.set(2);

		expect(values).toEqual([10, 20]);
	});

	it("works with producer source (initial undefined)", () => {
		const s = producer<number>();
		const notifier = state(false);
		const sampled = pipe(s, sample(notifier));
		subscribe(sampled, () => {});

		expect(sampled.get()).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// timeout
// ---------------------------------------------------------------------------

describe("timeout", () => {
	it("passes through values when source emits in time", () => {
		const s = state(0);
		const t = pipe(s, timeout(100));
		const values: number[] = [];
		subscribe(t, (v) => values.push(v));

		s.set(1);
		vi.advanceTimersByTime(50);
		s.set(2);

		expect(values).toEqual([1, 2]);
	});

	it("sends END with TimeoutError when source is idle too long", () => {
		const s = state(0);
		const t = pipe(s, timeout(100));
		const obs = Inspector.observe(t);

		vi.advanceTimersByTime(100);

		expect(obs.errored).toBe(true);
		expect(obs.endError).toBeInstanceOf(TimeoutError);
	});

	it("resets timer on each emission", () => {
		const s = state(0);
		const t = pipe(s, timeout(100));
		const values: number[] = [];
		subscribe(t, (v) => values.push(v));

		vi.advanceTimersByTime(80);
		s.set(1); // resets timer
		vi.advanceTimersByTime(80);
		// only 80ms since last emit — should not have timed out
		expect(values).toEqual([1]);
	});

	it("clears timer on unsubscribe", () => {
		const s = state(0);
		const t = pipe(s, timeout(100));
		const unsub = subscribe(t, () => {});
		unsub.unsubscribe();
		vi.advanceTimersByTime(200);
		// timer cleared
	});

	it("does not emit values after timeout fires", () => {
		const s = state(0);
		const t = pipe(s, timeout(100));
		const values: number[] = [];
		subscribe(t, (v) => values.push(v));

		vi.advanceTimersByTime(100); // timeout fires
		s.set(1); // source continues — should not propagate
		s.set(2);

		expect(values).toEqual([]);
	});

	it("all sinks receive TimeoutError", () => {
		const s = state(0);
		const t = pipe(s, timeout(100));

		const obs1 = Inspector.observe(t);
		const obs2 = Inspector.observe(t);

		vi.advanceTimersByTime(100);

		expect(obs1.errored).toBe(true);
		expect(obs1.endError).toBeInstanceOf(TimeoutError);
		expect(obs2.errored).toBe(true);
		expect(obs2.endError).toBeInstanceOf(TimeoutError);
	});
});

// ---------------------------------------------------------------------------
// subject
// ---------------------------------------------------------------------------

describe("subject", () => {
	it("pushes values to all sinks", () => {
		const s = subject<number>();
		const values1: (number | undefined)[] = [];
		const values2: (number | undefined)[] = [];
		subscribe(s, (v) => values1.push(v));
		subscribe(s, (v) => values2.push(v));

		s.next(1);
		s.next(2);

		expect(values1).toEqual([1, 2]);
		expect(values2).toEqual([1, 2]);
	});

	it("get() returns latest value", () => {
		const s = subject<number>();
		expect(s.get()).toBeUndefined();
		s.next(42);
		expect(s.get()).toBe(42);
	});

	it("complete() sends END to all sinks", () => {
		const s = subject<number>();
		const obs = Inspector.observe(s);

		s.complete();
		expect(obs.ended).toBe(true);
	});

	it("ignores next() after complete()", () => {
		const s = subject<number>();
		const values: (number | undefined)[] = [];
		subscribe(s, (v) => values.push(v));

		s.next(1);
		s.complete();
		s.next(2);

		expect(values).toEqual([1]);
	});

	it("new subscriber after complete gets immediate END", () => {
		const s = subject<number>();
		s.complete();

		let gotStart = false;
		let gotEnd = false;
		s.source(0, (type: number) => {
			if (type === 0) gotStart = true;
			if (type === 2) gotEnd = true;
		});

		expect(gotStart).toBe(true);
		expect(gotEnd).toBe(true);
	});

	it("error() sends END with error data to all sinks", () => {
		const s = subject<number>();
		const obs = Inspector.observe(s);

		const err = new Error("boom");
		s.error(err);
		expect(obs.errored).toBe(true);
		expect(obs.endError).toBe(err);
	});

	it("suppresses duplicate values via Object.is", () => {
		const s = subject<number>();
		const values: (number | undefined)[] = [];
		subscribe(s, (v) => values.push(v));

		s.next(1);
		s.next(1); // same — suppressed
		s.next(2);

		expect(values).toEqual([1, 2]);
	});

	it("error() after complete() is a no-op", () => {
		const s = subject<number>();
		const obs = Inspector.observe(s);

		s.complete();
		s.error(new Error("late"));

		expect(obs.completedCleanly).toBe(true); // complete(), not error()
	});

	it("next(undefined) as first call sets value", () => {
		const s = subject<undefined>();
		s.next(undefined);
		// Value is set even though initial was also undefined
		expect(s.get()).toBeUndefined();
	});

	it("next() without sinks still updates get()", () => {
		const s = subject<number>();
		s.next(1);
		s.next(2);
		expect(s.get()).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// remember
// ---------------------------------------------------------------------------

describe("remember", () => {
	it("caches the latest upstream value", () => {
		const s = producer<number>();
		const r = pipe(s, remember());
		subscribe(r, () => {}); // activate

		expect(r.get()).toBeUndefined();
		s.emit(5);
		expect(r.get()).toBe(5);
	});

	it("new subscriber gets cached value via get()", () => {
		const s = state(42);
		const r = pipe(s, remember());
		subscribe(r, () => {}); // first subscriber activates

		s.set(99);
		expect(r.get()).toBe(99);
	});

	it("clears cache on teardown", () => {
		const s = producer<number>();
		const r = pipe(s, remember());
		const unsub = subscribe(r, () => {});

		s.emit(10);
		expect(r.get()).toBe(10);

		unsub.unsubscribe();
		expect(r.get()).toBeUndefined();
	});

	it("propagates changes downstream", () => {
		const s = state(1);
		const r = pipe(s, remember());
		const values: (number | undefined)[] = [];
		subscribe(r, (v) => values.push(v));

		s.set(2);
		s.set(3);

		expect(values).toEqual([2, 3]);
	});

	it("re-subscribe after teardown re-reads upstream", () => {
		const s = producer<number>();
		const r = pipe(s, remember());

		const unsub1 = subscribe(r, () => {});
		s.emit(42);
		expect(r.get()).toBe(42);
		unsub1.unsubscribe(); // cache cleared
		expect(r.get()).toBeUndefined();

		// Re-subscribe — start() reads input.get() which retains producer's last value
		subscribe(r, () => {});
		// Producer retains 42 even after restart, so remember caches it again
		expect(r.get()).toBe(42);
		s.emit(99);
		expect(r.get()).toBe(99);
	});

	it("one sink unsubs, cache persists for remaining", () => {
		const s = state(1);
		const r = pipe(s, remember());

		const unsub1 = subscribe(r, () => {});
		subscribe(r, () => {});

		s.set(10);
		unsub1.unsubscribe(); // one sink leaves
		expect(r.get()).toBe(10); // cache still active for remaining sink
	});
});

// ---------------------------------------------------------------------------
// retry
// ---------------------------------------------------------------------------

describe("retry", () => {
	it("passes through values normally when no error", () => {
		const s = state(1);
		const r = pipe(s, retry(3));
		const values: number[] = [];
		subscribe(r, (v) => values.push(v));

		s.set(2);
		s.set(3);

		expect(values).toEqual([2, 3]);
	});

	it("tears down on unsubscribe", () => {
		const s = state(1);
		const r = pipe(s, retry(3));
		const unsub = subscribe(r, () => {});
		unsub.unsubscribe();
		// must not throw
	});

	it("get() reflects current upstream value", () => {
		const s = state(10);
		const r = pipe(s, retry(2));
		subscribe(r, () => {});
		expect(r.get()).toBe(10);
		s.set(20);
		expect(r.get()).toBe(20);
	});

	it("re-subscribes on error up to n times", () => {
		// Create a source that errors via END with data
		let errorSink: ((type: number, data?: unknown) => void) | null = null;

		// Simpler approach: use raw callbag protocol to trigger END with error
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
						if (t === 2) {
							errorSink = null;
						}
					});
				}
			},
		};

		const r = pipe(src, retry(2));
		const obs = Inspector.observe(r);

		expect(producerCount).toBe(1);

		// First error — should retry
		errorSink?.(2, new Error("fail-1"));
		expect(producerCount).toBe(2);

		// Second error — should retry (last retry)
		errorSink?.(2, new Error("fail-2"));
		expect(producerCount).toBe(3);

		// Third error — retries exhausted, forward to sinks
		const finalErr = new Error("fail-3");
		errorSink?.(2, finalErr);
		expect(producerCount).toBe(3); // no more retries
		expect(obs.endError).toBe(finalErr);
	});

	it("forwards normal completion downstream", () => {
		const src = producer<number>(({ emit }) => {
			emit(1);
		});

		const r = pipe(src, retry(3));
		const obs = Inspector.observe(r);

		src.complete(); // normal completion — no error
		expect(obs.completedCleanly).toBe(true);
	});

	// --- Enhanced retry with options ---

	it("retry({ count }) works like retry(n)", () => {
		let producerCount = 0;
		let errorSink: ((type: number, data?: unknown) => void) | null = null;
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

		const r = pipe(src, retry({ count: 2 }));
		const obs = Inspector.observe(r);

		errorSink?.(2, new Error("fail"));
		expect(producerCount).toBe(2); // retried once

		errorSink?.(2, new Error("fail"));
		expect(producerCount).toBe(3); // retried twice

		errorSink?.(2, new Error("final"));
		expect(producerCount).toBe(3); // no more
		expect(obs.endError).toBeInstanceOf(Error);
	});

	it("retry({ delay: constant }) delays before reconnect", () => {
		let producerCount = 0;
		let errorSink: ((type: number, data?: unknown) => void) | null = null;
		const src = {
			get() {
				return 0;
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

		const r = pipe(src, retry({ count: 3, delay: backoffConstant(1000) }));
		Inspector.activate(r);

		expect(producerCount).toBe(1);
		errorSink?.(2, new Error("fail"));
		// Not yet reconnected — waiting for delay
		expect(producerCount).toBe(1);
		vi.advanceTimersByTime(1000);
		expect(producerCount).toBe(2); // reconnected after delay
	});

	it("retry({ while }) stops retrying when predicate returns false", () => {
		let producerCount = 0;
		let errorSink: ((type: number, data?: unknown) => void) | null = null;
		const src = {
			get() {
				return 0;
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

		const r = pipe(
			src,
			retry({
				count: 10,
				while: (err) => (err as Error).message !== "fatal",
			}),
		);
		const obs = Inspector.observe(r);

		errorSink?.(2, new Error("transient"));
		expect(producerCount).toBe(2); // retried

		errorSink?.(2, new Error("fatal"));
		expect(producerCount).toBe(2); // NOT retried
		expect((obs.endError as Error).message).toBe("fatal");
	});

	it("retry cleans up timer on teardown", () => {
		let errorSink: ((type: number, data?: unknown) => void) | null = null;
		const src = {
			get() {
				return 0;
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

		const r = pipe(src, retry({ count: 3, delay: backoffConstant(5000) }));
		const dispose = Inspector.activate(r);

		errorSink?.(2, new Error("fail"));
		// Timer is pending — unsubscribe should clean it up
		dispose();
		// No errors should occur when timer fires
		vi.advanceTimersByTime(10_000);
	});
});

// ---------------------------------------------------------------------------
// rescue
// ---------------------------------------------------------------------------

describe("rescue", () => {
	it("passes through values normally when no error", () => {
		const s = state(1);
		const r = pipe(
			s,
			rescue(() => state(0)),
		);
		const values: number[] = [];
		subscribe(r, (v) => values.push(v));

		s.set(2);
		expect(values).toEqual([2]);
	});

	it("tears down on unsubscribe", () => {
		const s = state(1);
		const r = pipe(
			s,
			rescue(() => state(0)),
		);
		const unsub = subscribe(r, () => {});
		unsub.unsubscribe();
		// must not throw
	});

	it("get() reflects current value", () => {
		const s = state(42);
		const r = pipe(
			s,
			rescue(() => state(0)),
		);
		subscribe(r, () => {});
		expect(r.get()).toBe(42);
	});

	it("switches to fallback on error and receives error arg", () => {
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
		let receivedError: unknown;
		const r = pipe(
			src,
			rescue((err) => {
				receivedError = err;
				return fallback;
			}),
		);

		const values: number[] = [];
		subscribe(r, (v) => values.push(v));

		// Trigger error via END with data
		const err = new Error("boom");
		errorSink?.(2, err);

		expect(receivedError).toBe(err);
		expect(r.get()).toBe(99);

		// Rescue emits fallback initial value when switching
		expect(values).toEqual([99]);

		// Fallback should be live
		fallback.set(100);
		expect(values).toEqual([99, 100]);
	});

	it("forwards normal completion from source", () => {
		const src = producer<number>(({ emit }) => {
			emit(1);
		});

		const r = pipe(
			src,
			rescue(() => state(0)),
		);
		const obs = Inspector.observe(r);

		src.complete();
		expect(obs.completedCleanly).toBe(true);
	});

	it("forwards normal completion from fallback", () => {
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

		const fallback = producer<number>(({ emit }) => {
			emit(42);
		});

		const r = pipe(
			src,
			rescue(() => fallback),
		);
		const obs = Inspector.observe(r);

		// Error on src → switch to fallback
		errorSink?.(2, new Error("fail"));
		// Normal completion on fallback → should forward
		fallback.complete();
		expect(obs.completedCleanly).toBe(true);
	});
});
