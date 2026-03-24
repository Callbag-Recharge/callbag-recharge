import { describe, expect, it } from "vitest";
import { producer } from "../../../core/producer";
import { state } from "../../../core/state";
import { subscribe } from "../../../core/subscribe";
import { hybridRoute } from "../../../patterns/hybridRoute";

describe("hybridRoute", () => {
	it("starts in idle state", () => {
		const router = hybridRoute({
			local: () => state("local"),
			cloud: () => state("cloud"),
		});

		expect(router.route.get()).toBe("idle");
		expect(router.store.get()).toBeUndefined();
		expect(router.localCount.get()).toBe(0);
		expect(router.cloudCount.get()).toBe(0);
	});

	it("routes to local by default", () => {
		const router = hybridRoute({
			local: (input: string) => state(`local:${input}`),
			cloud: (input: string) => state(`cloud:${input}`),
		});

		router.process("test");
		expect(router.route.get()).toBe("local");
		expect(router.store.get()).toBe("local:test");
		expect(router.localCount.get()).toBe(1);
		expect(router.cloudCount.get()).toBe(0);
	});

	it("routes to cloud based on shouldRoute", () => {
		const router = hybridRoute({
			local: (input: string) => state(`local:${input}`),
			cloud: (input: string) => state(`cloud:${input}`),
			shouldRoute: (input) => (input.length > 5 ? "cloud" : "local"),
		});

		router.process("hi");
		expect(router.route.get()).toBe("local");
		expect(router.store.get()).toBe("local:hi");

		router.process("longer input");
		expect(router.route.get()).toBe("cloud");
		expect(router.store.get()).toBe("cloud:longer input");
	});

	it("tracks counts correctly", () => {
		const router = hybridRoute({
			local: (n: number) => state(n * 2),
			cloud: (n: number) => state(n * 10),
			shouldRoute: (n) => (n < 5 ? "local" : "cloud"),
		});

		router.process(1);
		router.process(2);
		router.process(10);
		router.process(3);

		expect(router.localCount.get()).toBe(3);
		expect(router.cloudCount.get()).toBe(1);
	});

	it("falls back to cloud on local handler throw", () => {
		const router = hybridRoute<string, string>({
			local: () => {
				throw new Error("local failed");
			},
			cloud: (input) => state(`cloud:${input}`),
		});

		router.process("test");
		expect(router.route.get()).toBe("cloud");
		expect(router.store.get()).toBe("cloud:test");
		expect(router.cloudCount.get()).toBe(1);
		expect(router.localCount.get()).toBe(1); // attempted local first
	});

	it("falls back to cloud on local stream error", () => {
		const router = hybridRoute<string, string>({
			local: () =>
				producer(({ error }) => {
					error(new Error("stream failed"));
				}),
			cloud: (input) => state(`cloud:${input}`),
		});

		router.process("test");
		expect(router.route.get()).toBe("cloud");
		expect(router.store.get()).toBe("cloud:test");
		expect(router.error.get()).toBeInstanceOf(Error);
	});

	it("does not fallback when fallbackOnError is false", () => {
		const router = hybridRoute<string, string>({
			local: () => {
				throw new Error("local failed");
			},
			cloud: (input) => state(`cloud:${input}`),
			fallbackOnError: false,
		});

		router.process("test");
		expect(router.route.get()).toBe("local");
		expect(router.error.get()).toBeInstanceOf(Error);
		expect(router.cloudCount.get()).toBe(0);
	});

	it("clears error on new process call", () => {
		let shouldFail = true;
		const router = hybridRoute<string, string>({
			local: (input) => {
				if (shouldFail) throw new Error("fail");
				return state(`ok:${input}`);
			},
			cloud: (input) => state(`cloud:${input}`),
			fallbackOnError: false,
		});

		router.process("test1");
		expect(router.error.get()).toBeInstanceOf(Error);

		shouldFail = false;
		router.process("test2");
		expect(router.error.get()).toBeUndefined();
		expect(router.store.get()).toBe("ok:test2");
	});

	it("stores are reactive", () => {
		const router = hybridRoute({
			local: (n: number) => state(n),
			cloud: (n: number) => state(n * 10),
			shouldRoute: (n) => (n < 5 ? "local" : "cloud"),
		});

		const results: (number | undefined)[] = [];
		const unsub = subscribe(router.store, (v) => results.push(v));

		router.process(1);
		router.process(10);

		expect(results).toEqual([1, 10 * 10]);
		unsub.unsubscribe();
	});

	it("unsubscribes from previous handler on new process", () => {
		const localStore1 = state("first-val");
		const localStore2 = state("second-val");
		let callCount = 0;
		const router = hybridRoute<string, string>({
			local: () => {
				callCount++;
				return callCount === 1 ? localStore1 : localStore2;
			},
			cloud: (input) => state(`cloud:${input}`),
		});

		router.process("first");
		expect(router.store.get()).toBe("first-val");

		// Second process — should unsub from localStore1
		router.process("second");
		expect(router.store.get()).toBe("second-val");

		// Changes to localStore1 should not affect result
		localStore1.set("changed");
		expect(router.store.get()).toBe("second-val");
	});

	it("handles cloud handler throwing on direct route", () => {
		const router = hybridRoute<string, string>({
			local: (input) => state(`local:${input}`),
			cloud: () => {
				throw new Error("cloud failed");
			},
			shouldRoute: () => "cloud",
		});

		router.process("test");
		expect(router.error.get()).toBeInstanceOf(Error);
		expect((router.error.get() as Error).message).toBe("cloud failed");
		expect(router.cloudCount.get()).toBe(1);
	});

	it("handles both local and cloud failing", () => {
		const router = hybridRoute<string, string>({
			local: () => {
				throw new Error("local failed");
			},
			cloud: () => {
				throw new Error("cloud failed");
			},
		});

		router.process("test");
		// Final error should be from cloud (the last attempt)
		expect(router.error.get()).toBeInstanceOf(Error);
		expect((router.error.get() as Error).message).toBe("cloud failed");
		expect(router.route.get()).toBe("cloud");
	});

	it("dispose() unsubscribes from current handler", () => {
		const localStore = state("initial");
		const router = hybridRoute<string, string>({
			local: () => localStore,
			cloud: () => state("cloud"),
		});

		router.process("test");
		expect(router.store.get()).toBe("initial");

		router.dispose();

		// Changes to localStore should not affect result anymore
		localStore.set("changed");
		expect(router.store.get()).toBe("initial");
	});
});
