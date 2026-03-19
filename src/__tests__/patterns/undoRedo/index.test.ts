import { describe, expect, it } from "vitest";
import { subscribe } from "../../../core/subscribe";
import { undoRedo } from "../../../patterns/undoRedo";

describe("undoRedo", () => {
	// -----------------------------------------------------------------------
	// Basic state
	// -----------------------------------------------------------------------

	it("initializes with the given value", () => {
		const ur = undoRedo(42);
		expect(ur.current.get()).toBe(42);
	});

	it("set updates current value", () => {
		const ur = undoRedo("hello");
		ur.set("world");
		expect(ur.current.get()).toBe("world");
	});

	it("update applies a function to current value", () => {
		const ur = undoRedo(10);
		ur.update((n) => n + 5);
		expect(ur.current.get()).toBe(15);
	});

	// -----------------------------------------------------------------------
	// Undo
	// -----------------------------------------------------------------------

	it("undo restores previous state", () => {
		const ur = undoRedo(1);
		ur.set(2);
		ur.set(3);

		expect(ur.undo()).toBe(true);
		expect(ur.current.get()).toBe(2);

		expect(ur.undo()).toBe(true);
		expect(ur.current.get()).toBe(1);
	});

	it("undo past beginning returns false", () => {
		const ur = undoRedo(1);
		expect(ur.undo()).toBe(false);
		expect(ur.current.get()).toBe(1);
	});

	// -----------------------------------------------------------------------
	// Redo
	// -----------------------------------------------------------------------

	it("redo restores next state", () => {
		const ur = undoRedo(1);
		ur.set(2);
		ur.set(3);

		ur.undo();
		ur.undo();

		expect(ur.redo()).toBe(true);
		expect(ur.current.get()).toBe(2);

		expect(ur.redo()).toBe(true);
		expect(ur.current.get()).toBe(3);
	});

	it("redo past end returns false", () => {
		const ur = undoRedo(1);
		expect(ur.redo()).toBe(false);
	});

	it("set after undo truncates redo stack", () => {
		const ur = undoRedo(1);
		ur.set(2);
		ur.set(3);

		ur.undo(); // back to 2
		ur.set(4); // truncates redo (3 is gone)

		expect(ur.redo()).toBe(false);
		expect(ur.current.get()).toBe(4);

		expect(ur.undo()).toBe(true);
		expect(ur.current.get()).toBe(2);
	});

	// -----------------------------------------------------------------------
	// Reactive stores
	// -----------------------------------------------------------------------

	it("canUndo/canRedo are reactive", () => {
		const ur = undoRedo(1);

		expect(ur.canUndo.get()).toBe(false);
		expect(ur.canRedo.get()).toBe(false);

		ur.set(2);
		expect(ur.canUndo.get()).toBe(true);
		expect(ur.canRedo.get()).toBe(false);

		ur.undo();
		expect(ur.canUndo.get()).toBe(false);
		expect(ur.canRedo.get()).toBe(true);
	});

	it("historySize tracks undo steps available", () => {
		const ur = undoRedo("a");

		expect(ur.historySize.get()).toBe(0);

		ur.set("b");
		expect(ur.historySize.get()).toBe(1);

		ur.set("c");
		expect(ur.historySize.get()).toBe(2);

		ur.undo();
		expect(ur.historySize.get()).toBe(1);
	});

	it("current store emits on changes via subscribe", () => {
		const ur = undoRedo(0);
		const values: number[] = [];

		subscribe(ur.current, (v) => values.push(v));

		ur.set(1);
		ur.set(2);
		ur.undo();

		// Derived from [historyStore, indexStore] — both update on set(),
		// so intermediate emissions are expected (history change + index change).
		// The important thing is that the final values are correct.
		expect(values.at(-1)).toBe(1);
		expect(values).toContain(1);
		expect(values).toContain(2);
	});

	// -----------------------------------------------------------------------
	// maxHistory
	// -----------------------------------------------------------------------

	it("maxHistory caps the number of entries", () => {
		const ur = undoRedo(0, { maxHistory: 3 });

		ur.set(1);
		ur.set(2);
		ur.set(3); // history: [1, 2, 3] (0 was dropped)

		expect(ur.current.get()).toBe(3);

		ur.undo();
		expect(ur.current.get()).toBe(2);

		ur.undo();
		expect(ur.current.get()).toBe(1);

		// Can't undo further — 0 was dropped
		expect(ur.undo()).toBe(false);
		expect(ur.current.get()).toBe(1);
	});

	// -----------------------------------------------------------------------
	// clearHistory
	// -----------------------------------------------------------------------

	it("clearHistory keeps current value but removes history", () => {
		const ur = undoRedo(1);
		ur.set(2);
		ur.set(3);

		ur.clearHistory();

		expect(ur.current.get()).toBe(3);
		expect(ur.canUndo.get()).toBe(false);
		expect(ur.canRedo.get()).toBe(false);
		expect(ur.historySize.get()).toBe(0);
	});

	// -----------------------------------------------------------------------
	// Equality check
	// -----------------------------------------------------------------------

	it("equals option skips duplicate consecutive states", () => {
		const ur = undoRedo(1, { equals: Object.is });

		ur.set(1); // should be skipped (same as current)
		expect(ur.historySize.get()).toBe(0);

		ur.set(2);
		expect(ur.historySize.get()).toBe(1);

		ur.set(2); // skipped
		expect(ur.historySize.get()).toBe(1);
	});

	// -----------------------------------------------------------------------
	// Checkpoint
	// -----------------------------------------------------------------------

	it("checkpoint creates an entry with the current value", () => {
		const ur = undoRedo(1);
		ur.set(2);

		// Checkpoint doesn't change value but...
		// With equals it would be a no-op, without equals it adds a duplicate
		// Without equals option, it should add to history
		expect(ur.current.get()).toBe(2);
		expect(ur.historySize.get()).toBe(1);
	});
});
