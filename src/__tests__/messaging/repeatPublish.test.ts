import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repeatPublish } from "../../messaging/repeatPublish";
import { topic } from "../../messaging/topic";

describe("repeatPublish", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	// -----------------------------------------------------------------------
	// 5e-5: Interval-based repeat
	// -----------------------------------------------------------------------

	describe("interval mode", () => {
		it("publishes at fixed intervals", () => {
			const t = topic<number>("repeat-interval");
			const handle = repeatPublish(t, () => Date.now(), { every: 1000 });

			expect(handle.active).toBe(true);
			expect(handle.count.get()).toBe(0);

			vi.advanceTimersByTime(1000);
			expect(handle.count.get()).toBe(1);
			expect(t.tailSeq).toBe(1);

			vi.advanceTimersByTime(1000);
			expect(handle.count.get()).toBe(2);
			expect(t.tailSeq).toBe(2);

			handle.cancel();
			expect(handle.active).toBe(false);

			vi.advanceTimersByTime(5000);
			expect(handle.count.get()).toBe(2); // no more publishes
			t.destroy();
		});

		it("uses factory function for each publish", () => {
			const t = topic<number>("repeat-factory");
			let counter = 0;
			const handle = repeatPublish(t, () => ++counter, { every: 100 });

			vi.advanceTimersByTime(300);
			expect(t.get(1)!.value).toBe(1);
			expect(t.get(2)!.value).toBe(2);
			expect(t.get(3)!.value).toBe(3);

			handle.cancel();
			t.destroy();
		});

		it("uses fixed value when not a function", () => {
			const t = topic<string>("repeat-fixed");
			const handle = repeatPublish(t, "heartbeat", { every: 100 });

			vi.advanceTimersByTime(200);
			expect(t.get(1)!.value).toBe("heartbeat");
			expect(t.get(2)!.value).toBe("heartbeat");

			handle.cancel();
			t.destroy();
		});

		it("respects limit", () => {
			const t = topic<number>("repeat-limit");
			const handle = repeatPublish(t, () => 42, { every: 100, limit: 3 });

			vi.advanceTimersByTime(500);
			expect(handle.count.get()).toBe(3);
			expect(handle.active).toBe(false);
			expect(t.tailSeq).toBe(3);

			t.destroy();
		});

		it("includes key and headers", () => {
			const t = topic<string>("repeat-meta");
			const handle = repeatPublish(t, "msg", {
				every: 100,
				key: "partition-1",
				headers: { "x-source": "repeat" },
				limit: 1,
			});

			vi.advanceTimersByTime(100);
			const msg = t.get(1)!;
			expect(msg.key).toBe("partition-1");
			expect(msg.headers!["x-source"]).toBe("repeat");

			handle.cancel();
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// BH-13: Cron mode
	// -----------------------------------------------------------------------

	describe("cron mode", () => {
		it("publishes when cron matches current time", () => {
			// Set time to a known point: 2026-03-21 09:00:00 (Saturday = day 6)
			vi.setSystemTime(new Date(2026, 2, 21, 9, 0, 0));

			const t = topic<string>("cron-basic");
			const handle = repeatPublish(t, () => "tick", {
				cron: "0 9 * * *", // every day at 9:00
			});

			// Should fire immediately on init check (matches 9:00)
			expect(handle.count.get()).toBe(1);
			expect(t.tailSeq).toBe(1);

			// Advance 60s — advanceTimersByTime also moves clock to 09:01, no match
			vi.advanceTimersByTime(60_000);
			expect(handle.count.get()).toBe(1);

			// Skip ahead to next day at 08:59, then advance 60s to trigger check at 09:00
			vi.setSystemTime(new Date(2026, 2, 22, 8, 59, 0));
			vi.advanceTimersByTime(60_000); // clock → 09:00, checkCron fires
			expect(handle.count.get()).toBe(2);

			handle.cancel();
			t.destroy();
		});

		it("cron respects limit", () => {
			vi.setSystemTime(new Date(2026, 2, 21, 9, 0, 0));

			const t = topic<string>("cron-limit");
			const handle = repeatPublish(t, "ping", {
				cron: "* * * * *", // every minute
				limit: 2,
			});

			// Immediate fire
			expect(handle.count.get()).toBe(1);

			// Next minute
			vi.setSystemTime(new Date(2026, 2, 21, 9, 1, 0));
			vi.advanceTimersByTime(60_000);
			expect(handle.count.get()).toBe(2);
			expect(handle.active).toBe(false);

			// No more after limit
			vi.setSystemTime(new Date(2026, 2, 21, 9, 2, 0));
			vi.advanceTimersByTime(60_000);
			expect(handle.count.get()).toBe(2);

			t.destroy();
		});

		it("cron cancel stops future checks", () => {
			vi.setSystemTime(new Date(2026, 2, 21, 10, 0, 0));

			const t = topic<string>("cron-cancel");
			const handle = repeatPublish(t, "x", {
				cron: "* * * * *",
			});

			expect(handle.count.get()).toBe(1);
			handle.cancel();

			vi.setSystemTime(new Date(2026, 2, 21, 10, 1, 0));
			vi.advanceTimersByTime(60_000);
			expect(handle.count.get()).toBe(1);
			expect(handle.active).toBe(false);

			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Cancel
	// -----------------------------------------------------------------------

	describe("cancel", () => {
		it("cancel is idempotent", () => {
			const t = topic<string>("cancel");
			const handle = repeatPublish(t, "x", { every: 100 });
			handle.cancel();
			handle.cancel(); // no error
			expect(handle.active).toBe(false);
			t.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Count store is reactive
	// -----------------------------------------------------------------------

	describe("reactive count", () => {
		it("count store updates on each publish", () => {
			const t = topic<number>("count-reactive");
			const handle = repeatPublish(t, () => 1, { every: 100 });

			// We can observe the count store
			expect(handle.count.get()).toBe(0);

			vi.advanceTimersByTime(100);
			expect(handle.count.get()).toBe(1);

			vi.advanceTimersByTime(100);
			expect(handle.count.get()).toBe(2);

			handle.cancel();
			t.destroy();
		});
	});
});
