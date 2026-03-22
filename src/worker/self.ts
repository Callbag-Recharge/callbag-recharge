// ---------------------------------------------------------------------------
// workerSelf — worker-side reactive store bridge
// ---------------------------------------------------------------------------
// Mirror of workerBridge() for the worker side. Creates proxy stores for
// imports from main thread, exposes local stores via the same wire protocol.
// Uses derived() + effect() for batch coalescing (same as bridge.ts).
//
// Handshake (worker perspective):
//   1. workerSelf() called — creates proxy stores for imports
//   2. Runs expose factory with proxy stores → gets stores to expose
//   3. Sends { t: 'r', stores: { name: initialValue, ... } } to main
//   4. Receives { t: 'i', stores: { name: value, ... } } from main
//   5. Updates proxy stores → triggers local effects
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { effect } from "../core/effect";
import { batch, TEARDOWN } from "../core/protocol";
import { state } from "../core/state";
import type { Store, WritableStore } from "../core/types";
import type { BatchMessage, BridgeMessage } from "./protocol";
import { nameToSignal, signalToName } from "./protocol";
import type { WorkerTransport } from "./transport";
import { createTransport } from "./transport";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerSelfOptions<TImport extends readonly string[]> {
	/** Store names that the main thread will provide. */
	import?: TImport;
	/** Factory that receives imported proxy stores and returns stores to expose. */
	expose: (imported: WorkerImported<TImport>) => Record<string, Store<any>>;
	/** Per-store transferable extractors for zero-copy ArrayBuffer passing. */
	transfer?: Record<string, (value: any) => Transferable[]>;
}

/** Proxy stores available inside the worker from main-thread exposed stores. */
type WorkerImported<T extends readonly string[]> = {
	readonly [K in T[number]]: Store<any>;
};

export interface WorkerSelfHandle {
	/** Dispose all subscriptions and stop the bridge. */
	destroy(): void;
}

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

export function workerSelf<TImport extends readonly string[]>(
	target: unknown | WorkerTransport,
	opts: WorkerSelfOptions<TImport>,
): WorkerSelfHandle {
	const transport = isTransport(target) ? target : createTransport(target);
	const importNames = (opts.import ?? []) as readonly string[];
	const transferFns = opts.transfer ?? {};

	// -- Proxy stores for imports (main → worker) ----------------------------
	const proxyStores = new Map<string, WritableStore<any>>();
	const importedObj: any = {};
	for (const name of importNames) {
		const s = state(undefined, { name: `worker:${name}` });
		// Forward PAUSE/RESUME/RESET from local consumers upstream to the main thread.
		// TEARDOWN is sent via the "s" message handler's destroy() path.
		(s as any)._onLifecycleSignal = (sig: any) => {
			if (sig !== TEARDOWN && !destroyed) {
				transport.post({ t: "s", s: name, sig: signalToName(sig) } satisfies BridgeMessage);
			}
		};
		proxyStores.set(name, s);
		importedObj[name] = s as Store<any>;
	}

	// -- Run expose factory ---------------------------------------------------
	const exposedStores = opts.expose(importedObj as WorkerImported<TImport>);
	const exposeEntries = Object.entries(exposedStores);

	// -- Send coalescing via derived + effect --------------------------------
	const lastSent = new Map<string, any>();
	let disposeEffect: (() => void) | undefined;
	let destroyed = false;

	if (exposeEntries.length > 0) {
		const stores = exposeEntries.map(([, s]) => s);

		const aggregated = derived(
			stores,
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
			{ equals: () => false, name: "workerSelf:aggregated" },
		);

		disposeEffect = effect(
			[aggregated],
			() => {
				if (destroyed) return;
				const updates = aggregated.get();
				if (Object.keys(updates).length === 0) return;

				const transferList: Transferable[] = [];
				for (const name of Object.keys(updates)) {
					const fn = (transferFns as any)[name];
					if (fn) transferList.push(...fn(updates[name]));
				}

				const msg: BatchMessage = { t: "b", u: updates };
				transport.post(msg, transferList.length > 0 ? transferList : undefined);
			},
			{ name: "workerSelf:sender" },
		);
	}

	// -- Receive handler -----------------------------------------------------
	const unlisten = transport.listen((data: BridgeMessage) => {
		if (destroyed) return;

		switch (data.t) {
			// Init from main — set proxy store values
			case "i": {
				batch(() => {
					for (const [name, value] of Object.entries(data.stores)) {
						const proxy = proxyStores.get(name);
						if (proxy) proxy.set(value);
					}
				});
				break;
			}

			// Single value update from main
			case "v": {
				const proxy = proxyStores.get(data.s);
				if (proxy) proxy.set(data.d);
				break;
			}

			// Batch value update from main
			case "b": {
				batch(() => {
					for (const [name, value] of Object.entries(data.u)) {
						const proxy = proxyStores.get(name);
						if (proxy) proxy.set(value);
					}
				});
				break;
			}

			// Lifecycle signal from main
			case "s": {
				const sig = nameToSignal(data.sig);
				if (!sig) break;
				if (sig === TEARDOWN) {
					if (data.s === "*") {
						// Bridge-level TEARDOWN — destroy entire worker side
						destroy();
					} else {
						// Per-store TEARDOWN — complete just that proxy
						const proxy = proxyStores.get(data.s);
						if (proxy) (proxy as any).complete();
					}
				} else {
					// PAUSE/RESUME/RESET: propagate downstream to proxy store consumers
					const targets =
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

	// -- Send ready message ---------------------------------------------------
	const readyValues: Record<string, any> = {};
	for (const [name, store] of exposeEntries) {
		readyValues[name] = store.get();
		lastSent.set(name, readyValues[name]);
	}
	transport.post({ t: "r", stores: readyValues } satisfies BridgeMessage);

	// -- Destroy --------------------------------------------------------------
	function destroy() {
		if (destroyed) return;
		destroyed = true;

		if (disposeEffect) disposeEffect();
		unlisten();
		transport.terminate?.();

		lastSent.clear();
		proxyStores.clear();
	}

	return { destroy };
}
