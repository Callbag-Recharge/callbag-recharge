import { describe, expect, it } from "vitest";
import { effect } from "../../core/effect";
import { reactiveIndex } from "../../data/reactiveIndex";

describe("reactiveIndex", () => {
	// --- Basic add/get ---

	it("adds a primary key under index keys", () => {
		const idx = reactiveIndex();
		idx.add("u1", ["admin", "active"]);
		expect(idx.get("admin")).toEqual(new Set(["u1"]));
		expect(idx.get("active")).toEqual(new Set(["u1"]));
	});

	it("multiple primaries under same index key", () => {
		const idx = reactiveIndex();
		idx.add("u1", ["admin"]);
		idx.add("u2", ["admin"]);
		idx.add("u3", ["user"]);
		expect(idx.get("admin")).toEqual(new Set(["u1", "u2"]));
		expect(idx.get("user")).toEqual(new Set(["u3"]));
	});

	it("get returns empty set for unknown index key", () => {
		const idx = reactiveIndex();
		expect(idx.get("nope")).toEqual(new Set());
		expect(idx.get("nope").size).toBe(0);
	});

	it("has returns true for populated keys", () => {
		const idx = reactiveIndex();
		idx.add("u1", ["admin"]);
		expect(idx.has("admin")).toBe(true);
		expect(idx.has("nope")).toBe(false);
	});

	it("keys returns all index keys", () => {
		const idx = reactiveIndex();
		idx.add("u1", ["admin", "active"]);
		idx.add("u2", ["active"]);
		expect(idx.keys().sort()).toEqual(["active", "admin"]);
	});

	it("size tracks distinct index keys", () => {
		const idx = reactiveIndex();
		expect(idx.size).toBe(0);
		idx.add("u1", ["admin", "active"]);
		expect(idx.size).toBe(2);
		idx.add("u2", ["active"]);
		expect(idx.size).toBe(2); // still 2
	});

	// --- Remove ---

	it("remove removes primary from all index keys", () => {
		const idx = reactiveIndex();
		idx.add("u1", ["admin", "active"]);
		idx.add("u2", ["admin"]);
		idx.remove("u1");
		expect(idx.get("admin")).toEqual(new Set(["u2"]));
		expect(idx.get("active")).toEqual(new Set()); // empty after u1 removed
		expect(idx.has("active")).toBe(false);
	});

	it("remove of unknown primary is a no-op", () => {
		const idx = reactiveIndex();
		idx.add("u1", ["admin"]);
		idx.remove("u99"); // should not throw
		expect(idx.get("admin")).toEqual(new Set(["u1"]));
	});

	it("remove cleans up empty index keys", () => {
		const idx = reactiveIndex();
		idx.add("u1", ["admin"]);
		idx.remove("u1");
		expect(idx.size).toBe(0);
		expect(idx.keys()).toEqual([]);
	});

	// --- Update ---

	it("update replaces index keys for a primary", () => {
		const idx = reactiveIndex();
		idx.add("u1", ["admin", "active"]);
		idx.update("u1", ["admin", "suspended"]);
		expect(idx.get("admin")).toEqual(new Set(["u1"])); // still there
		expect(idx.get("active")).toEqual(new Set()); // removed
		expect(idx.get("suspended")).toEqual(new Set(["u1"])); // added
	});

	it("update with no previous keys acts like add", () => {
		const idx = reactiveIndex();
		idx.update("u1", ["admin"]);
		expect(idx.get("admin")).toEqual(new Set(["u1"]));
	});

	it("update to empty removes all index keys for primary", () => {
		const idx = reactiveIndex();
		idx.add("u1", ["admin", "active"]);
		idx.update("u1", []);
		expect(idx.get("admin")).toEqual(new Set());
		expect(idx.get("active")).toEqual(new Set());
		expect(idx.size).toBe(0);
	});

	// --- Clear ---

	it("clear removes all entries", () => {
		const idx = reactiveIndex();
		idx.add("u1", ["admin"]);
		idx.add("u2", ["user"]);
		idx.clear();
		expect(idx.size).toBe(0);
		expect(idx.get("admin")).toEqual(new Set());
	});

	// --- Reactive: select ---

	it("select returns reactive store of primary keys for an index key", () => {
		const idx = reactiveIndex();
		const adminStore = idx.select("admin");
		expect(adminStore.get()).toEqual(new Set());

		idx.add("u1", ["admin"]);
		expect(adminStore.get()).toEqual(new Set(["u1"]));

		idx.add("u2", ["admin"]);
		expect(adminStore.get()).toEqual(new Set(["u1", "u2"]));

		idx.remove("u1");
		expect(adminStore.get()).toEqual(new Set(["u2"]));
	});

	it("select is cached — same key returns same store", () => {
		const idx = reactiveIndex();
		expect(idx.select("admin")).toBe(idx.select("admin"));
	});

	it("select triggers effect on changes", () => {
		const idx = reactiveIndex();
		const store = idx.select("admin");
		const snapshots: Set<string>[] = [];
		effect([store], () => {
			snapshots.push(new Set(store.get()));
		});

		idx.add("u1", ["admin"]);
		idx.add("u2", ["admin"]);
		idx.remove("u1");

		// Initial + 3 changes
		expect(snapshots.length).toBe(4);
		expect(snapshots[0]).toEqual(new Set()); // initial
		expect(snapshots[1]).toEqual(new Set(["u1"]));
		expect(snapshots[2]).toEqual(new Set(["u1", "u2"]));
		expect(snapshots[3]).toEqual(new Set(["u2"]));
	});

	// --- Reactive: keysStore ---

	it("keysStore is reactive", () => {
		const idx = reactiveIndex();
		const allKeys: string[][] = [];
		effect([idx.keysStore], () => {
			allKeys.push(idx.keysStore.get().slice().sort());
		});

		idx.add("u1", ["admin"]);
		idx.add("u2", ["user"]);
		idx.remove("u1"); // removes "admin" key

		expect(allKeys[0]).toEqual([]); // initial
		expect(allKeys[1]).toEqual(["admin"]);
		expect(allKeys[2]).toEqual(["admin", "user"]);
		expect(allKeys[3]).toEqual(["user"]);
	});

	// --- Reactive: sizeStore ---

	it("sizeStore is reactive", () => {
		const idx = reactiveIndex();
		const sizes: number[] = [];
		effect([idx.sizeStore], () => {
			sizes.push(idx.sizeStore.get());
		});

		idx.add("u1", ["admin", "active"]);
		idx.add("u2", ["admin"]); // no new index keys

		expect(sizes[0]).toBe(0);
		expect(sizes[1]).toBe(2); // admin + active
		// u2 under existing "admin" — no structural change,
		// but the version still bumps only if new index keys added.
		// Since "admin" already exists, size stays 2.
	});

	// --- Lifecycle ---

	it("destroy prevents further mutations", () => {
		const idx = reactiveIndex();
		idx.add("u1", ["admin"]);
		idx.destroy();
		idx.add("u2", ["admin"]); // should be no-op
		// After destroy, internal state is cleared
		expect(idx.size).toBe(0);
	});

	// --- Edge cases ---

	it("add with empty indexKeys is a no-op", () => {
		const idx = reactiveIndex();
		idx.add("u1", []);
		expect(idx.size).toBe(0);
	});

	it("multiple updates to the same primary", () => {
		const idx = reactiveIndex();
		idx.add("u1", ["a", "b"]);
		idx.update("u1", ["b", "c"]);
		idx.update("u1", ["d"]);
		expect(idx.get("a")).toEqual(new Set());
		expect(idx.get("b")).toEqual(new Set());
		expect(idx.get("c")).toEqual(new Set());
		expect(idx.get("d")).toEqual(new Set(["u1"]));
	});
});
