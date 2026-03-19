import { describe, expect, it, vi } from "vitest";
import { subscribe } from "../../../core/subscribe";
import { cancellableStream, fromAbortable } from "../../../utils/cancellableStream";

// Helper: async iterable that yields values with optional delay
async function* yieldValues<T>(values: T[], signal?: AbortSignal): AsyncIterable<T> {
	for (const v of values) {
		if (signal?.aborted) return;
		yield v;
	}
}

// Helper: async iterable that yields values with delays
async function* yieldDelayed<T>(
	values: T[],
	delayMs: number,
	signal?: AbortSignal,
): AsyncIterable<T> {
	for (const v of values) {
		if (signal?.aborted) return;
		await new Promise((r) => setTimeout(r, delayMs));
		if (signal?.aborted) return;
		yield v;
	}
}

// ---------------------------------------------------------------------------
// cancellableStream
// ---------------------------------------------------------------------------
describe("cancellableStream", () => {
	it("emits values from async iterable", async () => {
		const stream = cancellableStream<string>();
		const values: (string | undefined)[] = [];
		const unsub = subscribe(stream.store, (v) => values.push(v));

		stream.start((signal) => yieldValues(["a", "b", "c"], signal));
		await new Promise((r) => setTimeout(r, 50));

		expect(values).toContain("a");
		expect(values).toContain("b");
		expect(values).toContain("c");
		unsub();
	});

	it("tracks active state", async () => {
		const stream = cancellableStream<string>();
		expect(stream.active.get()).toBe(false);

		stream.start((signal) => yieldDelayed(["a", "b"], 50, signal));
		expect(stream.active.get()).toBe(true);

		await new Promise((r) => setTimeout(r, 200));
		expect(stream.active.get()).toBe(false);
	});

	it("cancel aborts the current stream", async () => {
		const aborted = vi.fn();
		const stream = cancellableStream<string>();

		stream.start(async function* (signal) {
			signal.addEventListener("abort", aborted);
			yield "a";
			await new Promise((r) => setTimeout(r, 500));
			yield "b";
		});

		await new Promise((r) => setTimeout(r, 20));
		stream.cancel();

		expect(aborted).toHaveBeenCalled();
		expect(stream.active.get()).toBe(false);
	});

	it("start cancels previous stream (auto-cancel-previous)", async () => {
		const stream = cancellableStream<number>();
		const abortedFirst = vi.fn();

		stream.start(async function* (signal) {
			signal.addEventListener("abort", abortedFirst);
			yield 1;
			await new Promise((r) => setTimeout(r, 500));
			yield 2;
		});

		await new Promise((r) => setTimeout(r, 20));
		stream.start((signal) => yieldValues([10, 20], signal));
		await new Promise((r) => setTimeout(r, 50));

		expect(abortedFirst).toHaveBeenCalled();
		expect(stream.store.get()).toBe(20);
	});

	it("calls onComplete when stream finishes", async () => {
		const onComplete = vi.fn();
		const stream = cancellableStream<string>({ onComplete });

		stream.start((signal) => yieldValues(["a"], signal));
		await new Promise((r) => setTimeout(r, 50));

		expect(onComplete).toHaveBeenCalled();
	});

	it("calls onError on stream error", async () => {
		const onError = vi.fn();
		const stream = cancellableStream<string>({ onError });

		stream.start(async function* () {
			yield "before-error";
			throw new Error("boom");
		});
		await new Promise((r) => setTimeout(r, 50));

		expect(onError).toHaveBeenCalledWith(expect.any(Error));
	});

	it("supports initial value", () => {
		const stream = cancellableStream<string>({ initial: "init" });
		expect(stream.store.get()).toBe("init");
	});
});

// ---------------------------------------------------------------------------
// fromAbortable
// ---------------------------------------------------------------------------
describe("fromAbortable", () => {
	it("emits values and completes", async () => {
		const values: (string | undefined)[] = [];
		const store = fromAbortable<string>((signal) => yieldValues(["x", "y"], signal));

		const unsub = subscribe(store, (v) => values.push(v));
		await new Promise((r) => setTimeout(r, 50));

		expect(values).toContain("x");
		expect(values).toContain("y");
		unsub();
	});

	it("aborts on unsubscribe", async () => {
		const aborted = vi.fn();
		const store = fromAbortable<string>(async function* (signal) {
			signal.addEventListener("abort", aborted);
			yield "a";
			await new Promise((r) => setTimeout(r, 500));
			yield "b";
		});

		const unsub = subscribe(store, () => {});
		await new Promise((r) => setTimeout(r, 20));
		unsub();

		expect(aborted).toHaveBeenCalled();
	});

	it("supports initial value", () => {
		const store = fromAbortable<string>((signal) => yieldValues([], signal), {
			initial: "init",
		});
		expect(store.get()).toBe("init");
	});
});
