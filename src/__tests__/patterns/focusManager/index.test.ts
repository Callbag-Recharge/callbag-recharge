import { describe, expect, it } from "vitest";
import { subscribe } from "../../../core/subscribe";
import { focusManager } from "../../../patterns/focusManager";

describe("focusManager", () => {
	// -----------------------------------------------------------------------
	// Initial state
	// -----------------------------------------------------------------------

	it("initializes with no focus by default", () => {
		const fm = focusManager(["a", "b", "c"]);
		expect(fm.active.get()).toBeNull();
		expect(fm.hasFocus.get()).toBe(false);
	});

	it("initializes with specified initial focus", () => {
		const fm = focusManager(["a", "b", "c"], { initial: "b" });
		expect(fm.active.get()).toBe("b");
		expect(fm.hasFocus.get()).toBe(true);
	});

	it("works with empty initial IDs", () => {
		const fm = focusManager();
		expect(fm.active.get()).toBeNull();
	});

	it("ignores initial ID not in registered IDs", () => {
		const fm = focusManager(["a", "b"], { initial: "z" });
		expect(fm.active.get()).toBeNull();
	});

	// -----------------------------------------------------------------------
	// focus / blur
	// -----------------------------------------------------------------------

	it("focus sets the active element", () => {
		const fm = focusManager(["a", "b", "c"]);
		fm.focus("b");
		expect(fm.active.get()).toBe("b");
		expect(fm.hasFocus.get()).toBe(true);
	});

	it("focus ignores unregistered IDs", () => {
		const fm = focusManager(["a", "b"]);
		fm.focus("z");
		expect(fm.active.get()).toBeNull();
	});

	it("blur removes focus", () => {
		const fm = focusManager(["a", "b"]);
		fm.focus("a");
		fm.blur();
		expect(fm.active.get()).toBeNull();
		expect(fm.hasFocus.get()).toBe(false);
	});

	// -----------------------------------------------------------------------
	// next / prev
	// -----------------------------------------------------------------------

	it("next moves to next element", () => {
		const fm = focusManager(["a", "b", "c"]);
		fm.focus("a");
		fm.next();
		expect(fm.active.get()).toBe("b");
		fm.next();
		expect(fm.active.get()).toBe("c");
	});

	it("next wraps around by default", () => {
		const fm = focusManager(["a", "b", "c"]);
		fm.focus("c");
		fm.next();
		expect(fm.active.get()).toBe("a");
	});

	it("next does not wrap when wrap=false", () => {
		const fm = focusManager(["a", "b", "c"], { wrap: false });
		fm.focus("c");
		fm.next();
		expect(fm.active.get()).toBe("c"); // stays at end
	});

	it("next focuses first element when nothing focused", () => {
		const fm = focusManager(["a", "b", "c"]);
		fm.next();
		expect(fm.active.get()).toBe("a");
	});

	it("prev moves to previous element", () => {
		const fm = focusManager(["a", "b", "c"]);
		fm.focus("c");
		fm.prev();
		expect(fm.active.get()).toBe("b");
		fm.prev();
		expect(fm.active.get()).toBe("a");
	});

	it("prev wraps around by default", () => {
		const fm = focusManager(["a", "b", "c"]);
		fm.focus("a");
		fm.prev();
		expect(fm.active.get()).toBe("c");
	});

	it("prev does not wrap when wrap=false", () => {
		const fm = focusManager(["a", "b", "c"], { wrap: false });
		fm.focus("a");
		fm.prev();
		expect(fm.active.get()).toBe("a"); // stays at start
	});

	it("prev focuses last element when nothing focused", () => {
		const fm = focusManager(["a", "b", "c"]);
		fm.prev();
		expect(fm.active.get()).toBe("c");
	});

	it("next/prev on empty list is a no-op", () => {
		const fm = focusManager();
		fm.next();
		expect(fm.active.get()).toBeNull();
		fm.prev();
		expect(fm.active.get()).toBeNull();
	});

	// -----------------------------------------------------------------------
	// register / unregister
	// -----------------------------------------------------------------------

	it("register adds a new focusable ID", () => {
		const fm = focusManager(["a", "b"]);
		fm.register("c");
		fm.focus("c");
		expect(fm.active.get()).toBe("c");
	});

	it("register is idempotent", () => {
		const fm = focusManager(["a"]);
		fm.register("a");
		fm.focus("a");
		fm.next();
		// If registered twice, next would skip or duplicate — verify it's still correct
		expect(fm.active.get()).toBe("a"); // wraps back to only element
	});

	it("unregister removes a focusable ID", () => {
		const fm = focusManager(["a", "b", "c"]);
		fm.unregister("b");
		fm.focus("b");
		expect(fm.active.get()).toBeNull(); // b is no longer registered
	});

	it("unregister blurs if focused element is unregistered", () => {
		const fm = focusManager(["a", "b", "c"]);
		fm.focus("b");
		fm.unregister("b");
		expect(fm.active.get()).toBeNull();
	});

	it("unregister of non-existent ID is a no-op", () => {
		const fm = focusManager(["a"]);
		fm.unregister("z"); // should not throw
		expect(fm.active.get()).toBeNull();
	});

	// -----------------------------------------------------------------------
	// isFocused
	// -----------------------------------------------------------------------

	it("isFocused returns reactive store per ID", () => {
		const fm = focusManager(["a", "b", "c"]);

		const isA = fm.isFocused("a");
		const isB = fm.isFocused("b");

		expect(isA.get()).toBe(false);
		expect(isB.get()).toBe(false);

		fm.focus("a");
		expect(isA.get()).toBe(true);
		expect(isB.get()).toBe(false);

		fm.focus("b");
		expect(isA.get()).toBe(false);
		expect(isB.get()).toBe(true);
	});

	it("isFocused returns cached store for same ID", () => {
		const fm = focusManager(["a"]);
		expect(fm.isFocused("a")).toBe(fm.isFocused("a"));
	});

	it("isFocused emits on focus change", () => {
		const fm = focusManager(["a", "b"]);
		const values: boolean[] = [];

		subscribe(fm.isFocused("a"), (v) => values.push(v));

		fm.focus("a");
		fm.focus("b");
		fm.focus("a");

		expect(values).toEqual([true, false, true]);
	});

	// -----------------------------------------------------------------------
	// Reactivity
	// -----------------------------------------------------------------------

	it("active store emits on focus changes", () => {
		const fm = focusManager(["a", "b"]);
		const values: (string | null)[] = [];

		subscribe(fm.active, (v) => values.push(v));

		fm.focus("a");
		fm.focus("b");
		fm.blur();

		expect(values).toEqual(["a", "b", null]);
	});

	// -----------------------------------------------------------------------
	// Dispose
	// -----------------------------------------------------------------------

	it("dispose prevents further operations", () => {
		const fm = focusManager(["a", "b"]);
		fm.focus("a");
		fm.dispose();

		fm.focus("b"); // no-op
		expect(fm.active.get()).toBeNull(); // cleared on dispose
	});

	it("dispose clears registered IDs", () => {
		const fm = focusManager(["a", "b"]);
		fm.dispose();

		fm.next(); // no-op (disposed)
		expect(fm.active.get()).toBeNull();
	});
});
