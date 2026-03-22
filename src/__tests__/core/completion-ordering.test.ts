/**
 * Tests for completion ordering, upstream disconnect on operator complete/error,
 * and snapshot-free completion reentrancy safety.
 *
 * These cover correctness issues identified during code review of the
 * _flags bitmask and snapshot-free completion optimizations.
 */
import { describe, expect, it, vi } from "vitest";
import { Inspector } from "../../core/inspector";
import { DATA, END, START, STATE } from "../../core/protocol";
import { subscribe } from "../../extra/subscribe";
import { derived, effect, operator, producer, state } from "../../index";

describe("operator complete/error disconnects upstream", () => {
	it("complete() sends END to upstream deps", () => {
		const upstreamTalkbackEnd = vi.fn();
		const s = state(0);

		// Wrap state in a custom source that tracks talkback END
		const trackedSource = (type: number, sink?: any) => {
			if (type === START) {
				s.source(START, (t: number, d: any) => {
					if (t === START) {
						const origTb = d;
						sink(START, (tt: number) => {
							if (tt === END) upstreamTalkbackEnd();
							origTb(tt);
						});
						return;
					}
					sink(t, d);
				});
			}
		};

		const op = operator<number>(
			[{ get: () => s.get(), source: trackedSource } as any],
			(actions) => {
				return (_depIndex, type, data) => {
					if (type === DATA) {
						actions.emit(data);
						actions.complete();
					}
					if (type === STATE) actions.signal(data);
				};
			},
			{ initial: 0 },
		);

		const obs = Inspector.observe(op);

		// Trigger a value that causes complete
		s.set(42);

		expect(upstreamTalkbackEnd).toHaveBeenCalledTimes(1);
		expect(obs.values).toEqual([42]);
	});

	it("error() sends END to upstream deps", () => {
		const upstreamTalkbackEnd = vi.fn();
		const s = state(0);

		const trackedSource = (type: number, sink?: any) => {
			if (type === START) {
				s.source(START, (t: number, d: any) => {
					if (t === START) {
						const origTb = d;
						sink(START, (tt: number) => {
							if (tt === END) upstreamTalkbackEnd();
							origTb(tt);
						});
						return;
					}
					sink(t, d);
				});
			}
		};

		const op = operator<string>(
			[{ get: () => String(s.get()), source: trackedSource } as any],
			(actions) => {
				return (_depIndex, type, _data) => {
					if (type === DATA) {
						actions.error(new Error("test"));
					}
					if (type === STATE) actions.signal(_data);
				};
			},
			{ initial: "" },
		);

		const obs = Inspector.observe(op);

		s.set(1);

		expect(upstreamTalkbackEnd).toHaveBeenCalledTimes(1);
		expect(obs.errored).toBe(true);
		expect(obs.endError).toBeInstanceOf(Error);
	});

	it("complete() disconnects multiple upstream deps", () => {
		const tb1End = vi.fn();
		const tb2End = vi.fn();
		const s1 = state(0);
		const s2 = state(0);

		const track = (s: any, onEnd: () => void) => (type: number, sink?: any) => {
			if (type === START) {
				s.source(START, (t: number, d: any) => {
					if (t === START) {
						const origTb = d;
						sink(START, (tt: number) => {
							if (tt === END) onEnd();
							origTb(tt);
						});
						return;
					}
					sink(t, d);
				});
			}
		};

		const op = operator<number>(
			[
				{ get: () => s1.get(), source: track(s1, tb1End) } as any,
				{ get: () => s2.get(), source: track(s2, tb2End) } as any,
			],
			(actions) => {
				return (_depIndex, type, data) => {
					if (type === DATA) actions.complete();
					if (type === STATE) actions.signal(data);
				};
			},
			{ initial: 0 },
		);

		Inspector.activate(op);

		// Trigger completion from dep 0
		s1.set(1);

		expect(tb1End).toHaveBeenCalledTimes(1);
		expect(tb2End).toHaveBeenCalledTimes(1);
	});

	it("upstream events after complete() are ignored (handler is null)", () => {
		const s = state(0);
		let shouldComplete = false;

		const op = operator<number>(
			[s],
			(actions) => {
				return (_depIndex, type, data) => {
					if (type === DATA) {
						if (shouldComplete) {
							actions.complete();
						} else {
							actions.emit(data);
						}
					}
					if (type === STATE) actions.signal(data);
				};
			},
			{ initial: 0 },
		);

		const obs = Inspector.observe(op);

		s.set(1);
		expect(obs.values).toEqual([1]);

		shouldComplete = true;
		s.set(999); // triggers complete

		s.set(2); // should be ignored — handler is null, operator is completed

		expect(obs.values).toEqual([1]);
	});
});

describe("snapshot-free completion reentrancy", () => {
	it("producer: sink re-subscribes during END with resubscribable", () => {
		let emitFn: ((v: number) => void) | undefined;
		let completeFn: (() => void) | undefined;
		let startCount = 0;

		const p = producer<number>(
			({ emit, complete }) => {
				startCount++;
				emitFn = emit;
				completeFn = complete;
				return undefined;
			},
			{ initial: 0, resubscribable: true },
		);

		const values: number[] = [];
		let endCount = 0;

		// First subscription
		subscribe(p, (v) => values.push(v), {
			onEnd: () => {
				endCount++;
				if (endCount === 1) {
					// Re-subscribe during END notification
					subscribe(p, (v) => values.push(v * 10));
				}
			},
		});

		// After deferred start, producer fn has been called
		expect(startCount).toBe(1);

		emitFn!(5);
		expect(values).toEqual([5]);

		completeFn!();
		expect(endCount).toBe(1);
		// Re-subscription should have caused a new start
		expect(startCount).toBe(2);

		// Emit on the new subscription
		emitFn!(7);
		expect(values).toEqual([5, 70]);
	});

	it("producer: completed producer rejects new sinks (non-resubscribable)", () => {
		let completeFn: (() => void) | undefined;

		const p = producer<number>(
			({ complete }) => {
				completeFn = complete;
				return undefined;
			},
			{ initial: 0 },
		);

		let ended1 = false;
		subscribe(p, () => {}, { onEnd: () => (ended1 = true) });

		// completeFn is assigned during deferred start
		expect(completeFn).toBeDefined();

		completeFn!();
		expect(ended1).toBe(true);

		// New subscription should get immediate END
		let ended2 = false;
		subscribe(p, () => {}, { onEnd: () => (ended2 = true) });
		expect(ended2).toBe(true);
	});

	it("operator: sink re-subscribes during END with resubscribable", () => {
		const s = state(0);
		let completeFn: (() => void) | undefined;
		let initCount = 0;

		const op = operator<number>(
			[s],
			(actions) => {
				initCount++;
				completeFn = () => actions.complete();
				return (_depIndex, type, data) => {
					if (type === DATA) actions.emit(data);
					if (type === STATE) actions.signal(data);
				};
			},
			{ initial: 0, resubscribable: true },
		);

		const values: number[] = [];
		let endCount = 0;

		subscribe(op, (v) => values.push(v), {
			onEnd: () => {
				endCount++;
				if (endCount === 1) {
					subscribe(op, (v) => values.push(v * 10));
				}
			},
		});

		expect(initCount).toBe(1);

		s.set(3);
		expect(values).toEqual([3]);

		completeFn!();
		expect(endCount).toBe(1);
		expect(initCount).toBe(2);

		s.set(4);
		expect(values).toEqual([3, 40]);
	});
});

describe("producer completion ordering", () => {
	it("cleanup runs before sinks receive END", () => {
		const order: string[] = [];
		let completeFn: (() => void) | undefined;

		const p = producer<number>(
			({ emit, complete }) => {
				emit(1);
				completeFn = complete;
				return () => {
					order.push("cleanup");
				};
			},
			{ initial: 0 },
		);

		subscribe(p, () => {}, {
			onEnd: () => order.push("sink-end"),
		});

		completeFn!();

		// Cleanup-first ordering: cleanup runs, then sinks notified
		expect(order).toEqual(["cleanup", "sink-end"]);
	});

	it("resetOnTeardown resets value before END notification", () => {
		let completeFn: (() => void) | undefined;

		const p = producer<number>(
			({ emit, complete }) => {
				emit(42);
				completeFn = complete;
				return undefined;
			},
			{ initial: 0, resetOnTeardown: true },
		);

		let valueAtEnd: number | undefined;
		subscribe(p, () => {}, {
			onEnd: () => {
				valueAtEnd = p.get();
			},
		});

		completeFn!();
		// Cleanup-first ordering means value is reset before END is sent
		expect(valueAtEnd).toBe(0);
	});
});

describe("operator resetOnTeardown on complete/error", () => {
	it("complete() resets value to initial when resetOnTeardown is true", () => {
		const s = state(0);
		let completeFn: (() => void) | undefined;

		const op = operator<number>(
			[s],
			(actions) => {
				completeFn = () => actions.complete();
				return (_dep, type, data) => {
					if (type === DATA) actions.emit(data);
					if (type === STATE) actions.signal(data);
				};
			},
			{ initial: -1, resetOnTeardown: true },
		);

		Inspector.activate(op);
		s.set(42);
		expect(op.get()).toBe(42);

		completeFn!();
		// After completion with resetOnTeardown, value should be reset to initial
		expect(op.get()).toBe(-1);
	});

	it("error() resets value to initial when resetOnTeardown is true", () => {
		const s = state(0);
		let errorFn: ((e: unknown) => void) | undefined;

		const op = operator<number>(
			[s],
			(actions) => {
				errorFn = (e) => actions.error(e);
				return (_dep, type, data) => {
					if (type === DATA) actions.emit(data);
					if (type === STATE) actions.signal(data);
				};
			},
			{ initial: -1, resetOnTeardown: true },
		);

		Inspector.activate(op);
		s.set(42);
		expect(op.get()).toBe(42);

		errorFn!(new Error("boom"));
		expect(op.get()).toBe(-1);
	});

	it("complete() preserves value when resetOnTeardown is false", () => {
		const s = state(0);
		let completeFn: (() => void) | undefined;

		const op = operator<number>(
			[s],
			(actions) => {
				completeFn = () => actions.complete();
				return (_dep, type, data) => {
					if (type === DATA) actions.emit(data);
					if (type === STATE) actions.signal(data);
				};
			},
			{ initial: -1 },
		);

		Inspector.activate(op);
		s.set(42);
		completeFn!();
		// Without resetOnTeardown, value should be preserved
		expect(op.get()).toBe(42);
	});
});

describe("derived handles upstream END", () => {
	it("dep completion → derived sends END to sinks", () => {
		let completeFn: (() => void) | undefined;

		const p = producer<number>(
			({ emit, complete }) => {
				emit(5);
				completeFn = complete;
				return undefined;
			},
			{ initial: 0 },
		);

		const d = derived([p], () => p.get()! * 2);
		const obs = Inspector.observe(d);

		expect(obs.ended).toBe(false);
		completeFn!();
		expect(obs.ended).toBe(true);
	});

	it("dep error → derived sends END with error to sinks", () => {
		let errorFn: ((e: unknown) => void) | undefined;

		const p = producer<number>(
			({ emit, error }) => {
				emit(5);
				errorFn = error;
				return undefined;
			},
			{ initial: 0 },
		);

		const d = derived([p], () => p.get()! * 2);
		const obs = Inspector.observe(d);

		errorFn!(new Error("upstream failed"));
		expect(obs.endError).toBeInstanceOf(Error);
		expect((obs.endError as Error).message).toBe("upstream failed");
	});

	it("after dep END, get() returns cached value (recomputes from dep cache)", () => {
		let emitFn: ((v: number) => void) | undefined;
		let completeFn: (() => void) | undefined;

		const p = producer<number>(
			({ emit, complete }) => {
				emitFn = emit;
				completeFn = complete;
				return undefined;
			},
			{ initial: 5 },
		);

		const d = derived([p], () => p.get()! * 2);
		Inspector.activate(d);

		emitFn!(10);
		expect(d.get()).toBe(20);

		completeFn!();
		// After completion, derived is disconnected. get() recomputes via fn(),
		// which calls p.get() → 10 (producer retains value). 10 * 2 = 20.
		expect(d.get()).toBe(20);
	});

	it("late subscriber to completed derived gets END immediately", () => {
		let completeFn: (() => void) | undefined;

		const p = producer<number>(
			({ complete }) => {
				completeFn = complete;
				return undefined;
			},
			{ initial: 0 },
		);

		const d = derived([p], () => p.get()!);
		Inspector.activate(d);

		completeFn!();

		// New subscription after derived completed
		const obs2 = Inspector.observe(d);
		expect(obs2.ended).toBe(true);
	});

	it("dep END disconnects all deps", () => {
		const tb1End = vi.fn();
		const tb2End = vi.fn();
		const s1 = state(0);
		let completeFn: (() => void) | undefined;
		const p = producer<number>(
			({ emit, complete }) => {
				emit(1);
				completeFn = complete;
				return undefined;
			},
			{ initial: 0 },
		);

		// Track talkback END on s1
		const trackedS1 = {
			get: () => s1.get(),
			source: (type: number, sink: any) => {
				if (type === START) {
					s1.source(START, (t: number, d: any) => {
						if (t === START) {
							const origTb = d;
							sink(START, (tt: number) => {
								if (tt === END) tb1End();
								origTb(tt);
							});
							return;
						}
						sink(t, d);
					});
				}
			},
		};

		// Track talkback END on p
		const trackedP = {
			get: () => p.get(),
			source: (type: number, sink: any) => {
				if (type === START) {
					p.source(START, (t: number, d: any) => {
						if (t === START) {
							const origTb = d;
							sink(START, (tt: number) => {
								if (tt === END) tb2End();
								origTb(tt);
							});
							return;
						}
						sink(t, d);
					});
				}
			},
		};

		const d = derived([trackedS1 as any, trackedP as any], () => (s1.get() ?? 0) + (p.get() ?? 0));
		Inspector.activate(d);

		// Complete p → derived should disconnect both deps
		completeFn!();
		expect(tb1End).toHaveBeenCalledTimes(1);
		expect(tb2End).toHaveBeenCalledTimes(1);
	});

	it("dep completes during initial connection → correct START then END order", () => {
		// Create an already-completed producer
		let completeFn: (() => void) | undefined;
		const p = producer<number>(
			({ complete }) => {
				completeFn = complete;
				return undefined;
			},
			{ initial: 0 },
		);
		// Subscribe and complete immediately
		Inspector.activate(p);
		completeFn!();

		// Now p is completed. Derived from p should get END during connection.
		const d = derived([p], () => p.get()!);

		const order: string[] = [];
		d.source(START, (type: number, _data: any) => {
			if (type === START) order.push("start");
			if (type === END) order.push("end");
		});

		// Protocol order must be START then END
		expect(order).toEqual(["start", "end"]);
	});
});

describe("effect handles upstream END", () => {
	it("dep completion → effect disposes (cleanup runs)", () => {
		let completeFn: (() => void) | undefined;
		const cleanupFn = vi.fn();

		const p = producer<number>(
			({ complete }) => {
				completeFn = complete;
				return undefined;
			},
			{ initial: 0 },
		);

		effect([p], () => {
			p.get();
			return cleanupFn;
		});

		// Only the initial run happened — no cleanup yet
		expect(cleanupFn).not.toHaveBeenCalled();

		completeFn!();
		// Effect should auto-dispose: cleanup from the initial run fires
		expect(cleanupFn).toHaveBeenCalledTimes(1);
	});

	it("dep error → effect disposes (cleanup runs)", () => {
		let errorFn: ((e: unknown) => void) | undefined;
		const cleanupFn = vi.fn();

		const p = producer<number>(
			({ error }) => {
				errorFn = error;
				return undefined;
			},
			{ initial: 0 },
		);

		effect([p], () => {
			p.get();
			return cleanupFn;
		});

		expect(cleanupFn).not.toHaveBeenCalled();

		errorFn!(new Error("boom"));
		// Cleanup from initial run fires on dispose
		expect(cleanupFn).toHaveBeenCalledTimes(1);
	});

	it("after dep END, effect ignores further events from other deps", () => {
		let completeFn: (() => void) | undefined;
		let runCount = 0;

		const p = producer<number>(
			({ complete }) => {
				completeFn = complete;
				return undefined;
			},
			{ initial: 0 },
		);
		const s = state(0);

		effect([p, s], () => {
			p.get();
			s.get();
			runCount++;
			return undefined;
		});

		expect(runCount).toBe(1); // initial run only

		// Complete p → effect disposes
		completeFn!();

		// Changes to s should not trigger the effect
		s.set(1);
		s.set(2);
		expect(runCount).toBe(1);
	});

	it("effect cleanup runs on dispose (manual)", () => {
		const s = state(0);
		const cleanupFn = vi.fn();

		const dispose = effect([s], () => {
			s.get();
			return cleanupFn;
		});

		expect(cleanupFn).not.toHaveBeenCalled();

		s.set(1);
		expect(cleanupFn).toHaveBeenCalledTimes(1); // cleanup from first run

		dispose();
		expect(cleanupFn).toHaveBeenCalledTimes(2); // cleanup from second run
	});

	it("effect ignores events after dispose (manual)", () => {
		const s = state(0);
		let runCount = 0;

		const dispose = effect([s], () => {
			s.get();
			runCount++;
			return undefined;
		});

		expect(runCount).toBe(1);

		dispose();

		s.set(1);
		expect(runCount).toBe(1); // no re-run after dispose
	});
});

describe("effect handles DATA without prior DIRTY (raw callbag source)", () => {
	it("raw callbag source sends DATA without DIRTY → effect runs", () => {
		let _rawEmit: ((v: number) => void) | undefined;
		const rawSource = {
			get: () => 0,
			source: (type: number, sink: any) => {
				if (type === START) {
					sink(START, () => {});
					_rawEmit = (v: number) => sink(DATA, v);
				}
			},
		};

		let runCount = 0;
		let _lastValue: number | undefined;

		effect([rawSource as any], () => {
			_lastValue = rawSource.get();
			runCount++;
			return undefined;
		});

		expect(runCount).toBe(1); // initial run

		_rawEmit!(42);
		expect(runCount).toBe(2); // DATA without DIRTY triggers effect
	});

	it("raw callbag DATA while other deps are dirty → marks data received", () => {
		const s = state(0);
		let _rawEmit: ((v: number) => void) | undefined;
		const rawSource = {
			get: () => 0,
			source: (type: number, sink: any) => {
				if (type === START) {
					sink(START, () => {});
					_rawEmit = (v: number) => sink(DATA, v);
				}
			},
		};

		let runCount = 0;

		effect([s, rawSource as any], () => {
			s.get();
			runCount++;
			return undefined;
		});

		expect(runCount).toBe(1); // initial run

		// s.set triggers DIRTY for dep 0, then when raw source sends DATA
		// for dep 1, it should mark anyDataReceived and eventually run
		s.set(1);
		expect(runCount).toBe(2);
	});
});

describe("operator source() protocol ordering", () => {
	it("sink receives START before END when dep is already completed", () => {
		// Create an operator that completes during init
		const s = state(0);
		const op = operator<number>(
			[s],
			(actions) => {
				actions.complete(); // complete during init
				return () => {};
			},
			{ initial: 0 },
		);

		const order: string[] = [];
		op.source(START, (type: number, _data: any) => {
			if (type === START) order.push("start");
			if (type === END) order.push("end");
		});

		expect(order).toEqual(["start", "end"]);
	});

	it("init-time complete() stops dep connection loop — no resource leak", () => {
		// If _init() calls complete(), the dep loop must break early.
		// Without the fix, all deps get subscribed but never unsubscribed.
		let subscribeCount = 0;
		let unsubscribeCount = 0;

		const s = state(0);
		const tracked = {
			get: () => s.get(),
			source: (type: number, sink: any) => {
				if (type === START) {
					subscribeCount++;
					s.source(START, (t: number, d: any) => {
						if (t === START) {
							const origTb = d;
							sink(START, (tt: number) => {
								if (tt === END) unsubscribeCount++;
								origTb(tt);
							});
							return;
						}
						sink(t, d);
					});
				}
			},
		};

		const op = operator<number>(
			[tracked as any],
			(actions) => {
				actions.complete(); // complete before dep loop runs
				return () => {};
			},
			{ initial: 0 },
		);

		Inspector.activate(op);

		// Dep should never have been subscribed (loop broke at i=0)
		expect(subscribeCount).toBe(0);
		expect(unsubscribeCount).toBe(0);
	});
});
