/**
 * Airflow-style workflow — zero async/await
 *
 * Demonstrates a multi-step data pipeline using Phase 1 orchestration operators:
 * - fromTrigger: manual workflow trigger
 * - route: conditional branching
 * - withTimeout: step-level timeouts
 * - withRetry: retry with backoff
 * - withBreaker: circuit breaker protection
 * - track: observable step metadata
 * - gate: human-in-the-loop approval
 *
 * The entire workflow is declarative, reactive, and composable.
 * No async/await, no promises — just pipes and stores.
 *
 * Run: npx tsx examples/airflow-demo.ts
 */
import { effect, pipe, producer } from "callbag-recharge";
import { map, subscribe, switchMap } from "callbag-recharge/extra";
import {
	fromTrigger,
	gate,
	route,
	track,
	withBreaker,
	withRetry,
	withTimeout,
} from "callbag-recharge/orchestrate";
import { circuitBreaker } from "callbag-recharge/utils";

// ---------------------------------------------------------------------------
// Step 1: Trigger — manual workflow start
// ---------------------------------------------------------------------------
const trigger = fromTrigger<{ userId: string; amount: number }>({
	name: "payment:trigger",
});

// ---------------------------------------------------------------------------
// Step 2: Validate — route valid vs invalid payments
// ---------------------------------------------------------------------------
const [validPayments, invalidPayments] = route(
	trigger,
	(v) => v !== undefined && (v as any).amount > 0 && (v as any).amount < 10_000,
	{ name: "payment:validate" },
);

// Log invalid payments
const invalidUnsub = subscribe(invalidPayments, (v) => {
	console.log(`[REJECTED] Invalid payment: $${v?.amount} for ${v?.userId}`);
});

// ---------------------------------------------------------------------------
// Step 3: Fraud check — simulate external API with retry + timeout
// ---------------------------------------------------------------------------
const breaker = circuitBreaker({ failureThreshold: 3, cooldownMs: 5000 });

let fraudCheckCallCount = 0;
const fraudChecked = pipe(
	validPayments,
	// Simulate fraud check API call
	switchMap((payment) =>
		producer<{ userId: string; amount: number; risk: string }>(({ emit, complete, error }) => {
			fraudCheckCallCount++;
			const timer = setTimeout(() => {
				// Simulate: 20% chance of API failure
				if (fraudCheckCallCount % 5 === 0) {
					error(new Error("Fraud API unavailable"));
					return;
				}
				const risk = (payment?.amount ?? 0) > 5000 ? "high" : "low";
				emit({ ...(payment as any), risk });
				complete();
			}, 50);
			return () => clearTimeout(timer);
		}),
	),
	withRetry({ count: 2 }),
	withTimeout(5000),
	withBreaker(breaker),
	track({ name: "fraud-check" }),
);

// Track fraud check step metadata
const fraudMeta = (fraudChecked as any).meta;
const metaUnsub = effect([fraudMeta], () => {
	const m = fraudMeta.get();
	if (m.status !== "idle") {
		console.log(`[FRAUD CHECK] status=${m.status} count=${m.count}`);
	}
});

// ---------------------------------------------------------------------------
// Step 4: Route by risk level
// ---------------------------------------------------------------------------
const [highRisk, lowRisk] = route(fraudChecked, (v: any) => v?.risk === "high", {
	name: "risk:route",
});

// ---------------------------------------------------------------------------
// Step 5: Gate — human approval for high-risk payments
// ---------------------------------------------------------------------------
const gated = pipe(highRisk, gate({ name: "approval" }));

// Low risk → auto-process
const processedLow = pipe(
	lowRisk,
	map((v: any) => ({ ...v, status: "approved:auto" })),
	track({ name: "process:low" }),
);

// High risk → needs approval
const processedHigh = pipe(
	gated,
	map((v: any) => ({ ...v, status: "approved:manual" })),
	track({ name: "process:high" }),
);

// ---------------------------------------------------------------------------
// Step 6: Aggregate results
// ---------------------------------------------------------------------------
const results: any[] = [];

const lowUnsub = subscribe(processedLow, (v) => {
	console.log(`[PROCESSED] ${v?.userId} $${v?.amount} → ${v?.status}`);
	results.push(v);
});

const highUnsub = subscribe(processedHigh, (v) => {
	console.log(`[PROCESSED] ${v?.userId} $${v?.amount} → ${v?.status}`);
	results.push(v);
});

// ---------------------------------------------------------------------------
// Run the workflow
// ---------------------------------------------------------------------------
console.log("=== Airflow Demo: Payment Processing Pipeline ===\n");

// Low risk payments — auto-approved
trigger.fire({ userId: "alice", amount: 100 });
trigger.fire({ userId: "bob", amount: 250 });

// Invalid payment — rejected at validation
trigger.fire({ userId: "charlie", amount: -50 });

// High risk payment — needs human approval
trigger.fire({ userId: "dave", amount: 7500 });

// Check gate
setTimeout(() => {
	console.log(`\n[GATE] Pending approvals: ${(gated as any).pending.get().length}`);
	const pending = (gated as any).pending.get();
	if (pending.length > 0) {
		console.log(`[GATE] Reviewing: ${JSON.stringify(pending[0])}`);
		(gated as any).approve(); // approve the pending payment
	}

	setTimeout(() => {
		console.log(`\n=== Results: ${results.length} payments processed ===`);
		for (const r of results) {
			console.log(`  ${r.userId}: $${r.amount} (${r.status})`);
		}

		// Cleanup
		invalidUnsub();
		lowUnsub();
		highUnsub();
		metaUnsub();
		console.log("\n--- done ---");
	}, 200);
}, 500);
