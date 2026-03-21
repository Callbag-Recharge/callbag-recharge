import { describe, expect, it } from "vitest";
import { effect } from "../../core/effect";
import { reactiveLog } from "../../data/reactiveLog";
import type { LogEvent } from "../../data/types";
import { subscribe } from "../../extra/subscribe";

describe("reactiveLog", () => {
	// --- Basic append/read ---

	it("appends entries with monotonic sequence numbers", () => {
		const log = reactiveLog<string>();
		const s1 = log.append("a");
		const s2 = log.append("b");
		const s3 = log.append("c");
		expect(s1).toBe(1);
		expect(s2).toBe(2);
		expect(s3).toBe(3);
		expect(log.length).toBe(3);
	});

	it("reads entry by sequence number", () => {
		const log = reactiveLog<string>();
		log.append("a");
		log.append("b");
		expect(log.get(1)).toEqual({ seq: 1, value: "a" });
		expect(log.get(2)).toEqual({ seq: 2, value: "b" });
		expect(log.get(99)).toBeUndefined();
	});

	it("slices by sequence range", () => {
		const log = reactiveLog<string>();
		log.append("a");
		log.append("b");
		log.append("c");
		log.append("d");
		const entries = log.slice(2, 3);
		expect(entries).toEqual([
			{ seq: 2, value: "b" },
			{ seq: 3, value: "c" },
		]);
	});

	it("slice defaults to full range", () => {
		const log = reactiveLog<string>();
		log.append("a");
		log.append("b");
		expect(log.slice()).toEqual([
			{ seq: 1, value: "a" },
			{ seq: 2, value: "b" },
		]);
	});

	it("toArray returns snapshot", () => {
		const log = reactiveLog<number>();
		log.append(1);
		log.append(2);
		const arr = log.toArray();
		expect(arr).toEqual([
			{ seq: 1, value: 1 },
			{ seq: 2, value: 2 },
		]);
		// Snapshot — mutating doesn't affect log
		arr.push({ seq: 99, value: 99 });
		expect(log.length).toBe(2);
	});

	it("headSeq/tailSeq track boundaries", () => {
		const log = reactiveLog<string>();
		expect(log.headSeq).toBe(0); // empty
		expect(log.tailSeq).toBe(0);
		log.append("a");
		expect(log.headSeq).toBe(1);
		expect(log.tailSeq).toBe(1);
		log.append("b");
		log.append("c");
		expect(log.headSeq).toBe(1);
		expect(log.tailSeq).toBe(3);
	});

	// --- Bounded (maxSize) ---

	it("trims oldest entries when maxSize exceeded", () => {
		const log = reactiveLog<string>({ maxSize: 3 });
		log.append("a"); // seq 1
		log.append("b"); // seq 2
		log.append("c"); // seq 3
		log.append("d"); // seq 4 — trims "a"
		expect(log.length).toBe(3);
		expect(log.get(1)).toBeUndefined(); // trimmed
		expect(log.get(2)!.value).toBe("b");
		expect(log.get(4)!.value).toBe("d");
		expect(log.headSeq).toBe(2);
		expect(log.tailSeq).toBe(4);
	});

	it("continued trimming preserves correct seq mapping", () => {
		const log = reactiveLog<number>({ maxSize: 2 });
		log.append(1); // seq 1
		log.append(2); // seq 2
		log.append(3); // seq 3, trims 1
		log.append(4); // seq 4, trims 2
		log.append(5); // seq 5, trims 3
		expect(log.length).toBe(2);
		expect(log.get(4)!.value).toBe(4);
		expect(log.get(5)!.value).toBe(5);
		expect(log.get(3)).toBeUndefined();
	});

	// --- Clear ---

	it("clear removes all entries", () => {
		const log = reactiveLog<string>();
		log.append("a");
		log.append("b");
		log.clear();
		expect(log.length).toBe(0);
		expect(log.headSeq).toBe(0);
		expect(log.get(1)).toBeUndefined();
	});

	it("append after clear continues sequence", () => {
		const log = reactiveLog<string>();
		log.append("a"); // seq 1
		log.append("b"); // seq 2
		log.clear();
		const s = log.append("c"); // seq 3
		expect(s).toBe(3);
		expect(log.get(3)!.value).toBe("c");
	});

	// --- appendMany ---

	it("appendMany batch-appends and returns all seqs", () => {
		const log = reactiveLog<string>();
		const seqs = log.appendMany(["a", "b", "c"]);
		expect(seqs).toEqual([1, 2, 3]);
		expect(log.length).toBe(3);
	});

	it("appendMany is empty-safe", () => {
		const log = reactiveLog<string>();
		expect(log.appendMany([])).toEqual([]);
	});

	// --- Reactive: lengthStore ---

	it("lengthStore is reactive", () => {
		const log = reactiveLog<number>();
		const lengths: number[] = [];
		effect([log.lengthStore], () => {
			lengths.push(log.lengthStore.get());
		});
		log.append(1);
		log.append(2);
		log.append(3);
		expect(lengths).toEqual([0, 1, 2, 3]);
	});

	// --- Reactive: latest ---

	it("latest tracks the most recent entry", () => {
		const log = reactiveLog<string>();
		expect(log.latest.get()).toBeUndefined();
		log.append("a");
		expect(log.latest.get()).toEqual({ seq: 1, value: "a" });
		log.append("b");
		expect(log.latest.get()).toEqual({ seq: 2, value: "b" });
	});

	// --- Reactive: tail ---

	it("tail(n) returns reactive last N entries", () => {
		const log = reactiveLog<string>();
		const tailStore = log.tail(2);
		expect(tailStore.get()).toEqual([]);
		log.append("a");
		log.append("b");
		log.append("c");
		const result = tailStore.get();
		expect(result).toEqual([
			{ seq: 2, value: "b" },
			{ seq: 3, value: "c" },
		]);
	});

	it("tail() without arg returns all entries", () => {
		const log = reactiveLog<string>();
		const tailStore = log.tail();
		log.append("a");
		log.append("b");
		expect(tailStore.get()).toEqual([
			{ seq: 1, value: "a" },
			{ seq: 2, value: "b" },
		]);
	});

	// --- Reactive: events ---

	it("events emits on append", () => {
		const log = reactiveLog<string>();
		const events: LogEvent<string>[] = [];
		const unsub = subscribe(log.events, (e) => {
			if (e) events.push(e);
		});
		log.append("a");
		log.append("b");
		expect(events).toEqual([
			{ type: "append", seq: 1, value: "a" },
			{ type: "append", seq: 2, value: "b" },
		]);
		unsub.unsubscribe();
	});

	it("events emits on clear", () => {
		const log = reactiveLog<string>();
		const events: LogEvent<string>[] = [];
		const unsub = subscribe(log.events, (e) => {
			if (e) events.push(e);
		});
		log.append("a");
		log.clear();
		expect(events[events.length - 1]).toEqual({ type: "clear" });
		unsub.unsubscribe();
	});

	// --- Lifecycle ---

	it("destroy prevents further appends", () => {
		const log = reactiveLog<string>();
		log.append("a");
		log.destroy();
		expect(log.append("b")).toBe(-1);
		expect(log.length).toBe(0);
	});

	it("appendMany after destroy returns empty", () => {
		const log = reactiveLog<string>();
		log.destroy();
		expect(log.appendMany(["a", "b"])).toEqual([]);
	});
});
