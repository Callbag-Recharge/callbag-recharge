import { describe, expect, it } from "vitest";
import { producer } from "../../core/producer";
import { state } from "../../core/state";
import { withMeta } from "../../utils/withMeta";

describe("withMeta", () => {
	it("tracks emission count", () => {
		const s = state(0);
		const meta = withMeta(s);

		expect(meta.count.get()).toBe(0);

		s.set(1);
		expect(meta.count.get()).toBe(1);

		s.set(2);
		expect(meta.count.get()).toBe(2);

		meta.dispose();
	});

	it("tracks last emitted value", () => {
		const s = state(0);
		const meta = withMeta(s);

		s.set(42);
		expect(meta.lastValue.get()).toBe(42);

		s.set(99);
		expect(meta.lastValue.get()).toBe(99);

		meta.dispose();
	});

	it("tracks ended state on completion", () => {
		let completeFn: (() => void) | undefined;
		const p = producer<number>(({ emit, complete }) => {
			emit(1);
			completeFn = complete;
			return undefined;
		});

		const meta = withMeta(p);
		expect(meta.ended.get()).toBe(false);
		expect(meta.count.get()).toBe(1);

		completeFn!();
		expect(meta.ended.get()).toBe(true);
		expect(meta.error.get()).toBe(undefined);
	});

	it("tracks error on error end", () => {
		let errorFn: ((e: unknown) => void) | undefined;
		const p = producer<number>(({ error }) => {
			errorFn = error;
			return undefined;
		});

		const meta = withMeta(p);
		errorFn!(new Error("boom"));

		expect(meta.ended.get()).toBe(true);
		expect(meta.error.get()).toBeInstanceOf(Error);
	});

	it("dispose stops tracking", () => {
		const s = state(0);
		const meta = withMeta(s);

		s.set(1);
		expect(meta.count.get()).toBe(1);

		meta.dispose();

		s.set(2);
		// Count should not increment after dispose
		expect(meta.count.get()).toBe(1);
	});

	it("accepts custom name prefix", () => {
		const s = state(0);
		const meta = withMeta(s, { name: "myStore" });

		// Companion stores should have prefixed names (verified via Inspector)
		expect(meta.count.get()).toBe(0);
		meta.dispose();
	});
});
