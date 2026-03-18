import { describe, expect, it } from "vitest";
import { derived } from "../../core/derived";
import { state } from "../../core/state";
import { dag } from "../../orchestrate/dag";

describe("dag", () => {
	it("validates a simple linear DAG", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const result = dag([
			{ store: a, name: "a" },
			{ store: b, deps: [a], name: "b" },
		]);
		expect(result.size).toBe(2);
		expect(result.order[0]).toBe(a);
		expect(result.order[1]).toBe(b);
	});

	it("validates a diamond DAG", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a], () => a.get() + 10);
		const d = derived([b, c], () => b.get() + c.get());
		const result = dag([
			{ store: a, name: "a" },
			{ store: b, deps: [a], name: "b" },
			{ store: c, deps: [a], name: "c" },
			{ store: d, deps: [b, c], name: "d" },
		]);
		expect(result.size).toBe(4);
		// a must come before b, c; b and c must come before d
		const order = result.order;
		expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
		expect(order.indexOf(a)).toBeLessThan(order.indexOf(c));
		expect(order.indexOf(b)).toBeLessThan(order.indexOf(d));
		expect(order.indexOf(c)).toBeLessThan(order.indexOf(d));
	});

	it("detects a cycle", () => {
		const a = state(1);
		const b = state(2);
		// Declare a circular dependency (even though the stores don't actually have it)
		expect(() =>
			dag([
				{ store: a, deps: [b], name: "a" },
				{ store: b, deps: [a], name: "b" },
			]),
		).toThrow("Cycle detected");
	});

	it("rejects duplicate stores", () => {
		const a = state(1);
		expect(() =>
			dag([
				{ store: a, name: "a1" },
				{ store: a, name: "a2" },
			]),
		).toThrow("Duplicate store");
	});

	it("rejects missing dependency", () => {
		const a = state(1);
		const b = state(2);
		const c = state(3);
		expect(() =>
			dag([
				{ store: a, name: "a" },
				{ store: b, deps: [c], name: "b" }, // c is not in the DAG
			]),
		).toThrow("Dependency not found");
	});

	it("handles nodes with no deps (roots)", () => {
		const a = state(1);
		const b = state(2);
		const c = derived([a, b], () => a.get() + b.get());
		const result = dag([
			{ store: a, name: "a" },
			{ store: b, name: "b" },
			{ store: c, deps: [a, b], name: "c" },
		]);
		expect(result.size).toBe(3);
		expect(result.order.indexOf(c)).toBe(2); // c last
	});

	it("works with unnamed nodes", () => {
		const a = state(1);
		const b = state(2);
		const result = dag([{ store: a }, { store: b, deps: [a] }]);
		expect(result.size).toBe(2);
	});
});
