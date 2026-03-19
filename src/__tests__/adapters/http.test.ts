import { afterEach, describe, expect, it, vi } from "vitest";
import { fromHTTP } from "../../adapters/http";
import { subscribe } from "../../extra/subscribe";
import { Inspector } from "../../index";

describe("fromHTTP", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("creates store with initial values", () => {
		vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

		const http = fromHTTP("https://api.example.com/data");

		// Producer is lazy — status is idle until subscription
		expect(http.status.get()).toBe("idle");
		expect(http.fetchCount.get()).toBe(0);
		expect(http.store.get()).toBeUndefined();

		http.stop();
	});

	it("fetches and emits JSON response", async () => {
		const mockResponse = {
			ok: true,
			status: 200,
			statusText: "OK",
			json: () => Promise.resolve({ name: "test" }),
		};
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

		const http = fromHTTP("https://api.example.com/data");

		const values: any[] = [];
		const unsub = subscribe(http.store, (v) => values.push(v));

		// Wait for async fetch
		await new Promise((r) => setTimeout(r, 50));

		expect(values).toEqual([{ name: "test" }]);
		expect(http.status.get()).toBe("success");
		expect(http.fetchCount.get()).toBe(1);

		unsub();
		http.stop();
	});

	it("handles fetch error (non-ok response)", async () => {
		const mockResponse = {
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
			json: () => Promise.resolve({}),
		};
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

		const http = fromHTTP("https://api.example.com/data");

		const obs = Inspector.observe(http.store);

		await new Promise((r) => setTimeout(r, 50));

		expect(http.status.get()).toBe("error");
		expect(obs.ended).toBe(true);

		http.stop();
	});

	it("handles network error", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

		const http = fromHTTP("https://api.example.com/data");

		const obs = Inspector.observe(http.store);

		await new Promise((r) => setTimeout(r, 50));

		expect(http.status.get()).toBe("error");
		expect(obs.ended).toBe(true);

		http.stop();
	});

	it("custom transform", async () => {
		const mockResponse = {
			ok: true,
			status: 200,
			statusText: "OK",
			text: () => Promise.resolve("hello world"),
		};
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

		const http = fromHTTP("https://api.example.com/text", {
			transform: (r) => r.text(),
		});

		const values: any[] = [];
		const unsub = subscribe(http.store, (v) => values.push(v));

		await new Promise((r) => setTimeout(r, 50));

		expect(values).toEqual(["hello world"]);

		unsub();
		http.stop();
	});

	it("sends POST with body", async () => {
		const mockResponse = {
			ok: true,
			status: 200,
			statusText: "OK",
			json: () => Promise.resolve({ ok: true }),
		};
		const fetchMock = vi.fn().mockResolvedValue(mockResponse);
		vi.stubGlobal("fetch", fetchMock);

		const http = fromHTTP("https://api.example.com/submit", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: { name: "test" },
		});

		const values: any[] = [];
		const unsub = subscribe(http.store, (v) => values.push(v));

		await new Promise((r) => setTimeout(r, 50));

		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.example.com/submit",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ name: "test" }),
			}),
		);

		unsub();
		http.stop();
	});

	it("stop() cancels in-flight request", () => {
		vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

		const http = fromHTTP("https://api.example.com/data");
		const unsub = subscribe(http.store, () => {});

		// stop should not throw
		http.stop();
		unsub();
	});

	it("refetch() triggers a new fetch", async () => {
		let callCount = 0;
		const mockResponse = () => ({
			ok: true,
			status: 200,
			statusText: "OK",
			json: () => Promise.resolve({ count: ++callCount }),
		});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() => Promise.resolve(mockResponse())),
		);

		const http = fromHTTP("https://api.example.com/data");

		const values: any[] = [];
		const unsub = subscribe(http.store, (v) => values.push(v));

		await new Promise((r) => setTimeout(r, 50));
		expect(values).toHaveLength(1);

		http.refetch();
		await new Promise((r) => setTimeout(r, 50));
		expect(values.length).toBeGreaterThanOrEqual(2);

		unsub();
		http.stop();
	});
});
