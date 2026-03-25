import { describe, expect, it } from "vitest";
import { agentLoop } from "../../src/ai/agentLoop/index";

describe("agent-loop gate teardown bug", () => {
	it("approve then approve again should work (verifies emitGate not nulled)", () => {
		const agent = agentLoop<{ n: number }, string>({
			name: "test",
			observe: (ctx) => ctx,
			plan: (ctx) => `action-${ctx.n}`,
			act: (_action, ctx) => ({ n: ctx.n + 1 }),
			shouldContinue: () => true,
			maxIterations: 10,
			gate: true,
		});

		agent.start({ n: 0 });
		expect(agent.phase.get()).toBe("awaiting_approval");

		// First approve — triggers old gate emit+complete, which sets up new gate
		agent.approve();
		// BUG: old gate teardown sets emitGate=null AFTER new gate set emitGate
		console.log("Phase after first approve:", agent.phase.get());
		expect(agent.phase.get()).toBe("awaiting_approval"); // should be at new gate

		// Second approve — should work but emitGate is null due to teardown bug
		agent.approve();
		console.log("Phase after second approve:", agent.phase.get());
		// If bug exists: phase stays "awaiting_approval" because emitGate was null
		// If fixed: phase should be "awaiting_approval" for next iteration
		expect(agent.iteration.get()).toBe(3); // should have advanced
	});
});
