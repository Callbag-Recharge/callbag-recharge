/**
 * Real-time Dashboard
 *
 * Demonstrates: state + derived + effect for a reactive dashboard
 * that combines multiple data sources into derived metrics.
 */

import { batch, derived, effect, state } from "callbag-recharge";

// ── Data sources ─────────────────────────────────────────────

const activeUsers = state(0, { name: "activeUsers" });
const totalRequests = state(0, { name: "totalRequests" });
const errorCount = state(0, { name: "errors" });
const responseTimeMs = state(0, { name: "responseTime" });

// ── Derived metrics ──────────────────────────────────────────

const errorRate = derived(
	[errorCount, totalRequests],
	() => {
		const total = totalRequests.get();
		return total > 0 ? (errorCount.get() / total) * 100 : 0;
	},
	{ name: "errorRate" },
);

const healthStatus = derived(
	[errorRate, responseTimeMs],
	() => {
		const rate = errorRate.get();
		const latency = responseTimeMs.get();
		if (rate > 5 || latency > 1000) return "critical";
		if (rate > 1 || latency > 500) return "warning";
		return "healthy";
	},
	{ name: "healthStatus" },
);

const dashboardSummary = derived(
	[activeUsers, totalRequests, errorRate, healthStatus, responseTimeMs],
	() => ({
		users: activeUsers.get(),
		requests: totalRequests.get(),
		errorRate: `${errorRate.get().toFixed(2)}%`,
		latency: `${responseTimeMs.get()}ms`,
		status: healthStatus.get(),
	}),
	{ name: "summary" },
);

// ── Side effect: log dashboard updates ───────────────────────

const dispose = effect([dashboardSummary], () => {
	console.log("Dashboard:", dashboardSummary.get());
});

// ── Simulate data arriving ───────────────────────────────────

// batch() ensures derived stores recompute once, not per-set
batch(() => {
	activeUsers.set(142);
	totalRequests.set(1500);
	errorCount.set(3);
	responseTimeMs.set(45);
});
// Dashboard: { users: 142, requests: 1500, errorRate: '0.20%', latency: '45ms', status: 'healthy' }

batch(() => {
	errorCount.set(120);
	responseTimeMs.set(1200);
});
// Dashboard: { users: 142, requests: 1500, errorRate: '8.00%', latency: '1200ms', status: 'critical' }

// ── Cleanup ──────────────────────────────────────────────────

dispose();
