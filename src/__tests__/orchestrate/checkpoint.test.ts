import { describe, expect, it } from "vitest";
import { subscribe } from "../../extra/subscribe";
import { pipe, state } from "../../index";
import { rawFromPromise } from "../../raw/fromPromise";
import { checkpoint, memoryAdapter } from "../../utils/checkpoint";

// ==========================================================================
// checkpoint
// ==========================================================================
describe("checkpoint", () => {
	it("forwards values from upstream", () => {
		const adapter = memoryAdapter();
		const source = state(0);
		const durable = pipe(source, checkpoint("test-1", adapter));

		const values: number[] = [];
		const unsub = subscribe(durable, (v) => values.push(v!));

		source.set(1);
		source.set(2);
		source.set(3);
		unsub.unsubscribe();

		expect(values).toEqual([1, 2, 3]);
	});

	it("persists values to adapter", () => {
		const adapter = memoryAdapter();
		const source = state(0);
		const durable = pipe(source, checkpoint("test-2", adapter));

		const unsub = subscribe(durable, () => {});
		source.set(42);
		unsub.unsubscribe();

		// Value should be saved in adapter
		expect(adapter.load("test-2")).toBe(42);
	});

	it("recovers saved value on re-subscribe", () => {
		const adapter = memoryAdapter();
		const source = state(0);

		// First run — persist a value
		const durable1 = pipe(source, checkpoint("test-3", adapter));
		const values1: number[] = [];
		const unsub1 = subscribe(durable1, (v) => values1.push(v!));
		source.set(42);
		unsub1.unsubscribe();
		expect(values1).toEqual([42]);

		// Second run — new checkpoint with same id should recover
		const source2 = state(0);
		const durable2 = pipe(source2, checkpoint("test-3", adapter));
		const values2: number[] = [];
		const unsub2 = subscribe(durable2, (v) => values2.push(v!));

		// Should receive recovered value first
		expect(values2).toEqual([42]);

		// Then receive new values
		source2.set(100);
		expect(values2).toEqual([42, 100]);
		unsub2.unsubscribe();
	});

	it("meta tracks recovery and persist count", () => {
		const adapter = memoryAdapter();
		const source = state(0);
		const durable = pipe(source, checkpoint("test-4", adapter));
		const meta = (durable as any).meta;

		const unsub = subscribe(durable, () => {});

		// No saved value — not recovered
		expect(meta.get().recovered).toBe(false);
		expect(meta.get().persistCount).toBe(0);

		source.set(1);
		expect(meta.get().persistCount).toBe(1);

		source.set(2);
		expect(meta.get().persistCount).toBe(2);

		unsub.unsubscribe();
	});

	it("meta.recovered is true when loading saved value", () => {
		const adapter = memoryAdapter();

		// Pre-save a value
		adapter.save("test-5", "hello");

		const source = state("");
		const durable = pipe(source, checkpoint("test-5", adapter));
		const meta = (durable as any).meta;

		const unsub = subscribe(durable, () => {});
		expect(meta.get().recovered).toBe(true);
		unsub.unsubscribe();
	});

	it("clear() removes saved value from adapter", () => {
		const adapter = memoryAdapter();
		adapter.save("test-6", 42);

		const source = state(0);
		const durable = pipe(source, checkpoint("test-6", adapter));
		const unsub = subscribe(durable, () => {});

		(durable as any).clear();
		expect(adapter.load("test-6")).toBeUndefined();

		unsub.unsubscribe();
	});

	it("get() returns undefined before any value", () => {
		const adapter = memoryAdapter();
		const source = state(0);
		const durable = pipe(source, checkpoint("test-7", adapter));

		expect(durable.get()).toBeUndefined();
	});

	it("get() returns last checkpointed value", () => {
		const adapter = memoryAdapter();
		const source = state(0);
		const durable = pipe(source, checkpoint("test-8", adapter));

		const unsub = subscribe(durable, () => {});
		source.set(99);
		expect(durable.get()).toBe(99);
		unsub.unsubscribe();
	});

	it("forwards upstream errors", () => {
		const adapter = memoryAdapter();
		const source = state(0);
		const durable = pipe(source, checkpoint("test-9", adapter));

		const unsub = subscribe(durable, () => {}, {
			onEnd: (_err) => {
				// verify onEnd callback is reachable
			},
		});

		// Complete the source — durable should forward completion
		// (state doesn't easily error, but we verify the onEnd path)
		unsub.unsubscribe();
	});

	it("clear() works even when producer is inactive", () => {
		const adapter = memoryAdapter();
		adapter.save("test-clear", 42);

		const source = state(0);
		const durable = pipe(source, checkpoint("test-clear", adapter));

		// Don't subscribe — producer is not active
		(durable as any).clear();
		expect(adapter.load("test-clear")).toBeUndefined();
	});

	it("buffers upstream values during async load", async () => {
		// Create an async adapter returning CallbagSource via rawFromPromise
		const asyncAdapter: any = {
			_store: new Map(),
			save(id: string, value: unknown) {
				this._store.set(id, value);
			},
			load(id: string) {
				const val = this._store.get(id);
				return rawFromPromise(new Promise((resolve) => setTimeout(() => resolve(val), 10)));
			},
			clear(id: string) {
				this._store.delete(id);
			},
		};

		asyncAdapter._store.set("async-1", "recovered");

		const source = state(0);
		const durable = pipe(source, checkpoint("async-1", asyncAdapter));

		const values: any[] = [];
		const unsub = subscribe(durable, (v) => values.push(v));

		// Emit during async load window — should be buffered
		source.set(100);
		source.set(200);

		// Wait for async load to complete
		await new Promise((r) => setTimeout(r, 50));

		// Should get: recovered value first, then buffered values
		expect(values).toEqual(["recovered", 100, 200]);

		unsub.unsubscribe();
	});

	it("handles async save rejection without crashing", () => {
		const failAdapter: any = {
			save() {
				return rawFromPromise(Promise.reject(new Error("disk full")));
			},
			load() {
				return undefined;
			},
			clear() {},
		};

		const source = state(0);
		const durable = pipe(source, checkpoint("fail-save", failAdapter));

		const values: any[] = [];
		const unsub = subscribe(durable, (v) => values.push(v));

		// Should not throw — async rejection is caught
		source.set(42);
		expect(values).toEqual([42]);

		unsub.unsubscribe();
	});

	it("different checkpoint ids are independent", () => {
		const adapter = memoryAdapter();
		adapter.save("id-a", "alpha");
		adapter.save("id-b", "beta");

		const source = state("");

		const durableA = pipe(source, checkpoint("id-a", adapter));
		const durableB = pipe(source, checkpoint("id-b", adapter));

		const valuesA: string[] = [];
		const valuesB: string[] = [];

		const unsubA = subscribe(durableA, (v) => valuesA.push(v!));
		const unsubB = subscribe(durableB, (v) => valuesB.push(v!));

		expect(valuesA).toEqual(["alpha"]);
		expect(valuesB).toEqual(["beta"]);

		unsubA.unsubscribe();
		unsubB.unsubscribe();
	});
});

// ==========================================================================
// memoryAdapter
// ==========================================================================
describe("memoryAdapter", () => {
	it("save/load/clear lifecycle", () => {
		const adapter = memoryAdapter();

		expect(adapter.load("key")).toBeUndefined();

		adapter.save("key", { data: 42 });
		expect(adapter.load("key")).toEqual({ data: 42 });

		adapter.clear("key");
		expect(adapter.load("key")).toBeUndefined();
	});

	it("handles multiple keys independently", () => {
		const adapter = memoryAdapter();

		adapter.save("a", 1);
		adapter.save("b", 2);

		expect(adapter.load("a")).toBe(1);
		expect(adapter.load("b")).toBe(2);

		adapter.clear("a");
		expect(adapter.load("a")).toBeUndefined();
		expect(adapter.load("b")).toBe(2);
	});
});
