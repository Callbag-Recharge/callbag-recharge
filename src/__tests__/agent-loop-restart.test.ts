import { describe, expect, it } from "vitest";
import { agentLoop } from "../../src/ai/agentLoop/index";

function createAgent() {
	let observeCount = 0;
	return {
		observeCount: () => observeCount,
		agent: agentLoop<{ n: number }, string>({
			name: "restart-test",
			observe: (ctx) => {
				observeCount++;
				return { n: ctx.n + 1 };
			},
			plan: (ctx) => `action-${ctx.n}`,
			act: (_action, ctx) => ctx,
			shouldContinue: () => true,
			maxIterations: 10,
			gate: true,
		}),
	};
}

describe("agent-loop restart", () => {
	it("should restart after stop (basic)", () => {
		const { agent, observeCount } = createAgent();
		agent.start({ n: 0 });
		expect(agent.phase.get()).toBe("awaiting_approval");
		agent.stop();
		expect(agent.phase.get()).toBe("completed");
		agent.start({ n: 100 });
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(observeCount()).toBe(2);
	});

	it("should restart after approve+stop cycle", () => {
		const { agent, observeCount } = createAgent();

		agent.start({ n: 0 });
		expect(agent.phase.get()).toBe("awaiting_approval");

		// Approve a few times
		agent.approve();
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.iteration.get()).toBe(2);

		agent.approve();
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.iteration.get()).toBe(3);

		// Now stop
		agent.stop();
		expect(agent.phase.get()).toBe("completed");

		// Now restart
		agent.start({ n: 200 });
		console.log("Phase after restart:", agent.phase.get());
		console.log("Iteration after restart:", agent.iteration.get());
		console.log("Context:", agent.context.get());
		console.log("Observe count:", observeCount());

		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.iteration.get()).toBe(1);
	});

	it("should restart after natural completion", () => {
		const agent = agentLoop<{ n: number }, string>({
			name: "complete-test",
			observe: (ctx) => ctx,
			plan: () => "done",
			act: (_action, ctx) => ctx,
			shouldContinue: () => false, // completes after 1 iteration
			maxIterations: 10,
		});

		agent.start({ n: 0 });
		expect(agent.phase.get()).toBe("completed");

		// Restart
		agent.start({ n: 1 });
		console.log("Phase after restart (no gate):", agent.phase.get());
		expect(agent.phase.get()).toBe("completed"); // completes immediately again
		expect(agent.context.get()).toEqual({ n: 1 });
	});

	it("should restart after reject", () => {
		const { agent } = createAgent();
		agent.start({ n: 0 });
		expect(agent.phase.get()).toBe("awaiting_approval");

		// Reject
		agent.reject();
		// After reject, should re-plan on next iteration
		expect(agent.phase.get()).toBe("awaiting_approval");

		// Stop
		agent.stop();

		// Restart
		agent.start({ n: 50 });
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.context.get()).toEqual({ n: 51 });
	});
});
