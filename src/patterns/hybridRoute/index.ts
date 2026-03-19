// ---------------------------------------------------------------------------
// hybridRoute — confidence-based routing between local/edge and cloud LLMs
// ---------------------------------------------------------------------------
// Composes reactive stores to route requests between a local/edge handler
// and a cloud handler. Supports automatic fallback to cloud on local failure.
// Tracks routing decisions and counts reactively.
//
// Usage:
//   const router = hybridRoute({
//     local: (input) => localLLM(input),
//     cloud: (input) => cloudLLM(input),
//     shouldRoute: (input) => input.length < 100 ? 'local' : 'cloud',
//   });
//   router.process('What is 2+2?');
// ---------------------------------------------------------------------------

import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";
import type { Store } from "../../core/types";

export type RouteTarget = "local" | "cloud" | "idle";

export interface HybridRouteOptions<T, R> {
	/** Handler for local/edge LLM processing. Returns a store that emits the result. */
	local: (input: T) => Store<R>;
	/** Handler for cloud LLM processing. Returns a store that emits the result. */
	cloud: (input: T) => Store<R>;
	/** Routing decision function. Default: always 'local'. */
	shouldRoute?: (input: T) => "local" | "cloud";
	/** Auto-fallback to cloud on local error. Default: true. */
	fallbackOnError?: boolean;
	/** Debug name for stores. */
	name?: string;
}

export interface HybridRouteResult<T, R> {
	/** The current result store. */
	store: Store<R | undefined>;
	/** Which route was taken for the current/last request. */
	route: Store<RouteTarget>;
	/** Number of requests routed to local. */
	localCount: Store<number>;
	/** Number of requests routed to cloud. */
	cloudCount: Store<number>;
	/** Last error encountered (from local or cloud). */
	error: Store<unknown | undefined>;
	/** Process an input through the router. */
	process: (input: T) => void;
	/** Dispose and unsubscribe from the current handler. */
	dispose: () => void;
}

/**
 * Creates a confidence-based router between local/edge and cloud LLM handlers.
 *
 * @param opts - Configuration with local/cloud handlers and routing logic.
 *
 * @returns `HybridRouteResult<T, R>` — reactive stores for result, route, counts, plus `process()` and `dispose()`.
 *
 * @remarks **Fallback:** When `fallbackOnError` is true (default), local failures automatically retry via cloud.
 * @remarks **Routing:** `shouldRoute` decides per-request. Default is always 'local'.
 * @remarks **Reactive:** Route target, counts, and result are all reactive stores.
 *
 * @example
 * ```ts
 * import { hybridRoute } from 'callbag-recharge/patterns/hybridRoute';
 * import { state } from 'callbag-recharge';
 *
 * const router = hybridRoute({
 *   local: (prompt) => { const s = state(`local: ${prompt}`); return s; },
 *   cloud: (prompt) => { const s = state(`cloud: ${prompt}`); return s; },
 *   shouldRoute: (prompt) => prompt.length < 50 ? 'local' : 'cloud',
 * });
 *
 * router.process('Hi');
 * router.route.get(); // 'local'
 * router.store.get(); // 'local: Hi'
 * router.dispose(); // cleanup
 * ```
 *
 * @seeAlso [route](/api/route) — low-level binary split, [rescue](/api/rescue) — error recovery
 *
 * @category patterns
 */
export function hybridRoute<T, R>(opts: HybridRouteOptions<T, R>): HybridRouteResult<T, R> {
	const name = opts.name ?? "hybridRoute";
	const fallbackOnError = opts.fallbackOnError ?? true;
	const shouldRoute = opts.shouldRoute ?? (() => "local" as const);

	const resultStore = state<R | undefined>(undefined, { name: `${name}.result` });
	const routeStore = state<RouteTarget>("idle", { name: `${name}.route` });
	const localCountStore = state<number>(0, { name: `${name}.localCount` });
	const cloudCountStore = state<number>(0, { name: `${name}.cloudCount` });
	const errorStore = state<unknown | undefined>(undefined, { name: `${name}.error` });

	let currentUnsub: (() => void) | null = null;

	function cleanup(): void {
		if (currentUnsub) {
			currentUnsub();
			currentUnsub = null;
		}
	}

	function subscribeToHandler(handler: Store<R>, target: "local" | "cloud", input: T): void {
		cleanup();

		// Read initial value immediately
		resultStore.set(handler.get());

		currentUnsub = subscribe(
			handler,
			(value) => {
				resultStore.set(value);
			},
			{
				onEnd: (err) => {
					if (err !== undefined) {
						// Error — try fallback if local and fallback enabled
						if (target === "local" && fallbackOnError) {
							errorStore.set(err);
							routeStore.set("cloud");
							cloudCountStore.update((n) => n + 1);
							try {
								const cloudHandler = opts.cloud(input);
								subscribeToHandler(cloudHandler, "cloud", input);
							} catch (cloudErr) {
								errorStore.set(cloudErr);
							}
						} else {
							errorStore.set(err);
						}
					}
				},
			},
		);
	}

	function process(input: T): void {
		cleanup();
		errorStore.set(undefined);

		const target = shouldRoute(input);
		routeStore.set(target);

		if (target === "local") {
			localCountStore.update((n) => n + 1);
			try {
				const handler = opts.local(input);
				subscribeToHandler(handler, "local", input);
			} catch (err) {
				errorStore.set(err);
				if (fallbackOnError) {
					routeStore.set("cloud");
					cloudCountStore.update((n) => n + 1);
					try {
						const cloudHandler = opts.cloud(input);
						subscribeToHandler(cloudHandler, "cloud", input);
					} catch (cloudErr) {
						errorStore.set(cloudErr);
					}
				}
			}
		} else {
			cloudCountStore.update((n) => n + 1);
			try {
				const handler = opts.cloud(input);
				subscribeToHandler(handler, "cloud", input);
			} catch (err) {
				errorStore.set(err);
			}
		}
	}

	return {
		store: resultStore,
		route: routeStore,
		localCount: localCountStore,
		cloudCount: cloudCountStore,
		error: errorStore,
		process,
		dispose: cleanup,
	};
}
