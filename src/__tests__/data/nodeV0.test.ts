import { describe, expect, it } from "vitest";
import { reactiveIndex } from "../../data/reactiveIndex";
import { reactiveList } from "../../data/reactiveList";
import { reactiveLog } from "../../data/reactiveLog";
import { reactiveMap } from "../../data/reactiveMap";

// ---------------------------------------------------------------------------
// NodeV0 — id + version + snapshot + from()
// ---------------------------------------------------------------------------

describe("NodeV0: reactiveMap", () => {
	it("auto-generates id", () => {
		const m = reactiveMap();
		expect(m.id).toMatch(/^rmap-/);
		m.destroy();
	});

	it("accepts custom id", () => {
		const m = reactiveMap({ id: "my-map" });
		expect(m.id).toBe("my-map");
		m.destroy();
	});

	it("version starts at 0 and increments on structural changes", () => {
		const m = reactiveMap<number>();
		expect(m.version).toBe(0);

		m.set("a", 1);
		expect(m.version).toBe(1); // new key

		m.set("a", 2);
		expect(m.version).toBe(1); // same key, no structural change

		m.set("b", 3);
		expect(m.version).toBe(2); // new key

		m.delete("a");
		expect(m.version).toBe(3); // key removed

		m.destroy();
	});

	it("snapshot() returns serializable representation", () => {
		const m = reactiveMap<string>({ id: "snap-map" });
		m.set("x", "hello");
		m.set("y", "world");

		const snap = m.snapshot();
		expect(snap.type).toBe("reactiveMap");
		expect(snap.id).toBe("snap-map");
		expect(snap.version).toBe(2);
		expect(snap.entries).toEqual([
			["x", "hello"],
			["y", "world"],
		]);

		const json = JSON.stringify(snap);
		const parsed = JSON.parse(json);
		expect(parsed.entries).toEqual([
			["x", "hello"],
			["y", "world"],
		]);

		m.destroy();
	});

	it("namespace has its own id and snapshot", () => {
		const m = reactiveMap<number>({ id: "parent" });
		const ns = m.namespace("ns:");
		expect(ns.id).toBe("parent:ns:ns:");

		ns.set("a", 1);
		const snap = ns.snapshot();
		expect(snap.type).toBe("reactiveMap");
		expect(snap.entries).toEqual([["a", 1]]);

		m.destroy();
	});

	it("from() restores from snapshot", () => {
		const m1 = reactiveMap<string>({ id: "roundtrip" });
		m1.set("a", "hello");
		m1.set("b", "world");
		const snap = m1.snapshot();
		m1.destroy();

		const m2 = reactiveMap.from(snap);
		expect(m2.id).toBe("roundtrip");
		expect(m2.get("a")).toBe("hello");
		expect(m2.get("b")).toBe("world");
		expect(m2.size()).toBe(2);
		m2.destroy();
	});

	it("where() reacts to value updates on existing keys", () => {
		const m = reactiveMap<number>();
		m.set("a", 1);
		m.set("b", 2);

		const evens = m.where((v) => v % 2 === 0);
		expect(evens.get()).toEqual([["b", 2]]);

		// Update existing key — where() should react
		m.set("a", 4);
		expect(evens.get()).toEqual([
			["a", 4],
			["b", 2],
		]);

		m.destroy();
	});
});

describe("NodeV0: reactiveLog", () => {
	it("auto-generates id", () => {
		const log = reactiveLog();
		expect(log.id).toMatch(/^rlog-/);
		log.destroy();
	});

	it("accepts custom id", () => {
		const log = reactiveLog({ id: "my-log" });
		expect(log.id).toBe("my-log");
		log.destroy();
	});

	it("version increments on append and clear", () => {
		const log = reactiveLog<string>();
		expect(log.version).toBe(0);

		log.append("a");
		expect(log.version).toBe(1);

		log.append("b");
		expect(log.version).toBe(2);

		log.clear();
		expect(log.version).toBe(3);

		log.destroy();
	});

	it("snapshot() returns serializable representation", () => {
		const log = reactiveLog<string>({ id: "snap-log" });
		log.append("first");
		log.append("second");

		const snap = log.snapshot();
		expect(snap.type).toBe("reactiveLog");
		expect(snap.id).toBe("snap-log");
		expect(snap.version).toBe(2);
		expect(snap.entries).toEqual([
			{ seq: 1, value: "first" },
			{ seq: 2, value: "second" },
		]);
		expect(snap.headSeq).toBe(1);
		expect(snap.tailSeq).toBe(2);

		const json = JSON.stringify(snap);
		expect(JSON.parse(json).entries).toHaveLength(2);

		log.destroy();
	});

	it("snapshot respects maxSize trimming", () => {
		const log = reactiveLog<string>({ id: "bounded", maxSize: 2 });
		log.append("a");
		log.append("b");
		log.append("c"); // "a" trimmed

		const snap = log.snapshot();
		expect(snap.entries).toEqual([
			{ seq: 2, value: "b" },
			{ seq: 3, value: "c" },
		]);
		expect(snap.headSeq).toBe(2);
		expect(snap.tailSeq).toBe(3);

		log.destroy();
	});

	it("from() restores from snapshot", () => {
		const log1 = reactiveLog<string>({ id: "roundtrip-log" });
		log1.append("a");
		log1.append("b");
		const snap = log1.snapshot();
		log1.destroy();

		const log2 = reactiveLog.from(snap);
		expect(log2.id).toBe("roundtrip-log");
		expect(log2.length).toBe(2);
		expect(log2.toArray().map((e) => e.value)).toEqual(["a", "b"]);
		log2.destroy();
	});
});

describe("NodeV0: reactiveIndex", () => {
	it("auto-generates id", () => {
		const idx = reactiveIndex();
		expect(idx.id).toMatch(/^ridx-/);
		idx.destroy();
	});

	it("accepts custom id", () => {
		const idx = reactiveIndex({ id: "my-index" });
		expect(idx.id).toBe("my-index");
		idx.destroy();
	});

	it("version increments on structural changes", () => {
		const idx = reactiveIndex();
		expect(idx.version).toBe(0);

		idx.add("u1", ["admin"]);
		expect(idx.version).toBe(1); // new index key "admin"

		idx.add("u2", ["admin"]);
		expect(idx.version).toBe(1); // "admin" already exists

		idx.add("u2", ["user"]);
		expect(idx.version).toBe(2); // new index key "user"

		idx.destroy();
	});

	it("snapshot() returns serializable representation", () => {
		const idx = reactiveIndex({ id: "snap-idx" });
		idx.add("u1", ["admin", "active"]);
		idx.add("u2", ["user", "active"]);

		const snap = idx.snapshot();
		expect(snap.type).toBe("reactiveIndex");
		expect(snap.id).toBe("snap-idx");
		expect(snap.index.admin).toEqual(["u1"]);
		expect(snap.index.active?.sort()).toEqual(["u1", "u2"]);
		expect(snap.index.user).toEqual(["u2"]);

		const json = JSON.stringify(snap);
		const parsed = JSON.parse(json);
		expect(parsed.index.admin).toEqual(["u1"]);

		idx.destroy();
	});

	it("from() restores from snapshot", () => {
		const idx1 = reactiveIndex({ id: "roundtrip-idx" });
		idx1.add("u1", ["admin", "active"]);
		idx1.add("u2", ["user", "active"]);
		const snap = idx1.snapshot();
		idx1.destroy();

		const idx2 = reactiveIndex.from(snap);
		expect(idx2.id).toBe("roundtrip-idx");
		expect(idx2.get("admin").has("u1")).toBe(true);
		expect(idx2.get("active").size).toBe(2);
		expect(idx2.get("user").has("u2")).toBe(true);
		idx2.destroy();
	});

	it("get() returns frozen sets for consistency", () => {
		const idx = reactiveIndex();
		idx.add("u1", ["admin"]);

		const existing = idx.get("admin");
		expect(Object.isFrozen(existing)).toBe(true);

		const empty = idx.get("nonexistent");
		expect(Object.isFrozen(empty)).toBe(true);

		idx.destroy();
	});
});

describe("NodeV0: reactiveList", () => {
	it("auto-generates id", () => {
		const list = reactiveList();
		expect(list.id).toMatch(/^rlist-/);
		list.destroy();
	});

	it("accepts custom id", () => {
		const list = reactiveList([], { id: "my-list" });
		expect(list.id).toBe("my-list");
		list.destroy();
	});

	it("version starts at 0 and increments on every mutation", () => {
		const list = reactiveList<number>();
		expect(list.version).toBe(0);

		list.push(1);
		expect(list.version).toBe(1);

		list.push(2);
		expect(list.version).toBe(2);

		list.clear();
		expect(list.version).toBe(3);

		list.destroy();
	});

	it("snapshot() returns serializable representation", () => {
		const list = reactiveList([1, 2, 3], { id: "snap-list" });
		list.push(4);

		const snap = list.snapshot();
		expect(snap.type).toBe("reactiveList");
		expect(snap.id).toBe("snap-list");
		expect(snap.version).toBe(1);
		expect(snap.items).toEqual([1, 2, 3, 4]);

		const json = JSON.stringify(snap);
		const parsed = JSON.parse(json);
		expect(parsed.items).toEqual([1, 2, 3, 4]);

		list.destroy();
	});

	it("from() restores from snapshot", () => {
		const list1 = reactiveList([10, 20, 30], { id: "roundtrip-list" });
		list1.push(40);
		const snap = list1.snapshot();
		list1.destroy();

		const list2 = reactiveList.from(snap);
		expect(list2.id).toBe("roundtrip-list");
		expect(list2.items.get()).toEqual([10, 20, 30, 40]);
		expect(list2.length.get()).toBe(4);
		list2.destroy();
	});

	it("mutations are no-ops after destroy", () => {
		const list = reactiveList([1, 2, 3]);
		const vBefore = list.version;
		list.destroy();

		list.push(4);
		list.set(0, 99);
		list.insert(0, 100);
		// version should not have advanced beyond the pre-destroy value
		expect(list.version).toBe(vBefore);
		// snapshot reflects cleared state
		expect(list.snapshot().items).toEqual([]);
	});
});
