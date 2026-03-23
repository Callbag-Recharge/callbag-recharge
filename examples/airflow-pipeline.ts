/**
 * Airflow-style pipeline — declarative DAG with pipeline() + gate() + track()
 *
 * Demonstrates the orchestration primitives: pipeline(), step(), route(),
 * gate(), track(), withRetry(), withBreaker(), checkpoint().
 *
 * "n8n in 50 lines" — trigger → parallel fetch → gate → conditional routing → sinks.
 *
 * Run: pnpm exec tsx --tsconfig tsconfig.examples.json examples/airflow-pipeline.ts
 */
import { pipe } from "callbag-recharge";
import {
	filter,
	firstValueFrom,
	fromPromise,
	fromTimer,
	map,
	subscribe,
	switchMap,
} from "callbag-recharge/extra";
import {
	checkpoint,
	fromTrigger,
	gate,
	memoryAdapter,
	pipeline,
	route,
	step,
	track,
	withBreaker,
	withRetry,
	withTimeout,
} from "callbag-recharge/orchestrate";
import { circuitBreaker } from "callbag-recharge/utils/circuitBreaker";

// ---------------------------------------------------------------------------
// Shared resources
// ---------------------------------------------------------------------------
const breaker = circuitBreaker({ failureThreshold: 3, cooldownMs: 5000 });
const adapter = memoryAdapter();
let fraudCallCount = 0;

// ---------------------------------------------------------------------------
// Simulated async APIs
// ---------------------------------------------------------------------------
async function fraudCheck(payment: {
	userId: string;
	amount: number;
}): Promise<{ userId: string; amount: number; risk: string }> {
	fraudCallCount++;
	await firstValueFrom(fromTimer(50));
	if (fraudCallCount % 5 === 0) {
		throw new Error("Fraud API unavailable");
	}
	const risk = payment.amount > 5000 ? "high" : "low";
	return { ...payment, risk };
}

// ---------------------------------------------------------------------------
// Pipeline definition — declarative step wiring
// ---------------------------------------------------------------------------
const wf = pipeline({
	// Step 1: Manual trigger
	trigger: step(fromTrigger<{ userId: string; amount: number }>({ name: "payment:trigger" })),

	// Step 2: Validate — route valid vs invalid
	validate: step(["trigger"], (trigger) => {
		const [valid, invalid] = route(
			trigger,
			(v) => v !== undefined && (v as any).amount > 0 && (v as any).amount < 10_000,
			{ name: "payment:validate" },
		);
		// Side-effect: log invalid payments
		subscribe(invalid, (v) => {
			console.log(`[REJECTED] Invalid payment: $${v?.amount} for ${v?.userId}`);
		});
		return valid;
	}),

	// Step 3: Fraud check — external API with retry + timeout + breaker + checkpoint
	fraudCheck: step(["validate"], (validated) =>
		pipe(
			validated,
			filter((v): v is { userId: string; amount: number } => v != null),
			switchMap((payment) => fromPromise(fraudCheck(payment))),
			withRetry({ count: 2 }),
			withTimeout(5000),
			withBreaker(breaker),
			checkpoint("fraud-check", adapter),
			track({ name: "fraud-check" }),
		),
	),

	// Step 4: Route by risk level
	riskRoute: step(["fraudCheck"], (fraudChecked) => {
		const [highRisk, lowRisk] = route(fraudChecked, (v: any) => v?.risk === "high", {
			name: "risk:route",
		});
		// Attach both outputs — pipeline tracks the high-risk branch
		(highRisk as any)._lowRisk = lowRisk;
		return highRisk;
	}),

	// Step 5: Gate — human approval for high-risk
	approval: step(["riskRoute"], (highRisk) => pipe(highRisk, gate({ name: "approval" }))),

	// Step 6a: Process approved high-risk
	processHigh: step(["approval"], (approved) =>
		pipe(
			approved,
			map((v: any) => ({ ...v, status: "approved:manual" })),
			track({ name: "process:high" }),
		),
	),
});

// ---------------------------------------------------------------------------
// Low-risk branch (outside pipeline — accessed via riskRoute step)
// ---------------------------------------------------------------------------
const lowRisk = (wf.steps.riskRoute as any)._lowRisk;
const processedLow = pipe(
	lowRisk,
	map((v: any) => ({ ...v, status: "approved:auto" })),
	track({ name: "process:low" }),
);

// ---------------------------------------------------------------------------
// Aggregate results
// ---------------------------------------------------------------------------
const results: any[] = [];

subscribe(processedLow, (v) => {
	console.log(`[PROCESSED] ${v?.userId} $${v?.amount} → ${v?.status}`);
	results.push(v);
});

subscribe(wf.steps.processHigh, (v) => {
	console.log(`[PROCESSED] ${v?.userId} $${v?.amount} → ${v?.status}`);
	results.push(v);
});

// Monitor overall pipeline status
subscribe(wf.status, (s) => {
	console.log(`[PIPELINE] status: ${s}`);
});

// ---------------------------------------------------------------------------
// Run the workflow
// ---------------------------------------------------------------------------
console.log("=== Airflow Demo v2: Pipeline-based Payment Processing ===\n");

const trigger = wf.steps.trigger as ReturnType<typeof fromTrigger>;

// Low risk payments — auto-approved
trigger.fire({ userId: "alice", amount: 100 });
trigger.fire({ userId: "bob", amount: 250 });

// Invalid payment — rejected at validation
trigger.fire({ userId: "charlie", amount: -50 });

// High risk payment — needs human approval
trigger.fire({ userId: "dave", amount: 7500 });

// Check gate and approve (using callbag timers instead of raw setTimeout)
(async () => {
	await firstValueFrom(fromTimer(500));

	const gated = wf.steps.approval as any;
	console.log(`\n[GATE] Pending approvals: ${gated.pending.get().length}`);
	const pending = gated.pending.get();
	if (pending.length > 0) {
		console.log(`[GATE] Reviewing: ${JSON.stringify(pending[0])}`);
		gated.approve();
	}

	await firstValueFrom(fromTimer(200));

	console.log(`\n=== Results: ${results.length} payments processed ===`);
	for (const r of results) {
		console.log(`  ${r.userId}: $${r.amount} (${r.status})`);
	}

	// Show pipeline step metadata
	console.log("\n=== Step Metadata ===");
	for (const name of wf.order) {
		const meta = wf.stepMeta[name as keyof typeof wf.stepMeta]?.get();
		if (meta) {
			console.log(`  ${name}: ${meta.status} (${meta.count} values)`);
		}
	}

	// Cleanup
	wf.destroy();
	console.log("\n--- done ---");
})();
