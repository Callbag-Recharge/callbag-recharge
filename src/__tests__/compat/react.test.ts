import { afterEach, describe, expect, it, vi } from "vitest";
import { state } from "../../core/state";

// Mock React APIs — simulate useSyncExternalStore behavior
let lastCleanup: (() => void) | null = null;

vi.mock("react", () => ({
	useSyncExternalStore: (subscribeFn: (cb: () => void) => () => void, getSnapshot: () => any) => {
		const cleanup = subscribeFn(() => {});
		lastCleanup = cleanup;
		return getSnapshot();
	},
	useCallback: (fn: any, _deps: any[]) => fn,
}));

describe("compat/react", () => {
	afterEach(() => {
		lastCleanup?.();
		lastCleanup = null;
	});

	describe("useSubscribe", () => {
		it("returns current store value", async () => {
			const { useSubscribe } = await import("../../compat/react/index");
			const s = state(42);
			const value = useSubscribe(s);
			expect(value).toBe(42);
		});

		it("returns updated value after store change", async () => {
			const { useSubscribe } = await import("../../compat/react/index");
			const s = state(0);

			let value = useSubscribe(s);
			expect(value).toBe(0);

			s.set(10);
			value = useSubscribe(s);
			expect(value).toBe(10);
		});

		it("cleanup function is callable", async () => {
			const { useSubscribe } = await import("../../compat/react/index");
			const s = state(0);
			useSubscribe(s);
			expect(typeof lastCleanup).toBe("function");
			lastCleanup!();
		});
	});

	describe("useStore", () => {
		it("returns [value, setter] tuple", async () => {
			const { useStore } = await import("../../compat/react/index");
			const s = state(5);
			const [value, setter] = useStore(s);
			expect(value).toBe(5);
			expect(typeof setter).toBe("function");
		});

		it("setter calls store.set()", async () => {
			const { useStore } = await import("../../compat/react/index");
			const s = state(0);
			const [, setter] = useStore(s);
			setter(99);
			expect(s.get()).toBe(99);
		});
	});

	describe("useSubscribeRecord", () => {
		it("returns keyed snapshot and updates when field stores change", async () => {
			const { useSubscribeRecord } = await import("../../compat/react/index");
			const keys = state<string[]>(["a", "b"]);
			const counts: Record<string, ReturnType<typeof state<number>>> = {
				a: state(1),
				b: state(2),
			};
			const flags: Record<string, ReturnType<typeof state<boolean>>> = {
				a: state(false),
				b: state(true),
			};

			let value = useSubscribeRecord(keys, (id) => ({
				count: counts[id],
				flag: flags[id],
			}));
			expect(value).toEqual({
				a: { count: 1, flag: false },
				b: { count: 2, flag: true },
			});

			counts.a.set(10);
			value = useSubscribeRecord(keys, (id) => ({
				count: counts[id],
				flag: flags[id],
			}));
			expect(value.a.count).toBe(10);
		});

		it("rebuilds snapshot when keys change", async () => {
			const { useSubscribeRecord } = await import("../../compat/react/index");
			const keys = state<string[]>(["a"]);
			const counts: Record<string, ReturnType<typeof state<number>>> = {
				a: state(1),
				b: state(2),
			};

			let value = useSubscribeRecord(keys, (id) => ({ count: counts[id] }));
			expect(value).toEqual({ a: { count: 1 } });

			keys.set(["b"]);
			value = useSubscribeRecord(keys, (id) => ({ count: counts[id] }));
			expect(value).toEqual({ b: { count: 2 } });
		});
	});
});
