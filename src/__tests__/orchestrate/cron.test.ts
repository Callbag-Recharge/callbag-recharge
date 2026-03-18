import { describe, expect, it } from "vitest";
import { matchesCron, parseCron } from "../../orchestrate/cron";

describe("cron parser", () => {
	// --- parseCron validation ---

	it("rejects invalid field count", () => {
		expect(() => parseCron("* * *")).toThrow("expected 5 fields");
		expect(() => parseCron("* * * * * *")).toThrow("expected 5 fields");
	});

	it("rejects out-of-range values", () => {
		expect(() => parseCron("60 * * * *")).toThrow("out of range");
		expect(() => parseCron("* 24 * * *")).toThrow("out of range");
		expect(() => parseCron("* * 0 * *")).toThrow("out of range");
		expect(() => parseCron("* * * 13 *")).toThrow("out of range");
		expect(() => parseCron("* * * * 7")).toThrow("out of range");
	});

	it("rejects inverted ranges", () => {
		expect(() => parseCron("30-10 * * * *")).toThrow("Invalid cron range");
		expect(() => parseCron("* 20-5 * * *")).toThrow("Invalid cron range");
	});

	it("rejects invalid step", () => {
		expect(() => parseCron("*/0 * * * *")).toThrow("Invalid cron step");
	});

	it("rejects non-numeric values", () => {
		expect(() => parseCron("abc * * * *")).toThrow();
	});

	// --- parseCron field parsing ---

	it("parses wildcard", () => {
		const s = parseCron("* * * * *");
		expect(s.minutes.size).toBe(60);
		expect(s.hours.size).toBe(24);
		expect(s.daysOfMonth.size).toBe(31);
		expect(s.months.size).toBe(12);
		expect(s.daysOfWeek.size).toBe(7);
	});

	it("parses specific numbers", () => {
		const s = parseCron("0 9 15 3 1");
		expect(s.minutes).toEqual(new Set([0]));
		expect(s.hours).toEqual(new Set([9]));
		expect(s.daysOfMonth).toEqual(new Set([15]));
		expect(s.months).toEqual(new Set([3]));
		expect(s.daysOfWeek).toEqual(new Set([1]));
	});

	it("parses ranges", () => {
		const s = parseCron("0-5 * * * *");
		expect(s.minutes).toEqual(new Set([0, 1, 2, 3, 4, 5]));
	});

	it("parses lists", () => {
		const s = parseCron("0,15,30,45 * * * *");
		expect(s.minutes).toEqual(new Set([0, 15, 30, 45]));
	});

	it("parses steps", () => {
		const s = parseCron("*/15 * * * *");
		expect(s.minutes).toEqual(new Set([0, 15, 30, 45]));
	});

	it("parses range with step", () => {
		const s = parseCron("1-10/3 * * * *");
		expect(s.minutes).toEqual(new Set([1, 4, 7, 10]));
	});

	it("parses combined list and range", () => {
		const s = parseCron("0,10-12 * * * *");
		expect(s.minutes).toEqual(new Set([0, 10, 11, 12]));
	});

	// --- matchesCron ---

	it("matches exact minute/hour", () => {
		const s = parseCron("30 9 * * *");
		// 2026-03-17 09:30:00 (Tuesday = dow 2)
		expect(matchesCron(s, new Date(2026, 2, 17, 9, 30, 0))).toBe(true);
		expect(matchesCron(s, new Date(2026, 2, 17, 9, 31, 0))).toBe(false);
		expect(matchesCron(s, new Date(2026, 2, 17, 10, 30, 0))).toBe(false);
	});

	it("matches day of week", () => {
		const s = parseCron("0 9 * * 1"); // Monday
		// 2026-03-16 is Monday
		expect(matchesCron(s, new Date(2026, 2, 16, 9, 0, 0))).toBe(true);
		// 2026-03-17 is Tuesday
		expect(matchesCron(s, new Date(2026, 2, 17, 9, 0, 0))).toBe(false);
	});

	it("matches day of month", () => {
		const s = parseCron("0 0 1 * *"); // 1st of every month
		expect(matchesCron(s, new Date(2026, 3, 1, 0, 0, 0))).toBe(true);
		expect(matchesCron(s, new Date(2026, 3, 2, 0, 0, 0))).toBe(false);
	});

	it("matches specific month", () => {
		const s = parseCron("0 0 * 12 *"); // December
		expect(matchesCron(s, new Date(2026, 11, 25, 0, 0, 0))).toBe(true);
		expect(matchesCron(s, new Date(2026, 0, 25, 0, 0, 0))).toBe(false);
	});

	it("matches every-5-minutes pattern", () => {
		const s = parseCron("*/5 * * * *");
		expect(matchesCron(s, new Date(2026, 0, 1, 12, 0, 0))).toBe(true);
		expect(matchesCron(s, new Date(2026, 0, 1, 12, 5, 0))).toBe(true);
		expect(matchesCron(s, new Date(2026, 0, 1, 12, 3, 0))).toBe(false);
	});

	it("matches weekday-only 9am pattern", () => {
		const s = parseCron("0 9 * * 1-5"); // Mon-Fri at 9am
		// Monday
		expect(matchesCron(s, new Date(2026, 2, 16, 9, 0, 0))).toBe(true);
		// Saturday (dow=6)
		expect(matchesCron(s, new Date(2026, 2, 21, 9, 0, 0))).toBe(false);
		// Sunday (dow=0)
		expect(matchesCron(s, new Date(2026, 2, 22, 9, 0, 0))).toBe(false);
	});
});
