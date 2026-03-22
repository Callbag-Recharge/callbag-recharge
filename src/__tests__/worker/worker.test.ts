import { describe, expect, it, vi } from "vitest";
import { derived } from "../../core/derived";
import { Inspector } from "../../core/inspector";
import { batch, PAUSE, RESET, RESUME, TEARDOWN } from "../../core/protocol";
import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";
import type { Store } from "../../core/types";
import { withConnectionStatus } from "../../utils/withConnectionStatus";
import { workerBridge } from "../../worker/bridge";
import { nameToSignal, signalToName } from "../../worker/protocol";
import { workerSelf } from "../../worker/self";
import type { WorkerTransport } from "../../worker/transport";

// ---------------------------------------------------------------------------
// Mock transport — simulates synchronous postMessage between two endpoints
// ---------------------------------------------------------------------------

function createMockTransportPair(): [WorkerTransport, WorkerTransport] {
	const listenersA: Array<(data: any) => void> = [];
	const listenersB: Array<(data: any) => void> = [];
	let terminatedA = false;
	let terminatedB = false;

	const transportA: WorkerTransport = {
		post(data, _transfer?) {
			if (terminatedB) return;
			const cloned = JSON.parse(JSON.stringify(data));
			for (const h of listenersB) h(cloned);
		},
		listen(handler) {
			listenersA.push(handler);
			return () => {
				const i = listenersA.indexOf(handler);
				if (i >= 0) listenersA.splice(i, 1);
			};
		},
		terminate() {
			terminatedA = true;
		},
	};

	const transportB: WorkerTransport = {
		post(data, _transfer?) {
			if (terminatedA) return;
			const cloned = JSON.parse(JSON.stringify(data));
			for (const h of listenersA) h(cloned);
		},
		listen(handler) {
			listenersB.push(handler);
			return () => {
				const i = listenersB.indexOf(handler);
				if (i >= 0) listenersB.splice(i, 1);
			};
		},
		terminate() {
			terminatedB = true;
		},
	};

	return [transportA, transportB];
}

// Helper: bridge first (starts listening), then worker (sends ready).
// With sync mock transports, ordering matters for the handshake.
function createPair(opts: {
	mainExpose?: Record<string, Store<any>>;
	mainImport?: readonly string[];
	workerExpose: (imported: any) => Record<string, Store<any>>;
	workerImport?: readonly string[];
	transfer?: any;
}) {
	const [mainTransport, workerTransport] = createMockTransportPair();

	const bridge = workerBridge(mainTransport, {
		expose: opts.mainExpose,
		import: opts.mainImport as any,
		transfer: opts.transfer,
	});

	const workerHandle = workerSelf(workerTransport, {
		import: opts.workerImport as any,
		expose: opts.workerExpose,
		transfer: opts.transfer,
	});

	return { bridge, workerHandle, mainTransport, workerTransport };
}

// ---------------------------------------------------------------------------
// 5g-1: Wire protocol
// ---------------------------------------------------------------------------

describe("wire protocol", () => {
	it("signalToName converts lifecycle symbols to strings", () => {
		expect(signalToName(RESET)).toBe("RESET");
		expect(signalToName(PAUSE)).toBe("PAUSE");
		expect(signalToName(RESUME)).toBe("RESUME");
		expect(signalToName(TEARDOWN)).toBe("TEARDOWN");
	});

	it("nameToSignal converts strings back to symbols", () => {
		expect(nameToSignal("RESET")).toBe(RESET);
		expect(nameToSignal("PAUSE")).toBe(PAUSE);
		expect(nameToSignal("RESUME")).toBe(RESUME);
		expect(nameToSignal("TEARDOWN")).toBe(TEARDOWN);
	});

	it("nameToSignal returns undefined for unknown names", () => {
		expect(nameToSignal("UNKNOWN")).toBeUndefined();
		expect(nameToSignal("")).toBeUndefined();
	});

	it("round-trip: signalToName → nameToSignal", () => {
		for (const sig of [RESET, PAUSE, RESUME, TEARDOWN]) {
			expect(nameToSignal(signalToName(sig))).toBe(sig);
		}
	});
});

// ---------------------------------------------------------------------------
// 5g-2: workerBridge + workerSelf — value sync
// ---------------------------------------------------------------------------

describe("workerBridge + workerSelf", () => {
	it("handshake: bridge receives worker-exported store values", () => {
		const { bridge } = createPair({
			mainImport: ["result"] as const,
			workerExpose: () => ({ result: state(42) }),
		});

		expect((bridge as any).result.get()).toBe(42);
	});

	it("handshake: worker receives main-exposed store values", () => {
		const count = state(10);
		let workerProxy: Store<any>;

		const [mainTransport, workerTransport] = createMockTransportPair();

		workerBridge(mainTransport, {
			expose: { count },
		});

		workerSelf(workerTransport, {
			import: ["count"] as const,
			expose: (imported) => {
				workerProxy = imported.count;
				return {};
			},
		});

		expect(workerProxy!.get()).toBe(10);
	});

	it("bridge status transitions: connecting → connected", () => {
		const { bridge } = createPair({
			mainImport: ["x"] as const,
			workerExpose: () => ({ x: state(1) }),
		});

		expect(bridge.status.get()).toBe("connected");
	});

	it("worker → main: value updates propagate", () => {
		const workerStore = state("hello");
		const { bridge } = createPair({
			mainImport: ["msg"] as const,
			workerExpose: () => ({ msg: workerStore }),
		});

		expect((bridge as any).msg.get()).toBe("hello");

		workerStore.set("world");
		expect((bridge as any).msg.get()).toBe("world");
	});

	it("main → worker: value updates propagate", () => {
		const mainCount = state(0);
		let workerProxy: Store<any>;

		const [mainTransport, workerTransport] = createMockTransportPair();

		workerBridge(mainTransport, {
			expose: { count: mainCount },
		});

		workerSelf(workerTransport, {
			import: ["count"] as const,
			expose: (imported) => {
				workerProxy = imported.count;
				return {};
			},
		});

		expect(workerProxy!.get()).toBe(0);
		mainCount.set(5);
		expect(workerProxy!.get()).toBe(5);
	});

	it("multi-store sync: multiple stores in both directions", () => {
		const mainA = state("a");
		const mainB = state(100);
		const workerX = state([1, 2, 3]);
		const workerY = state(true);

		const { bridge } = createPair({
			mainExpose: { a: mainA, b: mainB },
			mainImport: ["x", "y"] as const,
			workerImport: ["a", "b"] as const,
			workerExpose: () => ({ x: workerX, y: workerY }),
		});

		expect((bridge as any).x.get()).toEqual([1, 2, 3]);
		expect((bridge as any).y.get()).toBe(true);

		workerX.set([4, 5]);
		expect((bridge as any).x.get()).toEqual([4, 5]);

		workerY.set(false);
		expect((bridge as any).y.get()).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 5g-2: Batch coalescing via derived + effect
// ---------------------------------------------------------------------------

describe("batch coalescing", () => {
	it("batch() on main coalesces into single postMessage", () => {
		const a = state(0);
		const b = state(0);
		const sentMessages: any[] = [];

		const [mainTransport, workerTransport] = createMockTransportPair();
		const origPost = mainTransport.post;
		mainTransport.post = (data, transfer) => {
			sentMessages.push(JSON.parse(JSON.stringify(data)));
			origPost.call(mainTransport, data, transfer);
		};

		workerBridge(mainTransport, { expose: { a, b } });
		workerSelf(workerTransport, { import: ["a", "b"] as const, expose: () => ({}) });

		sentMessages.length = 0;

		batch(() => {
			a.set(10);
			b.set(20);
		});

		const batchMsgs = sentMessages.filter((m) => m.t === "b");
		expect(batchMsgs.length).toBe(1);
		expect(batchMsgs[0].u).toEqual({ a: 10, b: 20 });
	});

	it("unbatched changes send separate messages", () => {
		const a = state(0);
		const b = state(0);
		const sentMessages: any[] = [];

		const [mainTransport, workerTransport] = createMockTransportPair();
		const origPost = mainTransport.post;
		mainTransport.post = (data, transfer) => {
			sentMessages.push(JSON.parse(JSON.stringify(data)));
			origPost.call(mainTransport, data, transfer);
		};

		workerBridge(mainTransport, { expose: { a, b } });
		workerSelf(workerTransport, { import: ["a", "b"] as const, expose: () => ({}) });

		sentMessages.length = 0;

		a.set(10);
		b.set(20);

		const batchMsgs = sentMessages.filter((m) => m.t === "b");
		expect(batchMsgs.length).toBe(2);
		expect(batchMsgs[0].u).toEqual({ a: 10 });
		expect(batchMsgs[1].u).toEqual({ b: 20 });
	});

	it("receive-side batch wraps multiple updates in batch()", () => {
		const workerA = state("x");
		const workerB = state("y");

		const { bridge } = createPair({
			mainImport: ["a", "b"] as const,
			workerExpose: () => ({ a: workerA, b: workerB }),
		});

		const proxyA = (bridge as any).a as Store<string>;
		const proxyB = (bridge as any).b as Store<string>;
		const combined = derived([proxyA, proxyB], () => proxyA.get() + proxyB.get());
		const obs = Inspector.observe(combined);

		batch(() => {
			workerA.set("X");
			workerB.set("Y");
		});

		expect(combined.get()).toBe("XY");
		obs.dispose();
	});
});

// ---------------------------------------------------------------------------
// 5g-3: Lifecycle signals across bridge
// ---------------------------------------------------------------------------

describe("lifecycle signals across bridge", () => {
	it("destroy() sends TEARDOWN and terminates transport", () => {
		const sentMessages: any[] = [];
		const terminateSpy = vi.fn();

		const [mainTransport, workerTransport] = createMockTransportPair();
		mainTransport.terminate = terminateSpy;
		const origPost = mainTransport.post;
		mainTransport.post = (data, transfer) => {
			sentMessages.push(JSON.parse(JSON.stringify(data)));
			origPost.call(mainTransport, data, transfer);
		};

		const bridge = workerBridge(mainTransport, { import: ["x"] as const });
		workerSelf(workerTransport, { expose: () => ({ x: state(1) }) });

		sentMessages.length = 0;
		bridge.destroy();

		const signalMsgs = sentMessages.filter((m) => m.t === "s");
		expect(signalMsgs.length).toBe(1);
		expect(signalMsgs[0].sig).toBe("TEARDOWN");
		expect(terminateSpy).toHaveBeenCalled();
		expect(bridge.status.get()).toBe("disconnected");
	});

	it("destroy() is idempotent", () => {
		const terminateSpy = vi.fn();
		const [mainTransport, workerTransport] = createMockTransportPair();
		mainTransport.terminate = terminateSpy;

		const bridge = workerBridge(mainTransport, {});
		workerSelf(workerTransport, { expose: () => ({}) });

		bridge.destroy();
		bridge.destroy();
		bridge.destroy();

		expect(terminateSpy).toHaveBeenCalledTimes(1);
	});

	it("TEARDOWN from main destroys worker side", () => {
		const workerDestroyed = vi.fn();
		const [mainTransport, workerTransport] = createMockTransportPair();
		workerTransport.terminate = () => workerDestroyed();

		const bridge = workerBridge(mainTransport, { expose: { x: state(1) } });
		workerSelf(workerTransport, { import: ["x"] as const, expose: () => ({}) });

		bridge.destroy();

		expect(workerDestroyed).toHaveBeenCalled();
	});

	it("per-store TEARDOWN from worker does not destroy the bridge", () => {
		const terminated = vi.fn();

		const [mainTransport, workerTransport] = createMockTransportPair();
		mainTransport.terminate = terminated;

		// Bridge imports both x and y from worker
		const bridge = workerBridge(mainTransport, { import: ["x", "y"] as const });
		workerSelf(workerTransport, {
			expose: () => ({ x: state(1), y: state(2) }),
		});

		expect(bridge.status.get()).toBe("connected");

		// Worker sends a per-store TEARDOWN for "x" only — bridge should stay alive
		workerTransport.post({ t: "s", s: "x", sig: "TEARDOWN" });

		expect(bridge.status.get()).toBe("connected");
		expect(terminated).not.toHaveBeenCalled();

		// "x" proxy is completed; "y" should still receive updates
		workerTransport.post({ t: "b", u: { y: 99 } });
		expect((bridge as any).y.get()).toBe(99);
	});
});

// ---------------------------------------------------------------------------
// Lifecycle signal forwarding (D1)
// ---------------------------------------------------------------------------

describe("lifecycle signal forwarding", () => {
	it("PAUSE from main-side proxy consumer is forwarded to worker", () => {
		const mainSentMessages: any[] = [];
		const [mainTransport, workerTransport] = createMockTransportPair();
		const origMainPost = mainTransport.post;
		mainTransport.post = (data, transfer) => {
			mainSentMessages.push(JSON.parse(JSON.stringify(data)));
			origMainPost.call(mainTransport, data, transfer);
		};

		const bridge = workerBridge(mainTransport, { import: ["x"] as const });
		workerSelf(workerTransport, { expose: () => ({ x: state(1) }) });

		mainSentMessages.length = 0;

		// Subscribe to the proxy store and send PAUSE upstream via the Subscription API
		const proxy = (bridge as any).x;
		const sub = subscribe(proxy, () => {});
		sub.signal(PAUSE);
		sub.unsubscribe();

		expect(mainSentMessages.some((m) => m.t === "s" && m.sig === "PAUSE" && m.s === "x")).toBe(
			true,
		);
	});

	it("PAUSE from worker-side proxy consumer is forwarded to main", () => {
		const mainCount = state(5);
		let workerImported: any;
		const workerSentMessages: any[] = [];

		const [mainTransport, workerTransport] = createMockTransportPair();
		const origWorkerPost = workerTransport.post;
		workerTransport.post = (data, transfer) => {
			workerSentMessages.push(JSON.parse(JSON.stringify(data)));
			origWorkerPost.call(workerTransport, data, transfer);
		};

		workerBridge(mainTransport, { expose: { count: mainCount } });
		workerSelf(workerTransport, {
			import: ["count"] as const,
			expose: (imported) => {
				workerImported = imported;
				return {};
			},
		});

		workerSentMessages.length = 0;

		// Subscribe to the worker-side proxy and signal PAUSE upstream
		const sub = subscribe(workerImported.count, () => {});
		sub.signal(PAUSE);
		expect(
			workerSentMessages.some((m) => m.t === "s" && m.sig === "PAUSE" && m.s === "count"),
		).toBe(true);
		sub.unsubscribe();
	});

	it("PAUSE received by bridge propagates downstream to proxy consumers", () => {
		const [mainTransport, workerTransport] = createMockTransportPair();

		const bridge = workerBridge(mainTransport, { import: ["x"] as const });
		workerSelf(workerTransport, { expose: () => ({ x: state(1) }) });

		const proxy = (bridge as any).x;
		const obs = Inspector.observe(proxy);

		// Simulate worker sending a PAUSE signal for "x"
		workerTransport.post({ t: "s", s: "x", sig: "PAUSE" });

		expect(obs.signals).toContain(PAUSE);
		obs.dispose();
	});

	it("RESET received by bridge propagates downstream to proxy consumers", () => {
		const [mainTransport, workerTransport] = createMockTransportPair();

		const bridge = workerBridge(mainTransport, { import: ["x"] as const });
		workerSelf(workerTransport, { expose: () => ({ x: state(42) }) });

		const proxy = (bridge as any).x;
		const obs = Inspector.observe(proxy);

		workerTransport.post({ t: "s", s: "x", sig: "RESET" });

		expect(obs.signals).toContain(RESET);
		obs.dispose();
	});

	it("wildcard PAUSE from worker propagates to all bridge proxy stores", () => {
		const [mainTransport, workerTransport] = createMockTransportPair();

		const bridge = workerBridge(mainTransport, { import: ["a", "b"] as const });
		workerSelf(workerTransport, { expose: () => ({ a: state(1), b: state(2) }) });

		const obsA = Inspector.observe((bridge as any).a);
		const obsB = Inspector.observe((bridge as any).b);

		workerTransport.post({ t: "s", s: "*", sig: "PAUSE" });

		expect(obsA.signals).toContain(PAUSE);
		expect(obsB.signals).toContain(PAUSE);
		obsA.dispose();
		obsB.dispose();
	});
});

// ---------------------------------------------------------------------------
// 5g-4: withConnectionStatus + transfer support
// ---------------------------------------------------------------------------

describe("withConnectionStatus", () => {
	it("initial status is 'connecting'", () => {
		const s = state(0);
		const conn = withConnectionStatus(s);
		expect(conn.status.get()).toBe("connecting");
		expect(conn.error.get()).toBeUndefined();
	});

	it("setConnected transitions to 'connected' and clears error", () => {
		const s = state(0);
		const conn = withConnectionStatus(s);
		conn.setError(new Error("fail"));
		conn.setConnected();
		expect(conn.status.get()).toBe("connected");
		expect(conn.error.get()).toBeUndefined();
	});

	it("setError transitions to 'failed' with error", () => {
		const s = state(0);
		const conn = withConnectionStatus(s);
		const err = new Error("timeout");
		conn.setError(err);
		expect(conn.status.get()).toBe("failed");
		expect(conn.error.get()).toBe(err);
	});

	it("setClosed transitions to 'disconnected' and clears error", () => {
		const s = state(0);
		const conn = withConnectionStatus(s);
		conn.setError(new Error("oops"));
		conn.setClosed();
		expect(conn.status.get()).toBe("disconnected");
		expect(conn.error.get()).toBeUndefined();
	});

	it("delegates get() and source() to wrapped store", () => {
		const s = state(42);
		const conn = withConnectionStatus(s);
		expect(conn.get()).toBe(42);

		const obs = Inspector.observe(conn);
		s.set(100);
		expect(obs.values).toContain(100);
		obs.dispose();
	});

	it("status and error are subscribable stores", () => {
		const s = state(0);
		const conn = withConnectionStatus(s);

		const statusObs = Inspector.observe(conn.status);
		const errorObs = Inspector.observe(conn.error);

		conn.setConnected();
		conn.setError(new Error("x"));
		conn.setClosed();

		expect(statusObs.values).toEqual(["connected", "failed", "disconnected"]);
		expect(errorObs.values.length).toBeGreaterThan(0);

		statusObs.dispose();
		errorObs.dispose();
	});

	it("custom initial status", () => {
		const s = state(0);
		const conn = withConnectionStatus(s, { initialStatus: "connected" });
		expect(conn.status.get()).toBe("connected");
	});
});

describe("transfer support", () => {
	it("transfer extractors are called with store values", () => {
		const data = state(new Float32Array([1, 2, 3]));
		const transferFn = vi.fn((v: Float32Array) => [v.buffer]);
		const sentMessages: any[] = [];
		const sentTransfers: any[] = [];

		const [mainTransport, workerTransport] = createMockTransportPair();
		mainTransport.post = (msg, transfer) => {
			sentMessages.push(msg);
			sentTransfers.push(transfer);
			// Don't forward to default post — structured clone can't handle ArrayBuffer in JSON mock
		};

		workerBridge(mainTransport, { expose: { data }, transfer: { data: transferFn } });
		workerSelf(workerTransport, { import: ["data"] as const, expose: () => ({}) });

		sentMessages.length = 0;
		sentTransfers.length = 0;

		const newData = new Float32Array([4, 5, 6]);
		data.set(newData);

		expect(transferFn).toHaveBeenCalledWith(newData);
		expect(sentTransfers.some((t) => t && t.length > 0)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	it("bridge with no expose and no import", () => {
		const [mainTransport, workerTransport] = createMockTransportPair();

		const bridge = workerBridge(mainTransport, {});
		workerSelf(workerTransport, { expose: () => ({}) });

		expect(bridge.status.get()).toBe("connected");
		bridge.destroy();
		expect(bridge.status.get()).toBe("disconnected");
	});

	it("messages after destroy are ignored", () => {
		const workerStore = state(0);
		const { bridge } = createPair({
			mainImport: ["x"] as const,
			workerExpose: () => ({ x: workerStore }),
		});

		bridge.destroy();
		const before = (bridge as any).x.get();
		workerStore.set(999);
		expect((bridge as any).x.get()).toBe(before);
	});

	it("same value not re-sent across wire", () => {
		const a = state(1);
		const sentMessages: any[] = [];

		const [mainTransport, workerTransport] = createMockTransportPair();
		const origPost = mainTransport.post;
		mainTransport.post = (data, transfer) => {
			sentMessages.push(JSON.parse(JSON.stringify(data)));
			origPost.call(mainTransport, data, transfer);
		};

		workerBridge(mainTransport, { expose: { a } });
		workerSelf(workerTransport, { import: ["a"] as const, expose: () => ({}) });

		sentMessages.length = 0;

		// state has equals: Object.is by default — set(1) when current is 1 is a no-op
		a.set(1);

		const batchMsgs = sentMessages.filter((m) => m.t === "b");
		expect(batchMsgs.length).toBe(0);
	});
});
