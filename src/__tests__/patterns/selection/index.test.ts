import { describe, expect, it } from "vitest";
import { state } from "../../../core/state";
import { subscribe } from "../../../core/subscribe";
import { selection } from "../../../patterns/selection";

describe("selection", () => {
	// -----------------------------------------------------------------------
	// Initial state
	// -----------------------------------------------------------------------

	it("initializes with start=0, end=0", () => {
		const sel = selection();
		expect(sel.start.get()).toBe(0);
		expect(sel.end.get()).toBe(0);
		expect(sel.collapsed.get()).toBe(true);
		expect(sel.size.get()).toBe(0);
		expect(sel.direction.get()).toBe("none");
	});

	// -----------------------------------------------------------------------
	// select()
	// -----------------------------------------------------------------------

	it("select sets start and end", () => {
		const sel = selection();
		sel.select(5, 15);
		expect(sel.start.get()).toBe(5);
		expect(sel.end.get()).toBe(15);
	});

	it("select updates derived stores", () => {
		const sel = selection();
		sel.select(10, 20);
		expect(sel.collapsed.get()).toBe(false);
		expect(sel.size.get()).toBe(10);
		expect(sel.direction.get()).toBe("forward");
	});

	it("backward selection sets direction to backward", () => {
		const sel = selection();
		sel.select(20, 10);
		expect(sel.direction.get()).toBe("backward");
		expect(sel.size.get()).toBe(10);
	});

	// -----------------------------------------------------------------------
	// collapse()
	// -----------------------------------------------------------------------

	it("collapse sets start=end=position", () => {
		const sel = selection();
		sel.select(5, 15);
		sel.collapse(10);
		expect(sel.start.get()).toBe(10);
		expect(sel.end.get()).toBe(10);
		expect(sel.collapsed.get()).toBe(true);
		expect(sel.size.get()).toBe(0);
		expect(sel.direction.get()).toBe("none");
	});

	it("collapseToStart collapses to minimum of start/end", () => {
		const sel = selection();
		sel.select(20, 10);
		sel.collapseToStart();
		expect(sel.start.get()).toBe(10);
		expect(sel.end.get()).toBe(10);
	});

	it("collapseToEnd collapses to maximum of start/end", () => {
		const sel = selection();
		sel.select(20, 10);
		sel.collapseToEnd();
		expect(sel.start.get()).toBe(20);
		expect(sel.end.get()).toBe(20);
	});

	// -----------------------------------------------------------------------
	// extend()
	// -----------------------------------------------------------------------

	it("extend moves end by delta", () => {
		const sel = selection();
		sel.select(5, 10);
		sel.extend(5);
		expect(sel.start.get()).toBe(5);
		expect(sel.end.get()).toBe(15);
		expect(sel.size.get()).toBe(10);
	});

	it("extend with negative delta shrinks selection", () => {
		const sel = selection();
		sel.select(5, 15);
		sel.extend(-5);
		expect(sel.end.get()).toBe(10);
		expect(sel.size.get()).toBe(5);
	});

	// -----------------------------------------------------------------------
	// moveCursor()
	// -----------------------------------------------------------------------

	it("moveCursor collapses and moves by delta", () => {
		const sel = selection();
		sel.select(5, 15);
		sel.moveCursor(3);
		// moves from end (15) + 3 = 18
		expect(sel.start.get()).toBe(18);
		expect(sel.end.get()).toBe(18);
		expect(sel.collapsed.get()).toBe(true);
	});

	// -----------------------------------------------------------------------
	// selectAll()
	// -----------------------------------------------------------------------

	it("selectAll without length selects 0 to 0", () => {
		const sel = selection();
		sel.selectAll();
		expect(sel.start.get()).toBe(0);
		expect(sel.end.get()).toBe(0);
	});

	it("selectAll with length selects 0 to length", () => {
		const sel = selection({ length: 100 });
		sel.selectAll();
		expect(sel.start.get()).toBe(0);
		expect(sel.end.get()).toBe(100);
		expect(sel.size.get()).toBe(100);
	});

	// -----------------------------------------------------------------------
	// Boundary clamping
	// -----------------------------------------------------------------------

	it("clamps positions to [0, length]", () => {
		const sel = selection({ length: 50 });
		sel.select(-10, 100);
		expect(sel.start.get()).toBe(0);
		expect(sel.end.get()).toBe(50);
	});

	it("clamps moveCursor to [0, length]", () => {
		const sel = selection({ length: 10 });
		sel.collapse(8);
		sel.moveCursor(100);
		expect(sel.start.get()).toBe(10);
		expect(sel.end.get()).toBe(10);
	});

	it("clamps extend to [0, length]", () => {
		const sel = selection({ length: 20 });
		sel.select(5, 15);
		sel.extend(100);
		expect(sel.end.get()).toBe(20);
	});

	// -----------------------------------------------------------------------
	// Reactive length
	// -----------------------------------------------------------------------

	it("collapseToStart re-clamps against current length", () => {
		const len = state(50);
		const sel = selection({ length: len });
		sel.select(10, 40);
		len.set(20); // shrink length
		sel.collapseToStart();
		expect(sel.start.get()).toBe(10);
		expect(sel.end.get()).toBe(10);
	});

	it("collapseToEnd re-clamps against current length", () => {
		const len = state(50);
		const sel = selection({ length: len });
		sel.select(10, 40);
		len.set(20); // shrink length — end(40) > length(20)
		sel.collapseToEnd();
		expect(sel.start.get()).toBe(20); // clamped
		expect(sel.end.get()).toBe(20);
	});

	it("supports reactive length via Store", () => {
		const len = state(50);
		const sel = selection({ length: len });

		sel.select(0, 100);
		expect(sel.end.get()).toBe(50); // clamped to 50

		len.set(30);
		sel.select(0, 100);
		expect(sel.end.get()).toBe(30); // clamped to new length
	});

	// -----------------------------------------------------------------------
	// Single mode
	// -----------------------------------------------------------------------

	it("single mode: select always collapses end to start", () => {
		const sel = selection({ mode: "single" });
		sel.select(5, 15);
		expect(sel.start.get()).toBe(5);
		expect(sel.end.get()).toBe(5);
		expect(sel.collapsed.get()).toBe(true);
	});

	it("single mode: extend is a no-op", () => {
		const sel = selection({ mode: "single" });
		sel.collapse(5);
		sel.extend(10);
		expect(sel.end.get()).toBe(5);
	});

	it("single mode: selectAll collapses to 0", () => {
		const sel = selection({ mode: "single" });
		sel.collapse(5);
		sel.selectAll();
		expect(sel.start.get()).toBe(0);
		expect(sel.end.get()).toBe(0);
	});

	// -----------------------------------------------------------------------
	// Batch atomicity
	// -----------------------------------------------------------------------

	it("select updates start+end atomically via batch", () => {
		const sel = selection();
		const values: Array<[number, number]> = [];

		// Subscribe to both start and end
		subscribe(sel.size, (_s) => {
			values.push([sel.start.get(), sel.end.get()]);
		});

		sel.select(10, 20);

		// Should see the final state, not an intermediate [10, 0] or [0, 20]
		expect(values.length).toBeGreaterThanOrEqual(1);
		expect(values[values.length - 1]).toEqual([10, 20]);
	});

	// -----------------------------------------------------------------------
	// Dispose
	// -----------------------------------------------------------------------

	it("dispose prevents further operations", () => {
		const sel = selection();
		sel.select(5, 10);
		sel.dispose();

		sel.select(20, 30); // no-op
		expect(sel.start.get()).toBe(5);
		expect(sel.end.get()).toBe(10);
	});

	it("dispose is idempotent", () => {
		const sel = selection();
		sel.dispose();
		sel.dispose(); // should not throw
	});
});
