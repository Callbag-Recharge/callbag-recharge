import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../../utils/checkpoint";
import { namespace } from "../../utils/namespace";

describe("namespace", () => {
	// --- prefix ---

	it("prefixes keys with namespace name and separator", () => {
		const ns = namespace("tenant-a");
		expect(ns.prefix("orders")).toBe("tenant-a/orders");
		expect(ns.prefix("users")).toBe("tenant-a/users");
	});

	it("exposes the namespace name", () => {
		const ns = namespace("myapp");
		expect(ns.name).toBe("myapp");
	});

	// --- child ---

	it("creates nested namespace", () => {
		const ns = namespace("tenant-a");
		const child = ns.child("region-1");
		expect(child.name).toBe("tenant-a/region-1");
		expect(child.prefix("key")).toBe("tenant-a/region-1/key");
	});

	it("supports deep nesting", () => {
		const ns = namespace("a").child("b").child("c");
		expect(ns.prefix("key")).toBe("a/b/c/key");
	});

	// --- checkpoint adapter scoping ---

	it("wraps checkpoint adapter with prefixed keys", () => {
		const ns = namespace("tenant-a");
		const adapter = memoryAdapter();
		const scoped = ns.checkpoint(adapter);

		scoped.save("step-1", 42);

		// Scoped adapter reads back its own key
		expect(scoped.load("step-1")).toBe(42);

		// Underlying adapter has the prefixed key
		expect(adapter.load("tenant-a/step-1")).toBe(42);

		// Non-prefixed key doesn't exist in scoped view
		expect(scoped.load("tenant-a/step-1")).toBeUndefined();
	});

	it("scoped clear removes only prefixed key", () => {
		const adapter = memoryAdapter();
		const ns1 = namespace("ns1");
		const ns2 = namespace("ns2");

		const scoped1 = ns1.checkpoint(adapter);
		const scoped2 = ns2.checkpoint(adapter);

		scoped1.save("key", "value1");
		scoped2.save("key", "value2");

		scoped1.clear("key");

		expect(scoped1.load("key")).toBeUndefined();
		expect(scoped2.load("key")).toBe("value2");
	});

	it("child namespace scopes checkpoint adapter", () => {
		const adapter = memoryAdapter();
		const ns = namespace("app").child("tenant-a");
		const scoped = ns.checkpoint(adapter);

		scoped.save("data", "hello");
		expect(adapter.load("app/tenant-a/data")).toBe("hello");
	});

	// --- isolation ---

	it("different namespaces are isolated", () => {
		const adapter = memoryAdapter();
		const a = namespace("a").checkpoint(adapter);
		const b = namespace("b").checkpoint(adapter);

		a.save("key", 1);
		b.save("key", 2);

		expect(a.load("key")).toBe(1);
		expect(b.load("key")).toBe(2);
	});
});
