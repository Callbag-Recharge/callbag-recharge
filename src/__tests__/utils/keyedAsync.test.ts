import { describe, expect, it } from "vitest";
import { keyedAsync } from "../../utils/keyedAsync";

describe("keyedAsync", () => {
	it("returns the resolved value", async () => {
		const load = keyedAsync((key: string) => Promise.resolve(`${key}!`));
		expect(await load("a")).toBe("a!");
	});

	it("deduplicates concurrent calls for the same key", async () => {
		let callCount = 0;
		const load = keyedAsync((key: string) => {
			callCount++;
			return new Promise((r) => setTimeout(() => r(key), 10));
		});

		const [a, b] = await Promise.all([load("x"), load("x")]);
		expect(a).toBe("x");
		expect(b).toBe("x");
		expect(callCount).toBe(1);
	});

	it("does not dedup different keys", async () => {
		let callCount = 0;
		const load = keyedAsync((_key: string) => {
			callCount++;
			return new Promise((r) => setTimeout(() => r(callCount), 10));
		});

		await Promise.all([load("a"), load("b")]);
		expect(callCount).toBe(2);
	});

	it("allows a fresh call after the previous settles", async () => {
		let callCount = 0;
		const load = keyedAsync((key: string) => {
			callCount++;
			return Promise.resolve(key);
		});

		await load("k");
		await load("k");
		expect(callCount).toBe(2);
	});

	it("propagates rejections to all waiters", async () => {
		let callCount = 0;
		const load = keyedAsync((_key: string) => {
			callCount++;
			return new Promise((_, reject) => setTimeout(() => reject(new Error("boom")), 10));
		});

		const results = await Promise.allSettled([load("x"), load("x")]);
		expect(callCount).toBe(1);
		expect(results[0].status).toBe("rejected");
		expect(results[1].status).toBe("rejected");
		expect((results[0] as PromiseRejectedResult).reason.message).toBe("boom");
	});

	it("cleans up after rejection so next call starts fresh", async () => {
		let callCount = 0;
		const load = keyedAsync((_key: string) => {
			callCount++;
			if (callCount === 1) return Promise.reject(new Error("fail"));
			return Promise.resolve("ok");
		});

		await expect(load("k")).rejects.toThrow("fail");
		expect(await load("k")).toBe("ok");
		expect(callCount).toBe(2);
	});
});
