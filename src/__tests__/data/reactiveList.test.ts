import { describe, expect, it } from "vitest";
import { subscribe } from "../../core/subscribe";
import { reactiveList } from "../../data/reactiveList";

describe("reactiveList", () => {
	// -----------------------------------------------------------------------
	// Initial state
	// -----------------------------------------------------------------------

	it("initializes with empty array by default", () => {
		const list = reactiveList<number>();
		expect(list.items.get()).toEqual([]);
		expect(list.length.get()).toBe(0);
		expect(list.version.get()).toBe(0);
	});

	it("initializes with provided items", () => {
		const list = reactiveList([1, 2, 3]);
		expect(list.items.get()).toEqual([1, 2, 3]);
		expect(list.length.get()).toBe(3);
	});

	it("does not share internal array with caller", () => {
		const initial = [1, 2, 3];
		const list = reactiveList(initial);
		initial.push(4);
		expect(list.items.get()).toEqual([1, 2, 3]);
	});

	// -----------------------------------------------------------------------
	// get / set
	// -----------------------------------------------------------------------

	it("get returns item at index", () => {
		const list = reactiveList(["a", "b", "c"]);
		expect(list.get(0)).toBe("a");
		expect(list.get(1)).toBe("b");
		expect(list.get(2)).toBe("c");
		expect(list.get(3)).toBeUndefined();
	});

	it("set updates item at index", () => {
		const list = reactiveList([1, 2, 3]);
		list.set(1, 42);
		expect(list.get(1)).toBe(42);
		expect(list.items.get()).toEqual([1, 42, 3]);
	});

	it("set out of bounds is a no-op", () => {
		const list = reactiveList([1, 2]);
		const v = list.version.get();
		list.set(5, 99);
		expect(list.version.get()).toBe(v);
	});

	// -----------------------------------------------------------------------
	// push / pop
	// -----------------------------------------------------------------------

	it("push appends items", () => {
		const list = reactiveList([1]);
		list.push(2, 3);
		expect(list.items.get()).toEqual([1, 2, 3]);
		expect(list.length.get()).toBe(3);
	});

	it("push with no args is a no-op", () => {
		const list = reactiveList([1]);
		const v = list.version.get();
		list.push();
		expect(list.version.get()).toBe(v);
	});

	it("pop removes and returns last item", () => {
		const list = reactiveList([1, 2, 3]);
		const item = list.pop();
		expect(item).toBe(3);
		expect(list.items.get()).toEqual([1, 2]);
	});

	it("pop on empty list returns undefined", () => {
		const list = reactiveList<number>();
		expect(list.pop()).toBeUndefined();
	});

	// -----------------------------------------------------------------------
	// insert / remove
	// -----------------------------------------------------------------------

	it("insert adds items at index", () => {
		const list = reactiveList([1, 4]);
		list.insert(1, 2, 3);
		expect(list.items.get()).toEqual([1, 2, 3, 4]);
	});

	it("insert at 0 prepends", () => {
		const list = reactiveList([2, 3]);
		list.insert(0, 1);
		expect(list.items.get()).toEqual([1, 2, 3]);
	});

	it("insert beyond length appends", () => {
		const list = reactiveList([1]);
		list.insert(100, 2);
		expect(list.items.get()).toEqual([1, 2]);
	});

	it("insert with negative index is a no-op", () => {
		const list = reactiveList([1, 2]);
		const v = list.version.get();
		list.insert(-1, 99);
		expect(list.version.get()).toBe(v);
		expect(list.items.get()).toEqual([1, 2]);
	});

	it("insert with no items is a no-op", () => {
		const list = reactiveList([1]);
		const v = list.version.get();
		list.insert(0);
		expect(list.version.get()).toBe(v);
	});

	it("remove removes items at index", () => {
		const list = reactiveList([1, 2, 3, 4]);
		const removed = list.remove(1, 2);
		expect(removed).toEqual([2, 3]);
		expect(list.items.get()).toEqual([1, 4]);
	});

	it("remove defaults to count=1", () => {
		const list = reactiveList([1, 2, 3]);
		const removed = list.remove(1);
		expect(removed).toEqual([2]);
		expect(list.items.get()).toEqual([1, 3]);
	});

	it("remove out of bounds returns empty", () => {
		const list = reactiveList([1, 2]);
		expect(list.remove(-1)).toEqual([]);
		expect(list.remove(5)).toEqual([]);
	});

	// -----------------------------------------------------------------------
	// move / swap
	// -----------------------------------------------------------------------

	it("move moves item from one index to another", () => {
		const list = reactiveList(["a", "b", "c", "d"]);
		list.move(3, 1);
		expect(list.items.get()).toEqual(["a", "d", "b", "c"]);
	});

	it("move same index is a no-op", () => {
		const list = reactiveList([1, 2, 3]);
		const v = list.version.get();
		list.move(1, 1);
		expect(list.version.get()).toBe(v);
	});

	it("move out of bounds is a no-op", () => {
		const list = reactiveList([1, 2]);
		const v = list.version.get();
		list.move(-1, 0);
		expect(list.version.get()).toBe(v);
		list.move(0, 5);
		expect(list.version.get()).toBe(v);
	});

	it("swap exchanges items at two indices", () => {
		const list = reactiveList([1, 2, 3]);
		list.swap(0, 2);
		expect(list.items.get()).toEqual([3, 2, 1]);
	});

	it("swap same index is a no-op", () => {
		const list = reactiveList([1, 2]);
		const v = list.version.get();
		list.swap(0, 0);
		expect(list.version.get()).toBe(v);
	});

	// -----------------------------------------------------------------------
	// clear
	// -----------------------------------------------------------------------

	it("clear removes all items", () => {
		const list = reactiveList([1, 2, 3]);
		list.clear();
		expect(list.items.get()).toEqual([]);
		expect(list.length.get()).toBe(0);
	});

	it("clear on empty list is a no-op", () => {
		const list = reactiveList<number>();
		const v = list.version.get();
		list.clear();
		expect(list.version.get()).toBe(v);
	});

	// -----------------------------------------------------------------------
	// Reactive derived stores
	// -----------------------------------------------------------------------

	it("at() returns a reactive store for a specific index", () => {
		const list = reactiveList([10, 20, 30]);
		const at1 = list.at(1);
		expect(at1.get()).toBe(20);

		list.set(1, 99);
		expect(at1.get()).toBe(99);
	});

	it("at() updates when structural changes affect the index", () => {
		const list = reactiveList([10, 20, 30]);
		const at1 = list.at(1);
		expect(at1.get()).toBe(20);

		list.insert(0, 5);
		// items: [5, 10, 20, 30] — at(1) is now 10
		expect(at1.get()).toBe(10);
	});

	it("at() returns cached store for same index", () => {
		const list = reactiveList([1, 2, 3]);
		const a = list.at(0);
		const b = list.at(0);
		expect(a).toBe(b);
	});

	it("at() returns undefined for out-of-bounds index", () => {
		const list = reactiveList([1, 2]);
		expect(list.at(5).get()).toBeUndefined();
	});

	it("slice() returns a reactive slice", () => {
		const list = reactiveList([1, 2, 3, 4, 5]);
		const s = list.slice(1, 3);
		expect(s.get()).toEqual([2, 3]);

		list.set(1, 99);
		expect(s.get()).toEqual([99, 3]);
	});

	it("slice() returns cached store for same range", () => {
		const list = reactiveList([1, 2, 3]);
		const a = list.slice(0, 2);
		const b = list.slice(0, 2);
		expect(a).toBe(b);
	});

	it("find() returns a reactive find", () => {
		const list = reactiveList([1, 2, 3, 4, 5]);
		const even = list.find((x) => x % 2 === 0);
		expect(even.get()).toBe(2);

		list.remove(1); // remove the 2
		expect(even.get()).toBe(4);
	});

	// -----------------------------------------------------------------------
	// Version tracking
	// -----------------------------------------------------------------------

	it("version bumps on every mutation", () => {
		const list = reactiveList([1]);
		const v0 = list.version.get();

		list.push(2);
		expect(list.version.get()).toBe(v0 + 1);

		list.pop();
		expect(list.version.get()).toBe(v0 + 2);

		list.set(0, 99);
		expect(list.version.get()).toBe(v0 + 3);
	});

	// -----------------------------------------------------------------------
	// Reactivity via subscribe
	// -----------------------------------------------------------------------

	it("items store emits on mutations", () => {
		const list = reactiveList<number>([]);
		const snapshots: readonly number[][] = [];

		subscribe(list.items, (v) => snapshots.push(v));

		list.push(1);
		list.push(2);

		expect(snapshots).toEqual([[1], [1, 2]]);
	});

	it("length store emits on structural changes", () => {
		const list = reactiveList<number>([]);
		const lengths: number[] = [];

		subscribe(list.length, (v) => lengths.push(v));

		list.push(1);
		list.push(2);
		list.pop();

		expect(lengths).toEqual([1, 2, 1]);
	});

	// -----------------------------------------------------------------------
	// snapshot
	// -----------------------------------------------------------------------

	it("snapshot returns a copy of items", () => {
		const list = reactiveList([1, 2, 3]);
		const snap = list.snapshot();
		expect(snap).toEqual([1, 2, 3]);

		list.push(4);
		expect(snap).toEqual([1, 2, 3]); // snapshot is independent
	});

	// -----------------------------------------------------------------------
	// destroy
	// -----------------------------------------------------------------------

	it("destroy clears items and caches", () => {
		const list = reactiveList([1, 2, 3]);
		list.at(0);
		list.at(1);
		list.slice(0, 2);
		list.destroy();

		expect(list.get(0)).toBeUndefined();
		expect(list.snapshot()).toEqual([]);
	});
});
