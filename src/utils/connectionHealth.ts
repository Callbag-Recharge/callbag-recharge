// ---------------------------------------------------------------------------
// Connection Health — heartbeat + auto-reconnect health monitor
// ---------------------------------------------------------------------------
// Manages connection lifecycle with:
// - Periodic heartbeat checks
// - Auto-reconnect with backoff on failure
// - Reactive status, healthy, and reconnectCount stores
// - Configurable max reconnect attempts
//
// Uses BackoffStrategy for reconnect delay escalation.
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { state } from "../core/state";
import type { Store } from "../core/types";
import type { BackoffStrategy } from "./backoff";

export interface ConnectionHealthOptions {
	/** Heartbeat interval in ms. Default: 30_000 */
	heartbeatMs?: number;
	/** Heartbeat timeout in ms. Default: 5_000 */
	timeoutMs?: number;
	/** Backoff strategy for reconnect delays. */
	backoff?: BackoffStrategy;
	/** Max reconnect attempts before giving up. Default: Infinity */
	maxReconnects?: number;
	/** Debug name. */
	name?: string;
}

export type ConnectionStatus = "connected" | "connecting" | "disconnected" | "failed";

export interface ConnectionHealthResult {
	/** Current connection status. */
	status: Store<ConnectionStatus>;
	/** Whether the connection is healthy (connected). */
	healthy: Store<boolean>;
	/** Number of reconnect attempts since last connect. */
	reconnectCount: Store<number>;
	/** Start monitoring with given heartbeat and connect functions. */
	start: (opts: {
		heartbeat: (signal: AbortSignal) => Promise<void>;
		connect: (signal: AbortSignal) => Promise<void>;
		disconnect: () => void;
	}) => void;
	/** Stop monitoring and disconnect. */
	stop: () => void;
}

/**
 * Creates a connection health monitor with heartbeat and auto-reconnect.
 *
 * @param opts - Configuration options.
 *
 * @returns `ConnectionHealthResult` — `status`, `healthy`, `reconnectCount`, `start`, `stop`.
 *
 * @example
 * ```ts
 * import { connectionHealth } from 'callbag-recharge/utils';
 * import { exponential } from 'callbag-recharge/utils/backoff';
 *
 * const health = connectionHealth({
 *   heartbeatMs: 10_000,
 *   timeoutMs: 3_000,
 *   backoff: exponential({ base: 1000 }),
 *   maxReconnects: 5,
 * });
 *
 * health.start({
 *   heartbeat: async (signal) => { await fetch('/health', { signal }); },
 *   connect: async (signal) => { ws = new WebSocket(url); },
 *   disconnect: () => { ws.close(); },
 * });
 *
 * health.status.get(); // 'connecting' | 'connected' | 'disconnected' | 'failed'
 * health.healthy.get(); // boolean
 * ```
 *
 * @category utils
 */
export function connectionHealth(opts?: ConnectionHealthOptions): ConnectionHealthResult {
	const heartbeatMs = opts?.heartbeatMs ?? 30_000;
	const timeoutMs = opts?.timeoutMs ?? 5_000;
	const backoffStrategy = opts?.backoff ?? null;
	const maxReconnects = opts?.maxReconnects ?? Number.POSITIVE_INFINITY;
	const name = opts?.name ?? "connectionHealth";

	const statusStore = state<ConnectionStatus>("disconnected", {
		name: `${name}.status`,
	});
	const reconnectCountStore = state<number>(0, {
		name: `${name}.reconnectCount`,
	});
	const healthyStore = derived([statusStore], () => statusStore.get() === "connected", {
		name: `${name}.healthy`,
	});

	let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
	let heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let abortController: AbortController | null = null;
	let heartbeatInFlight = false;
	let stopped = false;
	let callbacks: {
		heartbeat: (signal: AbortSignal) => Promise<void>;
		connect: (signal: AbortSignal) => Promise<void>;
		disconnect: () => void;
	} | null = null;
	let prevDelay: number | undefined;

	function clearTimers(): void {
		if (heartbeatTimer !== null) {
			clearTimeout(heartbeatTimer);
			heartbeatTimer = null;
		}
		if (heartbeatTimeoutTimer !== null) {
			clearTimeout(heartbeatTimeoutTimer);
			heartbeatTimeoutTimer = null;
		}
		if (reconnectTimer !== null) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		if (abortController) {
			abortController.abort();
			abortController = null;
		}
		heartbeatInFlight = false;
	}

	function scheduleNextHeartbeat(): void {
		if (stopped || !callbacks) return;
		heartbeatTimer = setTimeout(() => {
			heartbeatTimer = null;
			if (stopped || !callbacks) return;
			doHeartbeat();
		}, heartbeatMs);
	}

	function startHeartbeat(): void {
		if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
		scheduleNextHeartbeat();
	}

	async function doHeartbeat(): Promise<void> {
		if (!callbacks || stopped || heartbeatInFlight) return;
		heartbeatInFlight = true;

		const ac = new AbortController();
		heartbeatTimeoutTimer = setTimeout(() => {
			heartbeatTimeoutTimer = null;
			ac.abort();
		}, timeoutMs);

		try {
			await callbacks.heartbeat(ac.signal);
			if (heartbeatTimeoutTimer !== null) {
				clearTimeout(heartbeatTimeoutTimer);
				heartbeatTimeoutTimer = null;
			}
			heartbeatInFlight = false;
			// Chain next heartbeat after this one completes (no overlap)
			scheduleNextHeartbeat();
		} catch {
			if (heartbeatTimeoutTimer !== null) {
				clearTimeout(heartbeatTimeoutTimer);
				heartbeatTimeoutTimer = null;
			}
			heartbeatInFlight = false;
			if (stopped) return;
			// Heartbeat failed — trigger reconnect
			statusStore.set("disconnected");
			callbacks.disconnect();
			scheduleReconnect();
		}
	}

	function scheduleReconnect(): void {
		if (stopped || !callbacks) return;

		const attempt = reconnectCountStore.get();
		if (attempt >= maxReconnects) {
			statusStore.set("failed");
			return;
		}

		let delay: number;
		if (backoffStrategy) {
			const result = backoffStrategy(attempt, undefined, prevDelay);
			delay = result !== null ? result : 1000;
			prevDelay = delay;
		} else {
			delay = 1000;
		}

		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			if (stopped) return;
			reconnectCountStore.update((n) => n + 1);
			doConnect();
		}, delay);
	}

	async function doConnect(): Promise<void> {
		if (stopped || !callbacks) return;

		statusStore.set("connecting");
		abortController = new AbortController();

		try {
			await callbacks.connect(abortController.signal);
			if (stopped) return;
			abortController = null;
			statusStore.set("connected");
			reconnectCountStore.set(0);
			prevDelay = undefined;
			startHeartbeat();
		} catch {
			if (stopped) return;
			abortController = null;
			statusStore.set("disconnected");
			scheduleReconnect();
		}
	}

	function start(cbs: {
		heartbeat: (signal: AbortSignal) => Promise<void>;
		connect: (signal: AbortSignal) => Promise<void>;
		disconnect: () => void;
	}): void {
		// Clean up any existing connection before starting a new one
		if (callbacks) {
			clearTimers();
			callbacks.disconnect();
		}
		stopped = false;
		callbacks = cbs;
		reconnectCountStore.set(0);
		prevDelay = undefined;
		doConnect();
	}

	function stop(): void {
		stopped = true;
		clearTimers();
		if (callbacks) {
			callbacks.disconnect();
		}
		callbacks = null;
		statusStore.set("disconnected");
	}

	return {
		status: statusStore,
		healthy: healthyStore,
		reconnectCount: reconnectCountStore,
		start,
		stop,
	};
}
