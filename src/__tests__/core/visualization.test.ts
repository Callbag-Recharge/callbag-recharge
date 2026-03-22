import { afterEach, describe, expect, it } from "vitest";
import { derived, Inspector, state } from "../../index";

describe("Inspector.toMermaid", () => {
	afterEach(() => Inspector._reset());

	it("generates a valid Mermaid flowchart", () => {
		const a = state(1, { name: "count" });
		const b = derived([a], () => a.get() * 2, { name: "doubled" });

		// Force subscription to register edges
		const dispose = Inspector.activate(b);

		const mermaid = Inspector.toMermaid();

		expect(mermaid).toContain("graph TD");
		expect(mermaid).toContain("count");
		expect(mermaid).toContain("doubled");
		// Should have an edge
		expect(mermaid).toContain("-->");

		dispose();
	});

	it("respects direction option", () => {
		state(1, { name: "a" });
		const mermaid = Inspector.toMermaid({ direction: "LR" });
		expect(mermaid).toContain("graph LR");
	});

	it("truncates long values", () => {
		state("a".repeat(50), { name: "long" });
		const mermaid = Inspector.toMermaid();
		expect(mermaid).toContain("...");
	});

	it("sanitizes node IDs with special characters", () => {
		state(1, { name: "my-store:v1" });
		const mermaid = Inspector.toMermaid();
		// Should replace non-alphanumeric with underscore in IDs
		expect(mermaid).toContain("my_store_v1");
	});
});

describe("Inspector.toD2", () => {
	afterEach(() => Inspector._reset());

	it("generates a valid D2 diagram", () => {
		const a = state(1, { name: "count" });
		const b = derived([a], () => a.get() * 2, { name: "doubled" });

		const dispose = Inspector.activate(b);

		const d2 = Inspector.toD2();

		expect(d2).toContain("direction: down");
		expect(d2).toContain("count");
		expect(d2).toContain("doubled");
		expect(d2).toContain("shape: rectangle"); // state shape
		expect(d2).toContain("shape: hexagon"); // derived shape
		expect(d2).toContain("->");

		dispose();
	});

	it("respects direction option", () => {
		state(1, { name: "a" });
		const d2 = Inspector.toD2({ direction: "right" });
		expect(d2).toContain("direction: right");
	});

	it("includes status in labels", () => {
		const a = state(1, { name: "a" });
		// Trigger a set to move to SETTLED
		a.set(2);
		const d2 = Inspector.toD2();
		// Status should appear in the label
		expect(d2).toMatch(/\[.*\]/);
	});

	it("handles empty graph", () => {
		Inspector._reset();
		const d2 = Inspector.toD2();
		expect(d2).toContain("direction: down");
	});
});
