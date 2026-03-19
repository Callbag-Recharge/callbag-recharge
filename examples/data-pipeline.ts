/**
 * Reactive Data Pipeline (ETL)
 *
 * Demonstrates: fromAsyncIter + pipe operators for streaming ETL.
 * Filter, transform, batch, and write — fully reactive with backpressure.
 */

import { pipe } from "callbag-recharge";
import {
	bufferCount,
	filter,
	forEach,
	fromIter,
	map,
	scan,
	subscribe,
} from "callbag-recharge/extra";

// ── Simulated database rows ──────────────────────────────────

interface Event {
	id: number;
	type: string;
	amount: number;
	timestamp: number;
}

const rawEvents: Event[] = [
	{ id: 1, type: "purchase", amount: 42, timestamp: Date.now() },
	{ id: 2, type: "pageview", amount: 0, timestamp: Date.now() },
	{ id: 3, type: "purchase", amount: 99, timestamp: Date.now() },
	{ id: 4, type: "signup", amount: 0, timestamp: Date.now() },
	{ id: 5, type: "purchase", amount: 15, timestamp: Date.now() },
	{ id: 6, type: "purchase", amount: 200, timestamp: Date.now() },
];

// ── Pipeline: filter → transform → batch → write ────────────

const source = fromIter(rawEvents);

const pipeline = pipe(
	source,
	// Keep only purchase events
	filter((row: Event) => row.type === "purchase"),
	// Transform: convert to cents
	map((row: Event) => ({ ...row, amount: row.amount * 100 })),
	// Batch into groups of 2 for bulk insert
	bufferCount(2),
);

// ── Running total via scan ───────────────────────────────────

const purchases = pipe(
	source,
	filter((row: Event) => row.type === "purchase"),
	map((row: Event) => row.amount),
	scan((total, amount) => total + amount, 0),
);

// ── Execute ──────────────────────────────────────────────────

console.log("=== Batched writes ===");
const _unsub1 = forEach(pipeline, (batch) => {
	console.log(
		"Bulk insert:",
		batch.map((r) => `$${r.amount / 100}`),
	);
});

console.log("\n=== Running total ===");
const _unsub2 = subscribe(purchases, (total) => {
	console.log(`Running total: $${total}`);
});
