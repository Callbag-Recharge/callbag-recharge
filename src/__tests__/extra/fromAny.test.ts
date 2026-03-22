import { describe, expect, it } from "vitest";
import { Inspector } from "../../core/inspector";
import { fromAny } from "../../extra/fromAny";

describe("fromAny", () => {
	it("plain value — emits once and completes", () => {
		const s = fromAny(42);
		const obs = Inspector.observe(s);
		expect(obs.values).toEqual([42]);
		expect(obs.completedCleanly).toBe(true);
	});

	it("promise — emits resolved value", async () => {
		const s = fromAny(Promise.resolve("hello"));
		const obs = Inspector.observe(s);
		await new Promise((r) => setTimeout(r, 10));
		expect(obs.values).toEqual(["hello"]);
		expect(obs.completedCleanly).toBe(true);
	});

	it("promise — errors on rejection", async () => {
		const s = fromAny(Promise.reject(new Error("boom")));
		const obs = Inspector.observe(s);
		await new Promise((r) => setTimeout(r, 10));
		expect(obs.values).toEqual([]);
		expect(obs.errored).toBe(true);
		expect(obs.endError).toBeInstanceOf(Error);
	});

	it("iterable — emits each element", () => {
		const s = fromAny([1, 2, 3]);
		const obs = Inspector.observe(s);
		expect(obs.values).toEqual([1, 2, 3]);
		expect(obs.completedCleanly).toBe(true);
	});

	it("Set iterable", () => {
		const s = fromAny(new Set(["a", "b"]));
		const obs = Inspector.observe(s);
		expect(obs.values).toEqual(["a", "b"]);
	});

	it("string is treated as plain value, not iterable", () => {
		const s = fromAny("hello");
		const obs = Inspector.observe(s);
		expect(obs.values).toEqual(["hello"]);
	});

	it("async iterable — emits each yielded value", async () => {
		async function* gen() {
			yield 10;
			yield 20;
			yield 30;
		}
		const s = fromAny(gen());
		const obs = Inspector.observe(s);
		await new Promise((r) => setTimeout(r, 50));
		expect(obs.values).toEqual([10, 20, 30]);
		expect(obs.completedCleanly).toBe(true);
	});

	it("observable — bridges next/error/complete", () => {
		let observer: any;
		const obs$ = {
			subscribe(o: any) {
				observer = o;
				return { unsubscribe: () => {} };
			},
		};
		const s = fromAny(obs$);
		const obs = Inspector.observe(s);
		observer.next("a");
		observer.next("b");
		observer.complete();
		expect(obs.values).toEqual(["a", "b"]);
		expect(obs.completedCleanly).toBe(true);
	});

	it("null/undefined as plain values", () => {
		const s1 = fromAny(null);
		const obs1 = Inspector.observe(s1);
		expect(obs1.values).toEqual([null]);

		const s2 = fromAny(undefined);
		const obs2 = Inspector.observe(s2);
		expect(obs2.values).toEqual([undefined]);
	});
});
