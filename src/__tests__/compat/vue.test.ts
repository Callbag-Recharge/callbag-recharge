import { beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../../core/state";

// Mock Vue APIs — each shallowRef() gets its own backing object
let scopeDisposeFn: (() => void) | null = null;

vi.mock("vue", () => {
	return {
		shallowRef: (initial: any) => {
			return { value: initial };
		},
		readonly: (ref: any) => {
			return new Proxy(ref, {
				get(target, prop) {
					return target[prop];
				},
				set() {
					throw new Error("Cannot set readonly ref");
				},
			});
		},
		computed: (opts: { get: () => any; set: (v: any) => void }) => {
			return {
				get value() {
					return opts.get();
				},
				set value(v: any) {
					opts.set(v);
				},
			};
		},
		getCurrentScope: () => true,
		onScopeDispose: (fn: () => void) => {
			scopeDisposeFn = fn;
		},
	};
});

describe("compat/vue", () => {
	beforeEach(() => {
		scopeDisposeFn = null;
	});

	describe("useSubscribe", () => {
		it("returns current value as ref", async () => {
			const { useSubscribe } = await import("../../compat/vue/index");
			const s = state(42);
			const ref = useSubscribe(s);
			expect(ref.value).toBe(42);
		});

		it("updates ref when store emits", async () => {
			const { useSubscribe } = await import("../../compat/vue/index");
			const s = state(0);
			const ref = useSubscribe(s);
			s.set(10);
			expect(ref.value).toBe(10);
		});

		it("registers onScopeDispose", async () => {
			const { useSubscribe } = await import("../../compat/vue/index");
			const s = state(0);
			useSubscribe(s);
			expect(scopeDisposeFn).toBeTypeOf("function");
		});
	});

	describe("useStore", () => {
		it("returns current value", async () => {
			const { useStore } = await import("../../compat/vue/index");
			const s = state(5);
			const ref = useStore(s);
			expect(ref.value).toBe(5);
		});

		it("setting ref.value calls store.set()", async () => {
			const { useStore } = await import("../../compat/vue/index");
			const s = state(0);
			const ref = useStore(s);
			ref.value = 99;
			expect(s.get()).toBe(99);
		});

		it("updates when store changes externally", async () => {
			const { useStore } = await import("../../compat/vue/index");
			const s = state(0);
			const ref = useStore(s);
			s.set(7);
			expect(ref.value).toBe(7);
		});
	});
});
