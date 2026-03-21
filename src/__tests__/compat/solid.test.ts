import { describe, expect, it, vi } from "vitest";
import { state } from "../../core/state";

// Mock Solid APIs
let cleanupFn: (() => void) | null = null;

vi.mock("solid-js", () => ({
	createSignal: (initial: any, _opts?: any) => {
		let value = initial;
		const getter = () => value;
		const setter = (fn: any) => {
			value = typeof fn === "function" ? fn(value) : fn;
		};
		return [getter, setter];
	},
	getOwner: () => true,
	onCleanup: (fn: () => void) => {
		cleanupFn = fn;
	},
}));

describe("compat/solid", () => {
	describe("useSubscribe", () => {
		it("returns current store value", async () => {
			cleanupFn = null;
			const { useSubscribe } = await import("../../compat/solid/index");
			const s = state(42);
			const value = useSubscribe(s);
			expect(value()).toBe(42);
		});

		it("updates when store emits", async () => {
			cleanupFn = null;
			const { useSubscribe } = await import("../../compat/solid/index");
			const s = state(0);
			const value = useSubscribe(s);
			s.set(10);
			expect(value()).toBe(10);
		});

		it("registers onCleanup", async () => {
			cleanupFn = null;
			const { useSubscribe } = await import("../../compat/solid/index");
			const s = state(0);
			useSubscribe(s);
			expect(cleanupFn).toBeTypeOf("function");
		});

		it("cleanup stops subscription", async () => {
			cleanupFn = null;
			const { useSubscribe } = await import("../../compat/solid/index");
			const s = state(0);
			const value = useSubscribe(s);
			s.set(5);
			expect(value()).toBe(5);
			cleanupFn!();
			s.set(99);
			// After cleanup, the signal retains its last value but won't update
			expect(value()).toBe(5);
		});
	});
});
