import { describe, expect, it } from "vitest";
import { useSubscribe, useSubscribeRecord } from "../../compat/svelte/index";
import { state } from "../../core/state";

describe("compat/svelte", () => {
	describe("useSubscribe", () => {
		it("calls subscriber immediately with current value", () => {
			const s = state(42);
			const readable = useSubscribe(s);
			const values: number[] = [];
			const unsub = readable.subscribe((v) => values.push(v));
			expect(values).toEqual([42]);
			unsub();
		});

		it("notifies subscriber on store changes", () => {
			const s = state(0);
			const readable = useSubscribe(s);
			const values: number[] = [];
			const unsub = readable.subscribe((v) => values.push(v));
			s.set(10);
			s.set(20);
			expect(values).toEqual([0, 10, 20]);
			unsub();
		});

		it("unsubscribe stops notifications", () => {
			const s = state(0);
			const readable = useSubscribe(s);
			const values: number[] = [];
			const unsub = readable.subscribe((v) => values.push(v));
			s.set(1);
			unsub();
			s.set(2);
			expect(values).toEqual([0, 1]);
		});

		it("supports multiple subscribers", () => {
			const s = state(0);
			const readable = useSubscribe(s);
			const a: number[] = [];
			const b: number[] = [];
			const unsub1 = readable.subscribe((v) => a.push(v));
			const unsub2 = readable.subscribe((v) => b.push(v));
			s.set(5);
			expect(a).toEqual([0, 5]);
			expect(b).toEqual([0, 5]);
			// Unsubscribing one does not affect the other
			unsub1();
			s.set(9);
			expect(a).toEqual([0, 5]);
			expect(b).toEqual([0, 5, 9]);
			unsub2();
		});
	});

	describe("useSubscribeRecord", () => {
		it("emits keyed snapshots and updates nested fields", () => {
			const keys = state<string[]>(["a", "b"]);
			const counts: Record<string, ReturnType<typeof state<number>>> = {
				a: state(1),
				b: state(2),
			};
			const flags: Record<string, ReturnType<typeof state<boolean>>> = {
				a: state(false),
				b: state(true),
			};

			const readable = useSubscribeRecord(keys, (id) => ({
				count: counts[id],
				flag: flags[id],
			}));
			const values: Array<Record<string, { count: number; flag: boolean }>> = [];
			const unsub = readable.subscribe((v) => values.push(v));

			expect(values[0]).toEqual({
				a: { count: 1, flag: false },
				b: { count: 2, flag: true },
			});

			counts.a.set(9);
			expect(values[values.length - 1].a.count).toBe(9);

			unsub();
		});

		it("re-subscribes when keys change", () => {
			const keys = state<string[]>(["a"]);
			const counts: Record<string, ReturnType<typeof state<number>>> = {
				a: state(1),
				b: state(2),
			};

			const readable = useSubscribeRecord(keys, (id) => ({ count: counts[id] }));
			const values: Array<Record<string, { count: number }>> = [];
			const unsub = readable.subscribe((v) => values.push(v));

			expect(values[0]).toEqual({ a: { count: 1 } });
			keys.set(["b"]);
			expect(values[values.length - 1]).toEqual({ b: { count: 2 } });

			unsub();
		});
	});
});
