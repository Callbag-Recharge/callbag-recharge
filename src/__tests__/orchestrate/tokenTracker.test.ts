import { describe, expect, it } from "vitest";
import { Inspector } from "../../core/inspector";
import { pipe } from "../../core/pipe";
import { producer } from "../../core/producer";
import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";
import type { TokenMeta, TokenTrackedStore } from "../../utils/tokenTracker";
import { tokenTracker } from "../../utils/tokenTracker";

describe("tokenTracker", () => {
	it("tracks token usage across emissions", () => {
		const input = state({ text: "hi", usage: { promptTokens: 10, completionTokens: 5 } });
		const tracked = pipe(
			input,
			tokenTracker((v) => v.usage),
		) as unknown as TokenTrackedStore<typeof input extends { get(): infer T } ? T : never>;

		const values: any[] = [];
		const unsub = subscribe(tracked, (v) => values.push(v));

		expect(tracked.tokens.get()).toEqual({
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			cost: 0,
			count: 0,
		});

		input.set({ text: "hello", usage: { promptTokens: 10, completionTokens: 5 } });
		expect(tracked.tokens.get()).toEqual({
			promptTokens: 10,
			completionTokens: 5,
			totalTokens: 15,
			cost: 0,
			count: 1,
		});

		input.set({ text: "world", usage: { promptTokens: 20, completionTokens: 15, cost: 0.003 } });
		expect(tracked.tokens.get()).toEqual({
			promptTokens: 30,
			completionTokens: 20,
			totalTokens: 50,
			cost: 0.003,
			count: 2,
		});

		expect(values).toHaveLength(2);
		unsub();
	});

	it("computes totalTokens from prompt + completion when not provided", () => {
		const input = state("a");
		const tracked = pipe(
			input,
			tokenTracker(() => ({ promptTokens: 7, completionTokens: 3 })),
		) as unknown as TokenTrackedStore<string>;

		const unsub = subscribe(tracked, () => {});
		input.set("b");

		expect(tracked.tokens.get().totalTokens).toBe(10);
		unsub();
	});

	it("uses provided totalTokens when given", () => {
		const input = state("a");
		const tracked = pipe(
			input,
			tokenTracker(() => ({ promptTokens: 7, completionTokens: 3, totalTokens: 100 })),
		) as unknown as TokenTrackedStore<string>;

		const unsub = subscribe(tracked, () => {});
		input.set("b");

		expect(tracked.tokens.get().totalTokens).toBe(100);
		unsub();
	});

	it("resets on reconnect", () => {
		const input = state("a");
		const tracked = pipe(
			input,
			tokenTracker(() => ({ promptTokens: 5, completionTokens: 5 })),
		) as unknown as TokenTrackedStore<string>;

		const unsub1 = subscribe(tracked, () => {});
		input.set("b");
		expect(tracked.tokens.get().count).toBe(1);
		unsub1();

		// Reconnect — should reset
		const unsub2 = subscribe(tracked, () => {});
		expect(tracked.tokens.get()).toEqual({
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			cost: 0,
			count: 0,
		});

		input.set("c");
		expect(tracked.tokens.get().count).toBe(1);
		expect(tracked.tokens.get().totalTokens).toBe(10);
		unsub2();
	});

	it("forwards values unchanged", () => {
		const input = state(42);
		const tracked = pipe(
			input,
			tokenTracker(() => ({ promptTokens: 1 })),
		);

		const values: number[] = [];
		const unsub = subscribe(tracked, (v) => values.push(v));
		input.set(100);
		input.set(200);

		expect(values).toEqual([100, 200]);
		unsub();
	});

	it("forwards upstream errors", () => {
		const p = producer<string>(({ emit, error }) => {
			emit("hello");
			error(new Error("boom"));
		});

		const tracked = pipe(
			p,
			tokenTracker(() => ({ promptTokens: 1 })),
		);

		const obs = Inspector.observe(tracked);
		expect(obs.values).toEqual(["hello"]);
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeInstanceOf(Error);
	});

	it("forwards upstream completion", () => {
		const p = producer<string>(({ emit, complete }) => {
			emit("done");
			complete();
		});

		const tracked = pipe(
			p,
			tokenTracker(() => ({ promptTokens: 1 })),
		);

		const obs = Inspector.observe(tracked);
		expect(obs.values).toEqual(["done"]);
		expect(obs.ended).toBe(true);
		expect(obs.endError).toBeUndefined();
	});

	it("handles countTokens throwing gracefully", () => {
		const input = state("a");
		let shouldThrow = false;
		const tracked = pipe(
			input,
			tokenTracker(() => {
				if (shouldThrow) throw new Error("parse error");
				return { promptTokens: 5 };
			}),
		) as unknown as TokenTrackedStore<string>;

		const values: string[] = [];
		const unsub = subscribe(tracked, (v) => values.push(v));
		input.set("b"); // succeeds
		shouldThrow = true;
		input.set("c"); // countTokens throws — value still forwarded

		expect(values).toEqual(["b", "c"]);
		expect(tracked.tokens.get().count).toBe(2);
		// Tokens from failed extraction are not added
		expect(tracked.tokens.get().promptTokens).toBe(5);
		unsub();
	});

	it("get() returns last value", () => {
		const input = state(10);
		const tracked = pipe(
			input,
			tokenTracker(() => ({ promptTokens: 1 })),
		);

		// Before subscription, get() returns initial
		expect(tracked.get()).toBe(10);

		const unsub = subscribe(tracked, () => {});
		input.set(20);
		expect(tracked.get()).toBe(20);
		unsub();
	});

	it("tokens store is reactive via effect", () => {
		const input = state("x");
		const tracked = pipe(
			input,
			tokenTracker(() => ({ promptTokens: 10, completionTokens: 5, cost: 0.001 })),
		) as unknown as TokenTrackedStore<string>;

		const snapshots: TokenMeta[] = [];
		const unsub = subscribe(tracked, () => {});
		const unsubTokens = subscribe(tracked.tokens, (t) => snapshots.push({ ...t }));

		input.set("y");
		input.set("z");

		expect(snapshots).toHaveLength(2);
		expect(snapshots[1].count).toBe(2);
		expect(snapshots[1].cost).toBeCloseTo(0.002);

		unsub();
		unsubTokens();
	});

	it("registers with Inspector", () => {
		const input = state("a");
		const tracked = pipe(
			input,
			tokenTracker(() => ({}), { name: "myTracker" }),
		);
		subscribe(tracked, () => {});

		const info = Inspector.inspect(tracked);
		expect(info.kind).toBe("tokenTracker");
	});

	it("sanitizes NaN/Infinity token values to 0", () => {
		const input = state("a");
		const tracked = pipe(
			input,
			tokenTracker(() => ({ promptTokens: NaN, completionTokens: Infinity, cost: -Infinity })),
		) as unknown as TokenTrackedStore<string>;

		const unsub = subscribe(tracked, () => {});
		input.set("b");

		const t = tracked.tokens.get();
		expect(t.promptTokens).toBe(0);
		expect(t.completionTokens).toBe(0);
		expect(t.totalTokens).toBe(0);
		expect(t.cost).toBe(0);
		expect(t.count).toBe(1);
		unsub();
	});

	it("countTokens throw does not add tokens from previous emission", () => {
		const input = state("a");
		let callCount = 0;
		const tracked = pipe(
			input,
			tokenTracker(() => {
				callCount++;
				if (callCount === 2) throw new Error("fail");
				return { promptTokens: 10 };
			}),
		) as unknown as TokenTrackedStore<string>;

		const unsub = subscribe(tracked, () => {});
		input.set("b"); // callCount=1, succeeds, promptTokens=10
		const before = tracked.tokens.get().promptTokens;
		input.set("c"); // callCount=2, throws
		const after = tracked.tokens.get().promptTokens;

		expect(before).toBe(10);
		expect(after).toBe(10); // unchanged — throw did not add tokens
		unsub();
	});

	it("multiple subscribers share the same token accumulation", () => {
		const input = state("a");
		const tracked = pipe(
			input,
			tokenTracker(() => ({ promptTokens: 5 })),
		) as unknown as TokenTrackedStore<string>;

		const unsub1 = subscribe(tracked, () => {});
		const unsub2 = subscribe(tracked, () => {});

		input.set("b");
		expect(tracked.tokens.get().promptTokens).toBe(5);
		expect(tracked.tokens.get().count).toBe(1);

		unsub1();
		unsub2();
	});

	it("handles empty TokenUsage object (all fields default to 0)", () => {
		const input = state("a");
		const tracked = pipe(
			input,
			tokenTracker(() => ({})),
		) as unknown as TokenTrackedStore<string>;

		const unsub = subscribe(tracked, () => {});
		input.set("b");

		const t = tracked.tokens.get();
		expect(t.promptTokens).toBe(0);
		expect(t.completionTokens).toBe(0);
		expect(t.totalTokens).toBe(0);
		expect(t.cost).toBe(0);
		expect(t.count).toBe(1);
		unsub();
	});
});
