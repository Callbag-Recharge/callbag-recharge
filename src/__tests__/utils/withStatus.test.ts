import { describe, expect, it } from "vitest";
import { producer } from "../../core/producer";
import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";
import { withStatus } from "../../utils/withStatus";

describe("withStatus", () => {
	it("starts with pending status and undefined error", () => {
		const s = producer<number>(() => {});
		const tracked = withStatus(s);
		expect(tracked.status.get()).toBe("pending");
		expect(tracked.error.get()).toBeUndefined();
	});

	it("transitions to active on first DATA", () => {
		let _emit!: (v: number) => void;
		const s = producer<number>(({ emit }) => {
			_emit = emit;
		});
		const tracked = withStatus(s);

		const values: number[] = [];
		subscribe(tracked, (v) => values.push(v));

		_emit(42);
		expect(tracked.status.get()).toBe("active");
		expect(values).toEqual([42]);
	});

	it("transitions to completed on END", () => {
		let _emit!: (v: number) => void;
		let _complete!: () => void;
		const s = producer<number>(({ emit, complete }) => {
			_emit = emit;
			_complete = complete;
		});
		const tracked = withStatus(s);

		subscribe(tracked, () => {});
		_emit(1);
		_complete();

		expect(tracked.status.get()).toBe("completed");
		expect(tracked.error.get()).toBeUndefined();
	});

	it("transitions to errored on END with error", () => {
		let _error!: (e: unknown) => void;
		const s = producer<number>(({ error }) => {
			_error = error;
		});
		const tracked = withStatus(s);

		subscribe(tracked, () => {}, { onEnd: () => {} });
		_error(new Error("boom"));

		expect(tracked.status.get()).toBe("errored");
		expect(tracked.error.get()).toBeInstanceOf(Error);
		expect(tracked.error.get()!.message).toBe("boom");
	});

	it("wraps non-Error values in Error on error", () => {
		let _error!: (e: unknown) => void;
		const s = producer<number>(({ error }) => {
			_error = error;
		});
		const tracked = withStatus(s);

		subscribe(tracked, () => {}, { onEnd: () => {} });
		_error("string error");

		expect(tracked.error.get()).toBeInstanceOf(Error);
		expect(tracked.error.get()!.message).toBe("string error");
	});

	it("forwards get() from upstream", () => {
		const s = state(0);
		const tracked = withStatus(s);
		expect(tracked.get()).toBe(0);

		s.set(5);
		expect(tracked.get()).toBe(5);
	});

	it("forwards DATA to downstream subscribers", () => {
		let _emit!: (v: number) => void;
		const s = producer<number>(({ emit }) => {
			_emit = emit;
		});
		const tracked = withStatus(s);

		const values: number[] = [];
		subscribe(tracked, (v) => values.push(v));

		_emit(1);
		_emit(2);
		_emit(3);

		expect(values).toEqual([1, 2, 3]);
	});

	it("companions are subscribable stores", () => {
		let _emit!: (v: number) => void;
		const s = producer<number>(({ emit }) => {
			_emit = emit;
		});
		const tracked = withStatus(s);

		const statuses: string[] = [];
		subscribe(tracked.status, (s) => statuses.push(s));
		subscribe(tracked, () => {});

		_emit(1);

		expect(statuses).toContain("active");
	});

	it("stays pending for state() since subscribe does not emit initial value", () => {
		const s = state(0);
		const tracked = withStatus(s);

		expect(tracked.status.get()).toBe("pending");

		s.set(1);
		// Status stays pending until tracked has a subscriber
		const values: number[] = [];
		subscribe(tracked, (v) => values.push(v));
		s.set(2);
		expect(tracked.status.get()).toBe("active");
	});

	it("supports initialStatus option for pre-populated stores", () => {
		const s = state(42);
		const tracked = withStatus(s, { initialStatus: "active" });
		expect(tracked.status.get()).toBe("active");
	});

	it("cleans up upstream subscription when all sinks disconnect", () => {
		let initCount = 0;
		let cleanupCount = 0;
		const s = producer<number>(() => {
			initCount++;
			return () => {
				cleanupCount++;
			};
		});
		const tracked = withStatus(s);

		const unsub = subscribe(tracked, () => {});
		expect(initCount).toBe(1);

		unsub.unsubscribe();
		expect(cleanupCount).toBe(1);
	});

	it("does not mutate the original store", () => {
		const s = producer<number>(() => {});
		withStatus(s);

		// The returned store is a new producer, not the original
		expect((s as any).status).toBeUndefined();
	});
});
