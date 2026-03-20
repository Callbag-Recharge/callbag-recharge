import { describe, expect, it } from "vitest";
import { state } from "../../core/state";
import { subscribe } from "../../extra/subscribe";
import { dirtyTracker } from "../../utils/dirtyTracker";

describe("dirtyTracker", () => {
	it("starts clean when source matches initial baseline", () => {
		const s = state("hello");
		const tracker = dirtyTracker(s, "hello");
		expect(tracker.dirty.get()).toBe(false);
	});

	it("starts dirty when source already differs from baseline", () => {
		const s = state("world");
		const tracker = dirtyTracker(s, "hello");
		expect(tracker.dirty.get()).toBe(true);
	});

	it("becomes dirty when source changes away from baseline", () => {
		const s = state("hello");
		const tracker = dirtyTracker(s, "hello");

		s.set("hello world");
		expect(tracker.dirty.get()).toBe(true);
	});

	it("becomes clean when source returns to baseline", () => {
		const s = state("hello");
		const tracker = dirtyTracker(s, "hello");

		s.set("changed");
		expect(tracker.dirty.get()).toBe(true);

		s.set("hello");
		expect(tracker.dirty.get()).toBe(false);
	});

	it("resetBaseline updates the baseline to current source value", () => {
		const s = state("hello");
		const tracker = dirtyTracker(s, "hello");

		s.set("new value");
		expect(tracker.dirty.get()).toBe(true);

		tracker.resetBaseline(); // baseline = 'new value'
		expect(tracker.dirty.get()).toBe(false);
		expect(tracker.baseline.get()).toBe("new value");
	});

	it("resetBaseline with explicit value", () => {
		const s = state("hello");
		const tracker = dirtyTracker(s, "hello");

		tracker.resetBaseline("world");
		expect(tracker.dirty.get()).toBe(true); // source='hello', baseline='world'
		expect(tracker.baseline.get()).toBe("world");

		s.set("world");
		expect(tracker.dirty.get()).toBe(false);
	});

	it("uses custom equals function", () => {
		const s = state({ id: 1, name: "a" });
		const tracker = dirtyTracker(
			s,
			{ id: 1, name: "a" },
			{
				equals: (a, b) => a.id === b.id,
			},
		);

		expect(tracker.dirty.get()).toBe(false);

		// Same id, different name → still clean
		s.set({ id: 1, name: "b" });
		expect(tracker.dirty.get()).toBe(false);

		// Different id → dirty
		s.set({ id: 2, name: "b" });
		expect(tracker.dirty.get()).toBe(true);
	});

	it("reactive subscriptions receive dirty updates", () => {
		const s = state("hello");
		const tracker = dirtyTracker(s, "hello");

		const values: boolean[] = [];
		subscribe(tracker.dirty, (v) => values.push(v));

		s.set("changed"); // false → true
		s.set("hello"); // true → false (back to baseline)
		s.set("changed again"); // false → true

		// subscribe doesn't emit initial value; only changes
		expect(values).toEqual([true, false, true]);
	});

	it("reactive subscriptions react to resetBaseline", () => {
		const s = state("hello");
		const tracker = dirtyTracker(s, "hello");

		const values: boolean[] = [];
		subscribe(tracker.dirty, (v) => values.push(v));

		s.set("changed"); // false → true
		tracker.resetBaseline(); // baseline = 'changed', dirty → false

		expect(values).toEqual([true, false]);
	});

	it("works with numeric values and NaN", () => {
		const s = state(0);
		const tracker = dirtyTracker(s, 0);

		expect(tracker.dirty.get()).toBe(false);

		s.set(NaN);
		expect(tracker.dirty.get()).toBe(true);

		// Object.is(NaN, NaN) === true
		tracker.resetBaseline(NaN);
		expect(tracker.dirty.get()).toBe(false);
	});

	it("handles undefined baseline", () => {
		const s = state<string | undefined>(undefined);
		const tracker = dirtyTracker(s, undefined);

		expect(tracker.dirty.get()).toBe(false);

		s.set("value");
		expect(tracker.dirty.get()).toBe(true);

		s.set(undefined);
		expect(tracker.dirty.get()).toBe(false);
	});

	it("dispose prevents further resetBaseline calls", () => {
		const s = state("hello");
		const tracker = dirtyTracker(s, "hello");

		s.set("changed");
		expect(tracker.dirty.get()).toBe(true);

		tracker.dispose();

		// resetBaseline is a no-op after dispose
		tracker.resetBaseline("changed");
		expect(tracker.baseline.get()).toBe("hello"); // unchanged
	});

	it("multiple resetBaseline calls", () => {
		const s = state(1);
		const tracker = dirtyTracker(s, 1);

		s.set(2);
		tracker.resetBaseline(); // baseline = 2
		expect(tracker.dirty.get()).toBe(false);

		s.set(3);
		tracker.resetBaseline(); // baseline = 3
		expect(tracker.dirty.get()).toBe(false);

		s.set(2);
		expect(tracker.dirty.get()).toBe(true); // baseline is 3
	});
});
