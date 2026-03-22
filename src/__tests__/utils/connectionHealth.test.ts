import { describe, expect, it, vi } from "vitest";
import { Inspector } from "../../core/inspector";
import { constant } from "../../utils/backoff";
import { connectionHealth } from "../../utils/connectionHealth";

// ---------------------------------------------------------------------------
// Connection health monitor tests
// ---------------------------------------------------------------------------
describe("connectionHealth", () => {
	it("starts in disconnected status", () => {
		const h = connectionHealth();
		expect(h.status.get()).toBe("disconnected");
		expect(h.healthy.get()).toBe(false);
		expect(h.reconnectCount.get()).toBe(0);
	});

	it("transitions to connected on successful connect", async () => {
		vi.useFakeTimers();
		const h = connectionHealth({ heartbeatMs: 10_000 });

		h.start({
			heartbeat: async () => {},
			connect: async () => {},
			disconnect: () => {},
		});

		// connect is async, flush microtasks
		await vi.advanceTimersByTimeAsync(0);

		expect(h.status.get()).toBe("connected");
		expect(h.healthy.get()).toBe(true);

		h.stop();
		vi.useRealTimers();
	});

	it("reconnects on connect failure with backoff", async () => {
		vi.useFakeTimers();
		let connectAttempts = 0;

		const h = connectionHealth({
			heartbeatMs: 10_000,
			backoff: constant(500),
		});

		h.start({
			heartbeat: async () => {},
			connect: async () => {
				connectAttempts++;
				if (connectAttempts < 3) throw new Error("fail");
			},
			disconnect: () => {},
		});

		// First connect attempt fails (initial, not counted as reconnect)
		await vi.advanceTimersByTimeAsync(0);
		expect(h.status.get()).toBe("disconnected");
		expect(h.reconnectCount.get()).toBe(0);

		// Wait for backoff (500ms) then first reconnect attempt
		await vi.advanceTimersByTimeAsync(500);
		expect(connectAttempts).toBe(2);
		expect(h.status.get()).toBe("disconnected");
		expect(h.reconnectCount.get()).toBe(1);

		// Wait for backoff (500ms) then second reconnect — succeeds
		await vi.advanceTimersByTimeAsync(500);
		expect(connectAttempts).toBe(3);
		expect(h.status.get()).toBe("connected");
		expect(h.reconnectCount.get()).toBe(0); // reset on success

		h.stop();
		vi.useRealTimers();
	});

	it("triggers reconnect on heartbeat failure", async () => {
		vi.useFakeTimers();
		let heartbeatShouldFail = false;
		let connectCount = 0;

		const h = connectionHealth({
			heartbeatMs: 1000,
			timeoutMs: 500,
			backoff: constant(200),
		});

		h.start({
			heartbeat: async () => {
				if (heartbeatShouldFail) throw new Error("heartbeat fail");
			},
			connect: async () => {
				connectCount++;
			},
			disconnect: () => {},
		});

		await vi.advanceTimersByTimeAsync(0);
		expect(h.status.get()).toBe("connected");
		expect(connectCount).toBe(1);

		// Make heartbeat fail
		heartbeatShouldFail = true;
		await vi.advanceTimersByTimeAsync(1000); // heartbeat fires and fails

		expect(h.status.get()).toBe("disconnected");

		// Wait for reconnect backoff
		await vi.advanceTimersByTimeAsync(200);
		expect(connectCount).toBe(2);
		expect(h.status.get()).toBe("connected");

		h.stop();
		vi.useRealTimers();
	});

	it("transitions to failed after maxReconnects", async () => {
		vi.useFakeTimers();

		const h = connectionHealth({
			heartbeatMs: 10_000,
			backoff: constant(100),
			maxReconnects: 2,
		});

		h.start({
			heartbeat: async () => {},
			connect: async () => {
				throw new Error("always fails");
			},
			disconnect: () => {},
		});

		// First connect fails
		await vi.advanceTimersByTimeAsync(0);
		expect(h.status.get()).toBe("disconnected");

		// First reconnect attempt
		await vi.advanceTimersByTimeAsync(100);
		expect(h.reconnectCount.get()).toBe(1);

		// Second reconnect attempt
		await vi.advanceTimersByTimeAsync(100);
		expect(h.reconnectCount.get()).toBe(2);

		// Now at max, should be failed
		await vi.advanceTimersByTimeAsync(100);
		expect(h.status.get()).toBe("failed");

		h.stop();
		vi.useRealTimers();
	});

	it("stop clears timers and disconnects", async () => {
		vi.useFakeTimers();
		let disconnected = false;

		const h = connectionHealth({ heartbeatMs: 1000 });

		h.start({
			heartbeat: async () => {},
			connect: async () => {},
			disconnect: () => {
				disconnected = true;
			},
		});

		await vi.advanceTimersByTimeAsync(0);
		expect(h.status.get()).toBe("connected");

		h.stop();
		expect(disconnected).toBe(true);
		expect(h.status.get()).toBe("disconnected");

		vi.useRealTimers();
	});

	it("resets reconnectCount on successful connection", async () => {
		vi.useFakeTimers();
		let connectAttempts = 0;

		const h = connectionHealth({
			heartbeatMs: 10_000,
			backoff: constant(100),
		});

		h.start({
			heartbeat: async () => {},
			connect: async () => {
				connectAttempts++;
				if (connectAttempts < 3) throw new Error("fail");
			},
			disconnect: () => {},
		});

		await vi.advanceTimersByTimeAsync(0); // initial connect fails
		await vi.advanceTimersByTimeAsync(100); // 1st reconnect fails
		expect(h.reconnectCount.get()).toBe(1);

		await vi.advanceTimersByTimeAsync(100); // 2nd reconnect succeeds
		expect(h.reconnectCount.get()).toBe(0);

		h.stop();
		vi.useRealTimers();
	});

	it("uses default backoff (1000ms) when no strategy provided", async () => {
		vi.useFakeTimers();
		let connectAttempts = 0;

		const h = connectionHealth({
			heartbeatMs: 10_000,
			maxReconnects: 5,
		});

		h.start({
			heartbeat: async () => {},
			connect: async () => {
				connectAttempts++;
				if (connectAttempts < 2) throw new Error("fail");
			},
			disconnect: () => {},
		});

		await vi.advanceTimersByTimeAsync(0); // 1st fails
		expect(connectAttempts).toBe(1);

		// Before default 1000ms backoff
		await vi.advanceTimersByTimeAsync(500);
		expect(connectAttempts).toBe(1);

		// After 1000ms
		await vi.advanceTimersByTimeAsync(500);
		expect(connectAttempts).toBe(2);
		expect(h.status.get()).toBe("connected");

		h.stop();
		vi.useRealTimers();
	});

	it("status is connecting during connect attempt", async () => {
		vi.useFakeTimers();
		let resolveConnect!: () => void;

		const h = connectionHealth({ heartbeatMs: 10_000 });

		// Subscribe to status changes
		const obs = Inspector.observe(h.status);

		h.start({
			heartbeat: async () => {},
			connect: () =>
				new Promise<void>((resolve) => {
					resolveConnect = resolve;
				}),
			disconnect: () => {},
		});

		// Immediately after start, status should be connecting
		await vi.advanceTimersByTimeAsync(0);
		expect(obs.values).toContain("connecting");

		resolveConnect();
		await vi.advanceTimersByTimeAsync(0);
		expect(obs.values).toContain("connected");

		obs.dispose();
		h.stop();
		vi.useRealTimers();
	});
});
