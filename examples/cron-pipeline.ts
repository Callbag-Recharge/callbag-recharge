/**
 * Cron-triggered Pipeline (Airflow-in-TypeScript)
 *
 * Demonstrates: fromCron + exhaustMap + retry + derived for
 * a scheduled data pipeline with automatic retry and aggregation.
 */

import { derived, effect, pipe } from "callbag-recharge";
import { exhaustMap, fromPromise, fromTimer, retry, subscribe } from "callbag-recharge/extra";
import { fromCron } from "callbag-recharge/orchestrate";

// ── Simulated data fetchers ──────────────────────────────────

function fetchBankTransactions(): Promise<number[]> {
	return Promise.resolve([100, 250, 75]);
}

function fetchCardCharges(): Promise<number[]> {
	return Promise.resolve([50, 120, 300]);
}

// ── Cron-triggered pipeline ──────────────────────────────────

// Trigger every minute (in production: '0 9 * * *' for 9am daily)
const trigger = fromCron("* * * * *");

// Each trigger runs the fetch (exhaustMap ignores overlapping triggers)
const bankData = pipe(
	trigger,
	exhaustMap(() => fromPromise(fetchBankTransactions())),
	retry(3), // retry up to 3 times on failure
);

const cardData = pipe(
	trigger,
	exhaustMap(() => fromPromise(fetchCardCharges())),
	retry(3),
);

// ── Diamond-safe aggregation ─────────────────────────────────

// derived() waits for both sources to resolve before computing — once, not twice
const aggregate = derived([bankData, cardData], () => {
	const bank = bankData.get() ?? [];
	const cards = cardData.get() ?? [];
	const all = [...bank, ...cards];
	return {
		total: all.reduce((a, b) => a + b, 0),
		count: all.length,
		sources: { bank: bank.length, cards: cards.length },
	};
});

// ── Report ───────────────────────────────────────────────────

const dispose = effect([aggregate], () => {
	const report = aggregate.get();
	if (report) {
		console.log(
			`Report: $${report.total} from ${report.count} transactions (${report.sources.bank} bank, ${report.sources.cards} card)`,
		);
	}
});

// Let the cron tick once, then clean up
subscribe(fromTimer(62_000), () => {
	dispose();
	console.log("Pipeline stopped.");
	process.exit(0);
});

console.log("Cron pipeline running (triggers every minute)...");
