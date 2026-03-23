/**
 * Real-time Dashboard — Live aggregation with reactive data structures
 *
 * Demonstrates: reactiveMap (per-service metrics with TTL), reactiveLog
 * (event stream with bounded buffer), derived views, interval-driven simulation.
 */

import { derived, state } from "callbag-recharge";
import { reactiveLog, reactiveMap } from "callbag-recharge/data";

// #region display

// ── Types ────────────────────────────────────────────────────

export interface ServiceMetric {
	name: string;
	latencyMs: number;
	errorRate: number;
	requestCount: number;
	lastUpdated: number;
}

export interface MetricEvent {
	service: string;
	latencyMs: number;
	isError: boolean;
	timestamp: number;
}

// ── Data structures ──────────────────────────────────────────

/** Per-service metrics with 30s TTL auto-expiry */
export const services = reactiveMap<ServiceMetric>({ ttl: 30_000 });

/** Event stream — last 100 events in a circular buffer */
export const eventLog = reactiveLog<MetricEvent>({ maxLength: 100 });

// ── Derived views ────────────────────────────────────────────

export const serviceCount = services.sizeStore;

export const healthSummary = derived(
	[services.sizeStore, eventLog.lengthStore],
	() => {
		let healthy = 0;
		let warning = 0;
		let critical = 0;
		for (const [, m] of services.entries()) {
			if (m.errorRate > 0.05 || m.latencyMs > 1000) critical++;
			else if (m.errorRate > 0.02 || m.latencyMs > 500) warning++;
			else healthy++;
		}
		return { healthy, warning, critical, total: services.size() };
	},
	{ name: "healthSummary" },
);

export const totalEvents = eventLog.lengthStore;

/** Last 10 events for the UI tail */
export const recentEvents = eventLog.tail(10);

// ── Simulation ───────────────────────────────────────────────

const SERVICE_NAMES = ["api-gateway", "auth-service", "user-db", "payment", "notifications"];
const running = state(false, { name: "dashboard.running" });
export { running };

let intervalId: ReturnType<typeof setInterval> | undefined;

export function startSimulation() {
	if (running.get()) return;
	running.set(true);

	intervalId = setInterval(() => {
		// Pick a random service
		const name = SERVICE_NAMES[Math.floor(Math.random() * SERVICE_NAMES.length)];
		const latencyMs = Math.floor(50 + Math.random() * 800 + (Math.random() > 0.9 ? 1500 : 0));
		const isError = Math.random() < 0.08;

		// Update per-service metric
		const existing = services.get(name);
		const reqCount = (existing?.requestCount ?? 0) + 1;
		const _errCount = isError ? 1 : 0;
		const oldErrRate = existing?.errorRate ?? 0;
		// Exponential moving average for error rate
		const errorRate = oldErrRate * 0.9 + (isError ? 0.1 : 0);

		services.set(name, {
			name,
			latencyMs,
			errorRate,
			requestCount: reqCount,
			lastUpdated: Date.now(),
		});

		// Append to event log
		eventLog.append({
			service: name,
			latencyMs,
			isError,
			timestamp: Date.now(),
		});
	}, 400);
}

export function stopSimulation() {
	running.set(false);
	if (intervalId !== undefined) {
		clearInterval(intervalId);
		intervalId = undefined;
	}
}

export function resetDashboard() {
	stopSimulation();
	services.clear();
	eventLog.clear();
}

// #endregion display
