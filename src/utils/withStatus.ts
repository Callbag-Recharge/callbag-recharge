// ---------------------------------------------------------------------------
// withStatus — base async metadata wrapper
// ---------------------------------------------------------------------------
// Wraps any Store<T> in a producer that tracks lifecycle as companion stores.
// Status: pending → active → completed/errored.
// Companions are plain Store<T>, so framework bindings work with no
// special casing: useSubscribe(store.status).
//
// Usage:
//   const raw = producer<number>(({ emit }) => { ... });
//   const tracked = withStatus(raw);
//   subscribe(tracked.status, s => console.log(s));
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { batch } from "../core/protocol";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";

export type WithStatusStatus = "idle" | "pending" | "active" | "completed" | "errored";

export interface WithStatusOptions {
	/** Initial status. Default: "pending". Use "active" for stores that already have a value. */
	initialStatus?: WithStatusStatus;
}

export interface WithStatusStore<T> extends Store<T> {
	/** Lifecycle status: "pending" → "active" → "completed" | "errored". */
	status: Store<WithStatusStatus>;
	/** Last error, if any. Reset to undefined on new data after error. */
	error: Store<Error | undefined>;
}

/**
 * Wraps a `Store<T>` in a producer with `status` and `error` companion stores.
 *
 * @param store - The source store to wrap.
 * @param opts - Optional configuration.
 *
 * @returns `WithStatusStore<T>` — a new store with `status` and `error` companions. Single upstream subscription with proper teardown.
 *
 * @remarks **Lifecycle-aware:** Subscribes upstream inside a `producer()`, so teardown cleans up when all downstream sinks disconnect.
 * @remarks **Companions are stores:** `store.status` and `store.error` are plain `Store<T>`, subscribable with any sink or framework binding.
 * @remarks **Lifecycle:** `pending` (no data yet) → `active` (first DATA received) → `completed` (END) or `errored` (END with error).
 * @remarks **For async sources:** `subscribe()` does not emit initial values (Rx semantics), so `state()` stores stay "pending" until `.set()` is called. Use `{ initialStatus: "active" }` for pre-populated stores.
 *
 * @example
 * ```ts
 * import { producer, subscribe } from 'callbag-recharge';
 * import { withStatus } from 'callbag-recharge/utils';
 *
 * const raw = producer<number>(({ emit }) => {
 *   setTimeout(() => emit(42), 100);
 * });
 * const tracked = withStatus(raw);
 * subscribe(tracked.status, s => console.log(s)); // "active" after 100ms
 * subscribe(tracked, v => console.log(v));         // 42
 * ```
 *
 * @category utils
 */
export function withStatus<T>(store: Store<T>, opts?: WithStatusOptions): WithStatusStore<T> {
	const initialStatus = opts?.initialStatus ?? "pending";

	const statusStore = state<WithStatusStatus>(initialStatus, {
		name: "withStatus:status",
		equals: Object.is,
	});
	const errorStore = state<Error | undefined>(undefined, {
		name: "withStatus:error",
		equals: Object.is,
	});

	const inner = producer<T>(
		({ emit, complete, error }) => {
			// P6: Reset status/error on resubscription so stale state doesn't leak
			statusStore.set(initialStatus);
			errorStore.set(undefined);

			const unsub = subscribe(
				store,
				(value) => {
					if (statusStore.get() === "errored") {
						batch(() => {
							errorStore.set(undefined);
							statusStore.set("active");
						});
					} else {
						statusStore.set("active");
					}
					emit(value);
				},
				{
					onEnd: (err) => {
						if (err !== undefined) {
							const wrappedErr = err instanceof Error ? err : new Error(String(err));
							batch(() => {
								errorStore.set(wrappedErr);
								statusStore.set("errored");
							});
							error(err);
						} else {
							statusStore.set("completed");
							complete();
						}
					},
				},
			);

			return () => {
				unsub();
			};
		},
		{ initial: store.get(), resubscribable: true },
	);

	// Return a delegate object that exposes get()/source() from the
	// producer but adds status/error companions without overwriting
	// ProducerStore's .error() method.
	const delegate: WithStatusStore<T> = {
		get: () => store.get(),
		source: (type: number, payload?: any) => inner.source(type, payload),
		get _status() {
			return (inner as any)._status;
		},
		status: statusStore,
		error: errorStore,
	};

	Inspector.register(delegate, { kind: "withStatus" });

	return delegate;
}
