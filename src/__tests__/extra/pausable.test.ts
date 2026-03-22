import { describe, expect, it } from "vitest";
import { derived } from "../../core/derived";
import { effect } from "../../core/effect";
import { Inspector } from "../../core/inspector";
import { PAUSE, RESUME } from "../../core/protocol";
import { state } from "../../core/state";
import { pausable } from "../../extra/pausable";

describe("pausable", () => {
	it("forwards DATA when not paused", () => {
		const s = state(1);
		const p = pausable<number>()(s);
		const obs = Inspector.observe(p);

		s.set(2);
		s.set(3);

		expect(obs.values).toEqual([2, 3]);
	});

	it("blocks DATA when paused", () => {
		const s = state(1);
		const p = pausable<number>()(s);
		const obs = Inspector.observe(p);

		p.pause();
		s.set(2);
		s.set(3);

		// No emissions while paused
		expect(obs.values).toEqual([]);
	});

	it("re-emits latest on resume", () => {
		const s = state(1);
		const p = pausable<number>()(s);
		const obs = Inspector.observe(p);

		const lockId = p.pause();
		s.set(2);
		s.set(3);
		p.resume(lockId);

		// Only the latest value on resume
		expect(obs.values).toEqual([3]);
	});

	it("paused store is reactive", () => {
		const s = state(0);
		const p = pausable<number>()(s);
		Inspector.observe(p); // connect operator
		const obs = Inspector.observe(p.paused);

		const lockId = p.pause();
		expect(obs.values).toEqual([true]);

		p.resume(lockId);
		expect(obs.values).toEqual([true, false]);
	});

	it("get() returns last emitted value while paused", () => {
		const s = state(1);
		const p = pausable<number>()(s);
		Inspector.observe(p); // connect

		s.set(10);
		p.pause();
		s.set(42);

		// get() returns last emitted value (10), not upstream (42)
		expect(p.get()).toBe(10);
	});

	it("multiple pause/resume cycles work correctly", () => {
		const s = state(0);
		const p = pausable<number>()(s);
		const obs = Inspector.observe(p);

		s.set(1);
		let lockId = p.pause();
		s.set(2);
		s.set(3);
		p.resume(lockId);
		s.set(4);
		lockId = p.pause();
		s.set(5);
		p.resume(lockId);

		expect(obs.values).toEqual([1, 3, 4, 5]);
	});

	it("double pause is idempotent (returns same lock ID)", () => {
		const s = state(0);
		const p = pausable<number>()(s);
		Inspector.observe(p);
		const obs = Inspector.observe(p.paused);

		const id1 = p.pause();
		const id2 = p.pause();
		expect(id1).toBe(id2);
		expect(obs.values).toEqual([true]);
	});

	it("double resume is idempotent", () => {
		const s = state(0);
		const p = pausable<number>()(s);
		const obs = Inspector.observe(p);

		const lockId = p.pause();
		s.set(1);
		p.resume(lockId);
		p.resume(lockId); // no-op — already resumed
		// Only one re-emit
		expect(obs.values).toEqual([1]);
	});

	it("resume with wrong lock ID is a no-op", () => {
		const s = state(0);
		const p = pausable<number>()(s);
		const obs = Inspector.observe(p);

		p.pause();
		s.set(1);
		p.resume("wrong-id");

		// Still paused — no emissions
		expect(obs.values).toEqual([]);
	});

	it("upstream RESUME does not override imperative pause", () => {
		const s = state(0);
		const p = pausable<number>()(s);
		const obs = Inspector.observe(p);

		// Imperative pause acquires a lock
		const lockId = p.pause();
		s.set(1);

		// Simulate upstream RESUME signal — should NOT resume because lock is held
		(s as any).signal(RESUME);

		// Still paused
		expect(obs.values).toEqual([]);

		// Only the correct lock can resume
		p.resume(lockId);
		expect(obs.values).toEqual([1]);
	});

	it("derived downstream reacts to pausable", () => {
		const s = state(1);
		const p = pausable<number>()(s);
		const doubled = derived([p], () => p.get() * 2);
		const obs = Inspector.observe(doubled);

		s.set(2);
		const lockId = p.pause();
		s.set(3);
		// Derived ran once (s=2), no run during pause
		expect(obs.values).toEqual([4]);

		p.resume(lockId);
		// Derived sees the re-emitted latest (3*2=6)
		expect(obs.values).toEqual([4, 6]);
	});

	it("effect downstream responds to pause/resume", () => {
		const s = state(1);
		const p = pausable<number>()(s);
		const runs: number[] = [];

		const dispose = effect([p], () => {
			runs.push(p.get());
		});

		s.set(2);
		expect(runs).toEqual([1, 2]);

		const lockId = p.pause();
		s.set(3);
		expect(runs).toEqual([1, 2]);

		p.resume(lockId);
		expect(runs).toEqual([1, 2, 3]);

		dispose();
	});

	it("PAUSE/RESUME signals propagate downstream", () => {
		const s = state(0);
		const p = pausable<number>()(s);
		const obs = Inspector.observe(p);

		const lockId = p.pause();
		expect(obs.signals).toContain(PAUSE);

		p.resume(lockId);
		expect(obs.signals).toContain(RESUME);
	});

	it("accepts name option", () => {
		const s = state(0);
		const p = pausable<number>({ name: "gated" })(s);
		Inspector.observe(p);
		expect(p.get()).toBe(0);
	});
});
