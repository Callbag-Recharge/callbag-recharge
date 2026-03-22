// ---------------------------------------------------------------------------
// withConnectionStatus — connection lifecycle companion stores
// ---------------------------------------------------------------------------
// Provides status + error companion stores for connection-oriented resources
// (worker bridges, WebSocket adapters, etc.). Unlike withStatus() which
// auto-transitions from observing a source store's DATA/END, this utility
// is imperatively controlled — the owner calls setConnected/setError/setClosed.
//
// Status lifecycle: connecting → connected → disconnected | failed
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { batch } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";

export type ConnectionStatusValue = "connecting" | "connected" | "disconnected" | "failed";

export interface WithConnectionStatusStore<T> extends Store<T> {
	/** Connection lifecycle status. */
	status: Store<ConnectionStatusValue>;
	/** Last error, if any. Cleared on successful reconnect. */
	error: Store<Error | undefined>;
}

export interface ConnectionControl {
	/** Mark connection as established. Clears any prior error. */
	setConnected(): void;
	/** Mark connection as failed with an error. */
	setError(err: Error): void;
	/** Mark connection as intentionally closed. */
	setClosed(): void;
}

export interface WithConnectionStatusOptions {
	/** Initial status. Default: "connecting". */
	initialStatus?: ConnectionStatusValue;
	/** Debug name for Inspector. */
	name?: string;
}

/**
 * Wraps a `Store<T>` with `status` and `error` companion stores for connection lifecycle.
 *
 * @param store - The store to extend with connection status companions.
 * @param opts - Optional configuration.
 *
 * @returns `WithConnectionStatusStore<T> & ConnectionControl` — the store with companions and imperative control methods.
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 * import { withConnectionStatus } from 'callbag-recharge/utils';
 *
 * const data = state<string[]>([]);
 * const conn = withConnectionStatus(data);
 * conn.setConnected();  // status → "connected"
 * conn.setError(new Error('timeout'));  // status → "failed"
 * conn.setClosed();     // status → "disconnected"
 * ```
 *
 * @category utils
 */
export function withConnectionStatus<T>(
	store: Store<T>,
	opts?: WithConnectionStatusOptions,
): WithConnectionStatusStore<T> & ConnectionControl {
	const initialStatus = opts?.initialStatus ?? "connecting";

	const statusStore = state<ConnectionStatusValue>(initialStatus, {
		name: opts?.name ? `${opts.name}:status` : "connectionStatus",
		equals: Object.is,
	});
	const errorStore = state<Error | undefined>(undefined, {
		name: opts?.name ? `${opts.name}:error` : "connectionError",
		equals: Object.is,
	});

	const delegate: WithConnectionStatusStore<T> & ConnectionControl = {
		get: () => store.get(),
		source: (type: number, payload?: any) => store.source(type, payload),
		get _status() {
			return (store as any)._status;
		},

		status: statusStore,
		error: errorStore,

		setConnected() {
			batch(() => {
				errorStore.set(undefined);
				statusStore.set("connected");
			});
		},
		setError(err: Error) {
			batch(() => {
				errorStore.set(err);
				statusStore.set("failed");
			});
		},
		setClosed() {
			batch(() => {
				errorStore.set(undefined);
				statusStore.set("disconnected");
			});
		},
	};

	Inspector.register(delegate, { kind: "withConnectionStatus" });

	return delegate;
}
