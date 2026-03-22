import { describe, expect, it, vi } from "vitest";
import { Inspector } from "../../core/inspector";
import { batchWriter } from "../../utils/batchWriter";

// ---------------------------------------------------------------------------
// Batch writer tests
// ---------------------------------------------------------------------------
describe("batchWriter", () => {
	it("flushes when batch reaches maxSize", () => {
		const flushed: number[][] = [];
		const w = batchWriter<number>({
			maxSize: 3,
			onFlush: (items) => {
				flushed.push([...items]);
			},
		});

		w.add(1);
		w.add(2);
		expect(flushed).toEqual([]);
		expect(w.size.get()).toBe(2);

		w.add(3);
		expect(flushed).toEqual([[1, 2, 3]]);
		expect(w.size.get()).toBe(0);
		expect(w.totalFlushed.get()).toBe(3);
	});

	it("flushes after maxWaitMs since first item", () => {
		vi.useFakeTimers();
		const flushed: string[][] = [];
		const w = batchWriter<string>({
			maxSize: 100,
			maxWaitMs: 500,
			onFlush: (items) => {
				flushed.push([...items]);
			},
		});

		w.add("a");
		w.add("b");
		expect(flushed).toEqual([]);

		vi.advanceTimersByTime(500);
		expect(flushed).toEqual([["a", "b"]]);
		expect(w.size.get()).toBe(0);
		expect(w.totalFlushed.get()).toBe(2);

		vi.useRealTimers();
	});

	it("manual flush sends current batch immediately", () => {
		const flushed: number[][] = [];
		const w = batchWriter<number>({
			maxSize: 100,
			onFlush: (items) => {
				flushed.push([...items]);
			},
		});

		w.add(1);
		w.add(2);
		w.flush();
		expect(flushed).toEqual([[1, 2]]);
		expect(w.size.get()).toBe(0);
	});

	it("flush on empty batch does nothing", () => {
		let flushCount = 0;
		const w = batchWriter<number>({
			maxSize: 10,
			onFlush: () => {
				flushCount++;
			},
		});

		w.flush();
		expect(flushCount).toBe(0);
	});

	it("stop flushes remaining items", () => {
		const flushed: number[][] = [];
		const w = batchWriter<number>({
			maxSize: 100,
			onFlush: (items) => {
				flushed.push([...items]);
			},
		});

		w.add(1);
		w.add(2);
		w.stop();
		expect(flushed).toEqual([[1, 2]]);
	});

	it("add after stop is ignored", () => {
		const flushed: number[][] = [];
		const w = batchWriter<number>({
			maxSize: 100,
			onFlush: (items) => {
				flushed.push([...items]);
			},
		});

		w.stop();
		w.add(1);
		expect(flushed).toEqual([]);
		expect(w.size.get()).toBe(0);
	});

	it("tracks flushing state for async onFlush", async () => {
		vi.useFakeTimers();
		let resolveFlush!: () => void;
		const w = batchWriter<number>({
			maxSize: 2,
			onFlush: () =>
				new Promise<void>((resolve) => {
					resolveFlush = resolve;
				}),
		});

		expect(w.flushing.get()).toBe(false);

		w.add(1);
		w.add(2); // triggers flush

		expect(w.flushing.get()).toBe(true);

		resolveFlush();
		await vi.advanceTimersByTimeAsync(0); // flush microtasks

		expect(w.flushing.get()).toBe(false);
		expect(w.totalFlushed.get()).toBe(2);

		vi.useRealTimers();
	});

	it("totalFlushed accumulates across multiple flushes", () => {
		const w = batchWriter<number>({
			maxSize: 2,
			onFlush: () => {},
		});

		w.add(1);
		w.add(2); // flush (2 items)
		w.add(3);
		w.add(4); // flush (2 items)
		w.add(5);
		w.flush(); // flush (1 item)

		expect(w.totalFlushed.get()).toBe(5);
	});

	it("size store is reactive", () => {
		const w = batchWriter<number>({
			maxSize: 10,
			onFlush: () => {},
		});

		const obs = Inspector.observe(w.size);

		w.add(1);
		w.add(2);
		w.add(3);
		w.flush();

		// 3 adds + flush resets to 0 (initial value not emitted on subscribe)
		expect(obs.values).toEqual([1, 2, 3, 0]);

		obs.dispose();
	});

	it("clears maxWaitMs timer when flushed by size", () => {
		vi.useFakeTimers();
		let flushCount = 0;
		const w = batchWriter<number>({
			maxSize: 2,
			maxWaitMs: 1000,
			onFlush: () => {
				flushCount++;
			},
		});

		w.add(1);
		w.add(2); // triggers size flush, should clear wait timer
		expect(flushCount).toBe(1);

		// Timer should not fire again
		vi.advanceTimersByTime(1000);
		expect(flushCount).toBe(1);

		vi.useRealTimers();
	});

	it("handles async onFlush error gracefully", async () => {
		vi.useFakeTimers();
		const w = batchWriter<number>({
			maxSize: 2,
			onFlush: async () => {
				throw new Error("flush error");
			},
		});

		w.add(1);
		w.add(2); // triggers flush
		expect(w.flushing.get()).toBe(true);

		await vi.advanceTimersByTimeAsync(0); // flush microtasks

		// Should recover — flushing back to false, items counted
		expect(w.flushing.get()).toBe(false);
		expect(w.totalFlushed.get()).toBe(2);

		vi.useRealTimers();
	});
});
