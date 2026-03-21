import { describe, expect, it } from "vitest";
import { compaction } from "../../data/compaction";
import { reactiveLog } from "../../data/reactiveLog";

describe("compaction", () => {
	// --- Manual compaction ---

	it("retains only the latest entry per key", () => {
		const log = reactiveLog<{ id: string; v: number }>();
		const c = compaction(log, (e) => e.id);

		log.append({ id: "a", v: 1 });
		log.append({ id: "b", v: 2 });
		log.append({ id: "a", v: 3 });

		const removed = c.compact();
		expect(removed).toBe(1);
		expect(log.length).toBe(2);

		const entries = log.toArray();
		expect(entries.map((e) => e.value)).toEqual([
			{ id: "a", v: 3 },
			{ id: "b", v: 2 },
		]);
	});

	it("preserves insertion order of keys (first seen)", () => {
		const log = reactiveLog<{ id: string; v: number }>();
		const c = compaction(log, (e) => e.id);

		log.append({ id: "x", v: 1 });
		log.append({ id: "y", v: 2 });
		log.append({ id: "z", v: 3 });
		log.append({ id: "x", v: 10 });
		log.append({ id: "y", v: 20 });

		c.compact();

		const keys = log.toArray().map((e) => e.value.id);
		expect(keys).toEqual(["x", "y", "z"]);
	});

	it("returns 0 when nothing to compact", () => {
		const log = reactiveLog<{ id: string; v: number }>();
		const c = compaction(log, (e) => e.id);

		log.append({ id: "a", v: 1 });
		log.append({ id: "b", v: 2 });

		expect(c.compact()).toBe(0);
	});

	it("returns 0 on empty log", () => {
		const log = reactiveLog<{ id: string }>();
		const c = compaction(log, (e) => e.id);
		expect(c.compact()).toBe(0);
	});

	it("handles all entries with same key", () => {
		const log = reactiveLog<number>();
		const c = compaction(log, () => "same-key");

		log.append(1);
		log.append(2);
		log.append(3);

		const removed = c.compact();
		expect(removed).toBe(2);
		expect(log.length).toBe(1);
		expect(log.toArray()[0].value).toBe(3);
	});

	// --- Auto-compaction ---

	it("auto-compacts when threshold is reached", () => {
		const log = reactiveLog<{ id: string; v: number }>();
		const c = compaction(log, (e) => e.id, { threshold: 4 });

		log.append({ id: "a", v: 1 });
		log.append({ id: "b", v: 2 });
		log.append({ id: "a", v: 3 });
		// 3 entries, threshold = 4, no compaction yet
		expect(log.length).toBe(3);

		log.append({ id: "c", v: 4 });
		// 4 entries hit threshold, should auto-compact
		// After compaction: a(v:3), b(v:2), c(v:4) = 3 entries
		expect(log.length).toBe(3);

		c.destroy();
	});

	it("auto-compact does not recurse when compacted length >= threshold", () => {
		// All unique keys, so compacted.length === original length >= threshold
		// Without reentrancy guard, this would recurse infinitely
		const log = reactiveLog<{ id: string; v: number }>();
		const c = compaction(log, (e) => e.id, { threshold: 3 });

		log.append({ id: "a", v: 1 });
		log.append({ id: "b", v: 2 });
		log.append({ id: "c", v: 3 });
		// All unique — compaction removes 0, but must not infinite-loop
		expect(log.length).toBe(3);

		c.destroy();
	});

	it("destroy stops auto-compaction", () => {
		const log = reactiveLog<{ id: string }>();
		const c = compaction(log, (e) => e.id, { threshold: 3 });

		c.destroy();

		log.append({ id: "a" });
		log.append({ id: "a" });
		log.append({ id: "a" });
		// Should NOT auto-compact since destroyed
		expect(log.length).toBe(3);
	});

	// --- With bounded log ---

	it("works with bounded reactiveLog", () => {
		const log = reactiveLog<{ id: string; v: number }>({ maxSize: 10 });
		const c = compaction(log, (e) => e.id);

		log.append({ id: "a", v: 1 });
		log.append({ id: "b", v: 2 });
		log.append({ id: "a", v: 3 });
		log.append({ id: "b", v: 4 });

		const removed = c.compact();
		expect(removed).toBe(2);
		expect(log.length).toBe(2);
	});

	// --- Multiple compactions ---

	it("repeated compaction is idempotent when no new dupes", () => {
		const log = reactiveLog<{ id: string; v: number }>();
		const c = compaction(log, (e) => e.id);

		log.append({ id: "a", v: 1 });
		log.append({ id: "a", v: 2 });

		expect(c.compact()).toBe(1);
		expect(c.compact()).toBe(0); // no more to compact
	});

	it("compaction after new appends works", () => {
		const log = reactiveLog<{ id: string; v: number }>();
		const c = compaction(log, (e) => e.id);

		log.append({ id: "a", v: 1 });
		c.compact();

		log.append({ id: "a", v: 2 });
		expect(c.compact()).toBe(1);
		expect(log.length).toBe(1);
		expect(log.toArray()[0].value.v).toBe(2);
	});

	// --- String key extraction ---

	it("works with simple string values as keys", () => {
		const log = reactiveLog<string>();
		const c = compaction(log, (v) => v);

		log.append("hello");
		log.append("world");
		log.append("hello");

		expect(c.compact()).toBe(1);
		expect(log.toArray().map((e) => e.value)).toEqual(["hello", "world"]);
	});
});
