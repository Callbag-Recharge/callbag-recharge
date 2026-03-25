/**
 * Agent loop gate lifecycle tests — validates the gate producer teardown
 * doesn't interfere with subsequent gates during synchronous callback chains.
 *
 * Regression tests for: gate producer teardown nullifying next gate's emitGate
 * when emit(v) synchronously triggers the next iteration's waitForApproval
 * before complete() fires the old producer's teardown.
 */
import { describe, expect, it } from "vitest";
import { agentLoop } from "../../../ai/agentLoop/index";

function createGatedAgent(opts?: { maxIterations?: number }) {
	let observeCount = 0;
	let actCount = 0;
	return {
		observeCount: () => observeCount,
		actCount: () => actCount,
		agent: agentLoop<{ n: number }, string>({
			name: "gate-test",
			observe: (ctx) => {
				observeCount++;
				return { n: ctx.n + 1 };
			},
			plan: (ctx) => `action-${ctx.n}`,
			act: (_action, ctx) => {
				actCount++;
				return ctx;
			},
			shouldContinue: () => true,
			maxIterations: opts?.maxIterations ?? 10,
			gate: true,
		}),
	};
}

describe("agentLoop gate lifecycle", () => {
	it("consecutive approves advance the loop", () => {
		const { agent, actCount } = createGatedAgent();

		agent.start({ n: 0 });
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.iteration.get()).toBe(1);

		agent.approve();
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.iteration.get()).toBe(2);
		expect(actCount()).toBe(1);

		agent.approve();
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.iteration.get()).toBe(3);
		expect(actCount()).toBe(2);

		agent.approve();
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.iteration.get()).toBe(4);
		expect(actCount()).toBe(3);
	});

	it("stop then restart works after single approve", () => {
		const { agent, observeCount } = createGatedAgent();

		agent.start({ n: 0 });
		expect(agent.phase.get()).toBe("awaiting_approval");

		agent.approve();
		expect(agent.phase.get()).toBe("awaiting_approval");

		agent.stop();
		expect(agent.phase.get()).toBe("completed");

		agent.start({ n: 100 });
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.context.get()?.n).toBe(101); // fresh context, observed once
		expect(observeCount()).toBe(3); // 2 from first run + 1 from restart
	});

	it("stop then restart works from initial gate", () => {
		const { agent } = createGatedAgent();

		agent.start({ n: 0 });
		expect(agent.phase.get()).toBe("awaiting_approval");

		agent.stop();
		expect(agent.phase.get()).toBe("completed");

		agent.start({ n: 50 });
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.context.get()?.n).toBe(51);
	});

	it("multiple stop/restart cycles work", () => {
		const { agent } = createGatedAgent();

		for (let cycle = 0; cycle < 5; cycle++) {
			agent.start({ n: cycle * 100 });
			expect(agent.phase.get()).toBe("awaiting_approval");
			expect(agent.iteration.get()).toBe(1);

			agent.approve();
			expect(agent.phase.get()).toBe("awaiting_approval");

			agent.stop();
			expect(agent.phase.get()).toBe("completed");
		}
	});

	it("restart clears history and pending", () => {
		const { agent } = createGatedAgent();

		agent.start({ n: 0 });
		agent.approve();
		agent.approve();
		const histLen = agent.history.get().length;
		expect(histLen).toBeGreaterThan(0);

		agent.stop();
		agent.start({ n: 0 });

		// History cleared by start(), then repopulated by new run
		const newHist = agent.history.get();
		expect(newHist.length).toBeLessThan(histLen);
		// New history should contain observe, plan, awaiting_approval
		const phases = newHist.map((h) => h.phase);
		expect(phases).toContain("observe");
		expect(phases).toContain("plan");
		expect(phases).toContain("awaiting_approval");
	});

	it("reject then approve works across iterations", () => {
		const { agent } = createGatedAgent();

		agent.start({ n: 0 });
		expect(agent.phase.get()).toBe("awaiting_approval");
		const iter1 = agent.iteration.get();

		// Reject causes re-plan on next iteration
		agent.reject();
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.iteration.get()).toBeGreaterThan(iter1);

		// Approve should still work after reject
		agent.approve();
		expect(agent.phase.get()).toBe("awaiting_approval");
	});

	it("modify then next iteration advances correctly", () => {
		const { agent, actCount } = createGatedAgent();

		agent.start({ n: 0 });
		expect(agent.phase.get()).toBe("awaiting_approval");

		agent.modify((a) => `modified-${a}`);

		// Modify acts as approve with transform — loop advances through act
		// then reaches the next iteration's gate
		expect(actCount()).toBe(1);
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.iteration.get()).toBe(2);
	});

	it("runs to maxIterations with consecutive approves", () => {
		const { agent, actCount } = createGatedAgent({ maxIterations: 3 });

		agent.start({ n: 0 });

		agent.approve(); // iteration 1 → act → iteration 2
		agent.approve(); // iteration 2 → act → iteration 3
		agent.approve(); // iteration 3 → act → maxIterations reached

		expect(agent.phase.get()).toBe("completed");
		expect(actCount()).toBe(3);
	});

	it("start while running (re-entrant start) restarts the loop", () => {
		const { agent, observeCount } = createGatedAgent();

		agent.start({ n: 0 });
		expect(agent.phase.get()).toBe("awaiting_approval");
		const countBefore = observeCount();

		// Start again while at gate — should stop old loop and start new one
		agent.start({ n: 200 });
		expect(agent.phase.get()).toBe("awaiting_approval");
		// New observe should have fired with fresh context
		expect(observeCount()).toBe(countBefore + 1);
		expect(agent.context.get()?.n).toBe(201);
		expect(agent.iteration.get()).toBe(1);
	});
});
