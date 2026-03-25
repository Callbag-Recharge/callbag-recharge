// ---------------------------------------------------------------------------
// workerBridge — main-thread reactive store bridge to a worker
// ---------------------------------------------------------------------------
// Creates proxy stores for imported worker stores, subscribes to exposed
// stores and sends values across the wire. Uses derived() + effect() for
// natural batch coalescing via two-phase push + bitmask resolution.
//
// Handshake:
//   1. Main creates bridge, starts listening
//   2. Worker sends { t: 'r', stores: { name: initialValue, ... } }
//   3. Main creates proxy stores, marks status "connected"
//   4. Main sends { t: 'i', stores: { name: currentValue, ... } }
//   5. Bidirectional value flow begins
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { effect } from "../core/effect";
import { Inspector } from "../core/inspector";
import type { LifecycleSignal } from "../core/protocol";
import { batch, TEARDOWN } from "../core/protocol";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store, WritableStore } from "../core/types";
import {
	type ConnectionControl,
	type WithConnectionStatusStore,
	withConnectionStatus,
} from "../utils/withConnectionStatus";
import type { BatchMessage, BridgeMessage } from "./protocol";
import { nameToSignal, signalToName } from "./protocol";
import type { WorkerTransport } from "./transport";
import { createTransport } from "./transport";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerBridgeOptions<
	TExpose extends Record<string, Store<any>>,
	TImport extends readonly string[],
> {
	/** Stores to send to the worker. */
	expose?: TExpose;
	/** Store names the worker will provide. */
	import?: TImport;
	/** Per-store transferable extractors for zero-copy ArrayBuffer passing. */
	transfer?: Partial<Record<keyof TExpose, (value: any) => Transferable[]>>;
	/** Debug name for Inspector. */
	name?: string;
}

/** Proxy stores created from imported worker store names. */
type ImportedStores<T extends readonly string[]> = {
	readonly [K in T[number]]: Store<any>;
};

export type WorkerBridge<
	_TExpose extends Record<string, Store<any>>,
	TImport extends readonly string[],
> = ImportedStores<TImport> &
	WithConnectionStatusStore<undefined> & {
		/** Destroy the bridge: sends TEARDOWN, disconnects, terminates worker. */
		destroy(): void;
	};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function isTransport(t: unknown): t is WorkerTransport {
	return (
		typeof t === "object" &&
		t !== null &&
		typeof (t as any).post === "function" &&
		typeof (t as any).listen === "function"
	);
}

export function workerBridge<
	TExpose extends Record<string, Store<any>>,
	TImport extends readonly string[],
>(
	target: unknown | WorkerTransport,
	opts: WorkerBridgeOptions<TExpose, TImport>,
): WorkerBridge<TExpose, TImport> {
	const transport = isTransport(target) ? target : createTransport(target);
	const bridgeName = opts.name ?? "workerBridge";
	const exposeEntries = Object.entries(opts.expose ?? {});
	const importNames = (opts.import ?? []) as readonly string[];
	const transferFns = opts.transfer ?? {};

	// -- Connection status ---------------------------------------------------
	const dummyStore = state<undefined>(undefined, { name: `${bridgeName}:inner` });
	const conn = withConnectionStatus(dummyStore, {
		initialStatus: "connecting",
		name: bridgeName,
	}) as WithConnectionStatusStore<undefined> & ConnectionControl;

	// -- Proxy stores for imports (worker → main) ----------------------------
	const proxyStores = new Map<string, WritableStore<any>>();
	for (const name of importNames) {
		const proxy = state(undefined, { name: `${bridgeName}:${name}` });
		// Forward PAUSE/RESUME/RESET from local consumers upstream to the worker.
		// TEARDOWN is handled separately via subscribe(onEnd) below to avoid double-send.
		(proxy as any)._onLifecycleSignal = (s: LifecycleSignal) => {
			if (s !== TEARDOWN && !destroyed) {
				transport.post({ t: "s", s: name, sig: signalToName(s) } satisfies BridgeMessage);
			}
		};
		proxyStores.set(name, proxy);
	}

	// -- Send coalescing via derived + effect --------------------------------
	// derived depends on all exposed stores. Two-phase push + bitmask means:
	// - In a batch: all DIRTY propagate, then all DATA → derived computes once
	// - Unbatched: each set() → DIRTY+DATA → derived computes once per change
	// The effect sends one postMessage per derived computation.

	const lastSent = new Map<string, any>();
	let disposeEffect: (() => void) | undefined;

	if (exposeEntries.length > 0) {
		const exposedStores = exposeEntries.map(([, s]) => s);

		const aggregated = derived(
			exposedStores,
			() => {
				const updates: Record<string, any> = {};
				for (const [name, store] of exposeEntries) {
					const v = store.get();
					if (v !== lastSent.get(name)) {
						updates[name] = v;
						lastSent.set(name, v);
					}
				}
				return updates;
			},
			// Always re-derive — the diff logic inside determines what to send
			{ equals: () => false, name: `${bridgeName}:aggregated` },
		);

		disposeEffect = effect(
			[aggregated],
			() => {
				const updates = aggregated.get();
				if (Object.keys(updates).length === 0) return undefined;

				// Build transfer list from all changed stores
				const transferList: Transferable[] = [];
				for (const name of Object.keys(updates)) {
					const fn = (transferFns as any)[name];
					if (fn) transferList.push(...fn(updates[name]));
				}

				const msg: BatchMessage = { t: "b", u: updates };
				transport.post(msg, transferList.length > 0 ? transferList : undefined);
				return undefined;
			},
			{ name: `${bridgeName}:sender` },
		);
	}

	// -- Receive handler -----------------------------------------------------
	let destroyed = false;

	const unlisten = transport.listen((data: BridgeMessage) => {
		if (destroyed) return;

		switch (data.t) {
			// Worker ready — create proxy stores with initial values
			case "r": {
				for (const [name, value] of Object.entries(data.stores)) {
					const proxy = proxyStores.get(name);
					if (proxy) proxy.set(value);
				}
				conn.setConnected();

				// Send initial values of exposed stores
				const initValues: Record<string, any> = {};
				for (const [name, store] of exposeEntries) {
					initValues[name] = store.get();
					lastSent.set(name, initValues[name]);
				}
				transport.post({ t: "i", stores: initValues } satisfies BridgeMessage);
				break;
			}

			// Single value update from worker
			case "v": {
				const proxy = proxyStores.get(data.s);
				if (proxy) proxy.set(data.d);
				break;
			}

			// Batch value update from worker
			case "b": {
				batch(() => {
					for (const [name, value] of Object.entries(data.u)) {
						const proxy = proxyStores.get(name);
						if (proxy) proxy.set(value);
					}
				});
				break;
			}

			// Lifecycle signal from worker → forward to proxy store's subscribers
			case "s": {
				const sig = nameToSignal(data.sig);
				if (!sig) break;
				if (sig === TEARDOWN) {
					// Per-store TEARDOWN: complete just that proxy so its consumers clean up.
					// Wildcard ("*"): bridge doesn't self-destroy — bridge.destroy() is explicit.
					if (data.s !== "*") {
						const proxy = proxyStores.get(data.s);
						if (proxy) (proxy as any).complete();
					}
				} else {
					// PAUSE/RESUME/RESET: propagate downstream to proxy store consumers
					const targets: WritableStore<any>[] =
						data.s === "*"
							? [...proxyStores.values()]
							: proxyStores.get(data.s)
								? [proxyStores.get(data.s)!]
								: [];
					for (const proxy of targets) (proxy as any).signal(sig);
				}
				break;
			}
		}
	});

	// -- Lifecycle signal forwarding (main → worker) -------------------------
	// When subscribers send lifecycle signals on imported proxy stores,
	// forward them to the worker
	const proxySubscriptions: Array<{ unsubscribe(): void }> = [];
	for (const [name, proxy] of proxyStores) {
		const sub = subscribe(proxy, () => {}, {
			onEnd: () => {
				// Proxy completed — inform worker
				if (!destroyed) {
					transport.post({
						t: "s",
						s: name,
						sig: signalToName(TEARDOWN),
					} satisfies BridgeMessage);
				}
			},
		});
		proxySubscriptions.push(sub);
	}

	// -- Build result object -------------------------------------------------
	const result: any = {
		get: conn.get,
		source: conn.source,
		get _status() {
			return conn._status;
		},
		status: conn.status,
		error: conn.error,
		destroy() {
			if (destroyed) return;
			destroyed = true;

			// Send bridge-level TEARDOWN to worker (s: "*" = entire bridge)
			transport.post({
				t: "s",
				s: "*",
				sig: signalToName(TEARDOWN),
			} satisfies BridgeMessage);

			// Cleanup local subscriptions
			for (const sub of proxySubscriptions) sub.unsubscribe();
			proxySubscriptions.length = 0;
			if (disposeEffect) disposeEffect();
			unlisten();

			conn.setClosed();
			transport.terminate?.();

			lastSent.clear();
			proxyStores.clear();
		},
	};

	// Attach proxy stores as properties
	for (const [name, proxy] of proxyStores) {
		result[name] = proxy as Store<any>;
	}

	Inspector.register(result, { kind: "workerBridge", name: bridgeName });

	return result as WorkerBridge<TExpose, TImport>;
}
