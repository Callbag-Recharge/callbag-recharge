import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effect } from "../../core/effect";
import { subscribe } from "../../core/subscribe";
import { fromCron } from "../../extra/fromCron";

describe("fromCron", () => {
	beforeEach(() => {
		// Set fake time to 2026-03-17 08:59:00 (Tuesday)
		vi.useFakeTimers({ now: new Date(2026, 2, 17, 8, 59, 0) });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("emits Date when cron matches", () => {
		const cron = fromCron("0 9 * * *"); // 9:00 AM daily
		const values: Date[] = [];
		const unsub = subscribe(cron, (v) => values.push(v));

		// At 08:59 — doesn't match
		expect(values).toEqual([]);

		// Advance to 09:00
		vi.advanceTimersByTime(60_000);
		expect(values.length).toBe(1);
		expect(values[0].getHours()).toBe(9);
		expect(values[0].getMinutes()).toBe(0);

		// Advance to 09:01 — doesn't match
		vi.advanceTimersByTime(60_000);
		expect(values.length).toBe(1);

		unsub.unsubscribe();
	});

	it("emits on matching minutes with */5", () => {
		// Start at 09:00
		vi.setSystemTime(new Date(2026, 2, 17, 9, 0, 0));
		const cron = fromCron("*/5 * * * *");
		const values: Date[] = [];
		const unsub = subscribe(cron, (v) => values.push(v));

		// 09:00 matches */5 — fires immediately on subscribe
		expect(values.length).toBe(1);

		// Advance 5 minutes to 09:05
		for (let i = 0; i < 5; i++) vi.advanceTimersByTime(60_000);
		expect(values.length).toBe(2);
		expect(values[1].getMinutes()).toBe(5);

		unsub.unsubscribe();
	});

	it("does not double-fire within the same minute", () => {
		vi.setSystemTime(new Date(2026, 2, 17, 9, 0, 0));
		// Use a very short tick to simulate multiple checks in one minute
		const cron = fromCron("0 9 * * *", { tickMs: 1000 });
		const values: Date[] = [];
		const unsub = subscribe(cron, (v) => values.push(v));

		// Initial check fires
		expect(values.length).toBe(1);

		// 30 more checks within the same minute
		for (let i = 0; i < 30; i++) vi.advanceTimersByTime(1000);
		expect(values.length).toBe(1); // still just 1

		unsub.unsubscribe();
	});

	it("get() returns last fire time", () => {
		vi.setSystemTime(new Date(2026, 2, 17, 9, 0, 0));
		const cron = fromCron("*/5 * * * *");
		expect(cron.get()).toBeUndefined(); // no fire yet (lazy)

		const unsub = subscribe(cron, () => {});
		// Fires at 09:00 on subscribe
		expect(cron.get()).toBeInstanceOf(Date);
		expect(cron.get()!.getMinutes()).toBe(0);

		unsub.unsubscribe();
	});

	it("cleanup on unsubscribe — no more fires", () => {
		vi.setSystemTime(new Date(2026, 2, 17, 8, 59, 0));
		const cron = fromCron("0 9 * * *");
		const values: Date[] = [];
		const unsub = subscribe(cron, (v) => values.push(v));

		unsub.unsubscribe();

		// Advance past 09:00
		vi.advanceTimersByTime(120_000);
		expect(values).toEqual([]); // no fires after unsub
	});

	it("fires on correct day of week", () => {
		// Start Monday 2026-03-16 08:59
		vi.setSystemTime(new Date(2026, 2, 16, 8, 59, 0));
		const cron = fromCron("0 9 * * 1"); // Monday only
		const values: Date[] = [];
		const unsub = subscribe(cron, (v) => values.push(v));

		// Advance to Monday 09:00
		vi.advanceTimersByTime(60_000);
		expect(values.length).toBe(1);

		// Advance 24 hours to Tuesday 09:00 — should NOT fire
		for (let i = 0; i < 24 * 60; i++) vi.advanceTimersByTime(60_000);
		expect(values.length).toBe(1);

		unsub.unsubscribe();
	});

	it("rejects invalid cron expressions", () => {
		expect(() => fromCron("bad cron")).toThrow();
		expect(() => fromCron("* *")).toThrow();
	});

	it("works with effect", () => {
		vi.setSystemTime(new Date(2026, 2, 17, 9, 0, 0));
		const cron = fromCron("*/5 * * * *");
		const log: string[] = [];

		const dispose = effect([cron], () => {
			const v = cron.get();
			if (v) log.push(`tick:${v.getMinutes()}`);
			return undefined;
		});

		// Effect runs immediately on creation (effect semantics)
		// then cron fires at 09:00 on subscribe → effect runs again
		expect(log.length).toBeGreaterThanOrEqual(1);

		// Advance to 09:05
		for (let i = 0; i < 5; i++) vi.advanceTimersByTime(60_000);
		expect(log).toContain("tick:5");

		dispose();
	});
});
