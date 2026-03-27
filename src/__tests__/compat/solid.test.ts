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

	describe("useSubscribeRecord", () => {
		it("returns keyed snapshot and updates nested fields", async () => {
			cleanupFn = null;
			const { useSubscribeRecord } = await import("../../compat/solid/index");
			const keys = state<string[]>(["a", "b"]);
			const counts: Record<string, ReturnType<typeof state<number>>> = {
				a: state(1),
				b: state(2),
			};
			const flags: Record<string, ReturnType<typeof state<boolean>>> = {
				a: state(false),
				b: state(true),
			};

			const value = useSubscribeRecord(keys, (id) => ({
				count: counts[id],
				flag: flags[id],
			}));

			expect(value()).toEqual({
				a: { count: 1, flag: false },
				b: { count: 2, flag: true },
			});

			counts.a.set(10);
			expect(value().a.count).toBe(10);
		});

		it("rebuilds snapshot when keys change", async () => {
			cleanupFn = null;
			const { useSubscribeRecord } = await import("../../compat/solid/index");
			const keys = state<string[]>(["a"]);
			const counts: Record<string, ReturnType<typeof state<number>>> = {
				a: state(1),
				b: state(2),
			};

			const value = useSubscribeRecord(keys, (id) => ({ count: counts[id] }));
			expect(value()).toEqual({ a: { count: 1 } });
			keys.set(["b"]);
			expect(value()).toEqual({ b: { count: 2 } });
		});
	});
});
