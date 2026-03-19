import { describe, expect, it } from "vitest";
import { fromIter } from "../../extra/fromIter";
import { subscribe } from "../../extra/subscribe";
import { takeWhile } from "../../extra/takeWhile";
import { Inspector, pipe, state } from "../../index";

describe("takeWhile", () => {
	// Happy path
	it("emits values while predicate is true, completes on false", () => {
		const s = state(0);
		const t = pipe(
			s,
			takeWhile((v) => v < 5),
		);
		const obs = Inspector.observe(t);

		s.set(1);
		s.set(3);
		s.set(5); // predicate fails
		s.set(6); // should not reach

		expect(obs.values).toEqual([1, 3]);
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});

	it("does not emit the failing value", () => {
		const s = state(0);
		const t = pipe(
			s,
			takeWhile((v) => v < 3),
		);
		const obs = Inspector.observe(t);

		s.set(1);
		s.set(2);
		s.set(3);

		expect(obs.values).toEqual([1, 2]);
		expect(obs.ended).toBe(true);
	});

	it("completes immediately if first value fails predicate", () => {
		const s = state(0);
		const t = pipe(
			s,
			takeWhile((v) => v > 100),
		);
		const obs = Inspector.observe(t);

		s.set(1);

		expect(obs.values).toEqual([]);
		expect(obs.ended).toBe(true);
	});

	// get() returns undefined before first emit
	it("get() returns undefined before first value", () => {
		const s = state(0);
		const t = pipe(
			s,
			takeWhile((v) => v < 5),
		);
		expect(t.get()).toBeUndefined();
	});

	// Works with fromIter
	it("works with fromIter (sync source)", () => {
		const t = pipe(
			fromIter([1, 2, 3, 4, 5]),
			takeWhile((v) => v < 4),
		);
		const obs = Inspector.observe(t);

		expect(obs.values).toEqual([1, 2, 3]);
		expect(obs.ended).toBe(true);
	});

	// Upstream error forwarded
	it("forwards upstream error", () => {
		const s = state(0);
		const t = pipe(
			s,
			takeWhile((v) => v < 10),
		);
		const obs = Inspector.observe(t);

		s.set(1);
		(s as any).error(new Error("fail"));

		expect(obs.values).toEqual([1]);
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeInstanceOf(Error);
	});

	// Upstream completion forwarded
	it("forwards upstream completion", () => {
		const s = state(0);
		const t = pipe(
			s,
			takeWhile((v) => v < 10),
		);
		const obs = Inspector.observe(t);

		s.set(1);
		(s as any).complete();

		expect(obs.values).toEqual([1]);
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});

	// After completion, late subscribers get immediate END (operator-based behavior)
	it("late subscriber after completion gets immediate END", () => {
		const s = state(0);
		const t = pipe(
			s,
			takeWhile((v) => v < 2),
		);

		const obs1 = Inspector.observe(t);
		s.set(1);
		s.set(5); // completes
		expect(obs1.ended).toBe(true);

		// Late subscriber — operator is completed, gets END immediately
		let ended = false;
		subscribe(t, () => {}, { onEnd: () => (ended = true) });
		expect(ended).toBe(true);
	});

	// All values pass predicate (no completion from takeWhile)
	it("passes all values if predicate always true", () => {
		const s = state(0);
		const t = pipe(
			s,
			takeWhile(() => true),
		);
		const obs = Inspector.observe(t);

		s.set(1);
		s.set(2);
		s.set(3);

		expect(obs.values).toEqual([1, 2, 3]);
		expect(obs.ended).toBe(false);
		obs.dispose();
	});

	// Multiple values then completion
	it("emits correct sequence with varied values", () => {
		const s = state(0);
		const t = pipe(
			s,
			takeWhile((v) => v % 2 === 0),
		);
		const obs = Inspector.observe(t);

		s.set(2);
		s.set(4);
		s.set(6);
		s.set(7); // odd — fails predicate

		expect(obs.values).toEqual([2, 4, 6]);
		expect(obs.ended).toBe(true);
	});

	// Verify get() reflects last emitted value
	it("get() reflects last emitted value", () => {
		const s = state(0);
		const t = pipe(
			s,
			takeWhile((v) => v < 5),
		);
		const _obs = Inspector.observe(t);

		s.set(3);
		expect(t.get()).toBe(3);

		s.set(5); // completes
		expect(t.get()).toBe(3); // last emitted value preserved
	});
});
