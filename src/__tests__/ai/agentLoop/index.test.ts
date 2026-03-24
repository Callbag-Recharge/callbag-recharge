import { describe, expect, it, vi } from "vitest";
import { agentLoop } from "../../../ai/agentLoop";
import { subscribe } from "../../../core/subscribe";

describe("agentLoop", () => {
	it("starts in idle state", () => {
		const agent = agentLoop({
			observe: (ctx) => ctx,
			plan: () => "action",
			act: (_a, ctx) => ctx,
		});

		expect(agent.phase.get()).toBe("idle");
		expect(agent.context.get()).toBeUndefined();
		expect(agent.lastAction.get()).toBeUndefined();
		expect(agent.iteration.get()).toBe(0);
		expect(agent.error.get()).toBeUndefined();
		expect(agent.history.get()).toEqual([]);
	});

	it("runs single iteration: observe → plan → act → completed", async () => {
		const agent = agentLoop<{ value: number }, string>({
			observe: (ctx) => ({ value: ctx.value + 1 }),
			plan: (ctx) => `double:${ctx.value}`,
			act: (_action, ctx) => ({ value: ctx.value * 2 }),
		});

		agent.start({ value: 1 });
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"));

		expect(agent.context.get()).toEqual({ value: 4 }); // observe: 2, act: 4
		expect(agent.lastAction.get()).toBe("double:2");
		expect(agent.iteration.get()).toBe(1);
		expect(agent.error.get()).toBeUndefined();
	});

	it("runs multiple iterations with shouldContinue", async () => {
		const agent = agentLoop<number, string>({
			observe: (n) => n + 1,
			plan: (n) => `inc:${n}`,
			act: (_a, n) => n,
			shouldContinue: (_n, iter) => iter < 3,
		});

		agent.start(0);
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"));

		expect(agent.iteration.get()).toBe(3);
		expect(agent.context.get()).toBe(3); // 3 iterations of observe: +1
	});

	it("respects maxIterations safety limit", async () => {
		const agent = agentLoop<number, string>({
			observe: (n) => n + 1,
			plan: () => "go",
			act: (_a, n) => n,
			shouldContinue: () => true, // always continue
			maxIterations: 5,
		});

		agent.start(0);
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"));

		expect(agent.iteration.get()).toBe(5);
	});

	it("handles async observe/plan/act", async () => {
		const agent = agentLoop<string, string>({
			observe: async (ctx) => {
				await new Promise((r) => setTimeout(r, 5));
				return `${ctx}+observed`;
			},
			plan: async (_ctx) => {
				await new Promise((r) => setTimeout(r, 5));
				return "action";
			},
			act: async (_action, ctx) => {
				await new Promise((r) => setTimeout(r, 5));
				return `${ctx}+acted`;
			},
		});

		agent.start("start");
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"), { timeout: 1000 });

		expect(agent.context.get()).toBe("start+observed+acted");
	});

	it("transitions to errored on observe error", async () => {
		const agent = agentLoop<string, string>({
			observe: () => {
				throw new Error("observe failed");
			},
			plan: () => "action",
			act: (_a, ctx) => ctx,
		});

		agent.start("test");
		await vi.waitFor(() => expect(agent.phase.get()).toBe("errored"));

		expect(agent.error.get()).toBeInstanceOf(Error);
		expect((agent.error.get() as Error).message).toBe("observe failed");
	});

	it("transitions to errored on plan error", async () => {
		const agent = agentLoop<string, string>({
			observe: (ctx) => ctx,
			plan: () => {
				throw new Error("plan failed");
			},
			act: (_a, ctx) => ctx,
		});

		agent.start("test");
		await vi.waitFor(() => expect(agent.phase.get()).toBe("errored"));
		expect((agent.error.get() as Error).message).toBe("plan failed");
	});

	it("transitions to errored on act error", async () => {
		const agent = agentLoop<string, string>({
			observe: (ctx) => ctx,
			plan: () => "action",
			act: () => {
				throw new Error("act failed");
			},
		});

		agent.start("test");
		await vi.waitFor(() => expect(agent.phase.get()).toBe("errored"));
		expect((agent.error.get() as Error).message).toBe("act failed");
	});

	it("tracks history of phase transitions", async () => {
		const agent = agentLoop<number, string>({
			observe: (n) => n + 1,
			plan: () => "go",
			act: (_a, n) => n,
		});

		agent.start(0);
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"));

		const history = agent.history.get();
		const phases = history.map((h) => h.phase);
		expect(phases).toEqual(["observe", "plan", "act", "completed"]);
	});

	it("stop() halts the loop", async () => {
		let observeCount = 0;
		const agent = agentLoop<number, string>({
			observe: async (n) => {
				observeCount++;
				await new Promise((r) => setTimeout(r, 20));
				return n + 1;
			},
			plan: () => "go",
			act: (_a, n) => n,
			shouldContinue: () => true,
			maxIterations: 100,
		});

		agent.start(0);
		// Let first observe start
		await new Promise((r) => setTimeout(r, 5));
		agent.stop();

		// Wait a bit to ensure loop doesn't continue
		await new Promise((r) => setTimeout(r, 100));
		expect(observeCount).toBeLessThanOrEqual(2);
	});

	it("stores are reactive", async () => {
		const agent = agentLoop<number, string>({
			observe: (n) => n + 1,
			plan: () => "go",
			act: (_a, n) => n * 2,
		});

		const phases: string[] = [];
		const unsub = subscribe(agent.phase, (p) => phases.push(p));

		agent.start(1);
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"));

		expect(phases).toContain("observe");
		expect(phases).toContain("plan");
		expect(phases).toContain("act");
		expect(phases).toContain("completed");
		unsub.unsubscribe();
	});

	it("start() while running restarts with new context", async () => {
		let observeDelay = 50;
		const agent = agentLoop<string, string>({
			observe: async (ctx) => {
				await new Promise((r) => setTimeout(r, observeDelay));
				return `${ctx}+observed`;
			},
			plan: () => "go",
			act: (_a, ctx) => ctx,
		});

		agent.start("first");
		// Let first loop enter observe
		await new Promise((r) => setTimeout(r, 10));

		// Start again while running — should supersede first
		observeDelay = 5;
		agent.start("second");
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"), { timeout: 2000 });

		// Second run should have completed, context should be from second start
		expect(agent.context.get()).toBe("second+observed");
		// History should only contain second run entries
		const history = agent.history.get();
		expect(history[0].context).toBe("second");
	});

	it("clears history and error on new start", async () => {
		const agent = agentLoop<string, string>({
			observe: (ctx) => ctx,
			plan: () => "go",
			act: (_a, ctx) => ctx,
		});

		agent.start("first");
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"));
		expect(agent.history.get().length).toBeGreaterThan(0);

		agent.start("second");
		// History should be reset for new run
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"));
		// History only contains entries from the second run
		const history = agent.history.get();
		expect(history[0].context).toBe("second");
	});

	// ---------------------------------------------------------------------------
	// Gate support
	// ---------------------------------------------------------------------------
	it("gate pauses at awaiting_approval after plan", async () => {
		const agent = agentLoop<string, string>({
			observe: (ctx) => ctx,
			plan: () => "do_something",
			act: (_a, ctx) => `${ctx}+acted`,
			gate: true,
		});

		agent.start("test");
		await vi.waitFor(() => expect(agent.phase.get()).toBe("awaiting_approval"));

		// Action is pending
		expect((agent as any).pending.get()).toEqual(["do_something"]);
		expect(agent.lastAction.get()).toBe("do_something");
	});

	it("gate approve() resumes act phase", async () => {
		const agent = agentLoop<string, string>({
			observe: (ctx) => ctx,
			plan: () => "action1",
			act: (action, ctx) => `${ctx}+${action}`,
			gate: true,
		});

		agent.start("start");
		await vi.waitFor(() => expect(agent.phase.get()).toBe("awaiting_approval"));

		(agent as any).approve();
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"));

		expect(agent.context.get()).toBe("start+action1");
	});

	it("gate modify() transforms action before act", async () => {
		const agent = agentLoop<string, string>({
			observe: (ctx) => ctx,
			plan: () => "original",
			act: (action, ctx) => `${ctx}+${action}`,
			gate: true,
		});

		agent.start("start");
		await vi.waitFor(() => expect(agent.phase.get()).toBe("awaiting_approval"));

		(agent as any).modify((a: string) => `modified_${a}`);
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"));

		expect(agent.context.get()).toBe("start+modified_original");
	});

	it("gate reject() causes loop to re-observe and re-plan", async () => {
		let planCount = 0;
		const agent = agentLoop<string, string>({
			observe: (ctx) => ctx,
			plan: () => {
				planCount++;
				return `action_${planCount}`;
			},
			act: (action, ctx) => `${ctx}+${action}`,
			gate: true,
		});

		agent.start("start");
		await vi.waitFor(() => expect(agent.phase.get()).toBe("awaiting_approval"));
		expect(planCount).toBe(1);

		// Reject first action — loop re-plans on next iteration
		(agent as any).reject();
		// Wait for the re-plan to run (planCount increments before phase returns to awaiting_approval)
		await vi.waitFor(() => expect(planCount).toBe(2));
		await vi.waitFor(() => expect(agent.phase.get()).toBe("awaiting_approval"));

		// Approve second action
		(agent as any).approve();
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"));

		expect(agent.context.get()).toBe("start+action_2");
	});

	it("gate history includes awaiting_approval phase", async () => {
		const agent = agentLoop<string, string>({
			observe: (ctx) => ctx,
			plan: () => "action1",
			act: (_a, ctx) => ctx,
			gate: true,
		});

		agent.start("test");
		await vi.waitFor(() => expect(agent.phase.get()).toBe("awaiting_approval"));
		(agent as any).approve();
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"));

		const phases = agent.history.get().map((h) => h.phase);
		expect(phases).toEqual(["observe", "plan", "awaiting_approval", "act", "completed"]);
	});

	it("gate open() auto-approves future actions", async () => {
		const agent = agentLoop<number, string>({
			observe: (n) => n + 1,
			plan: (n) => `action:${n}`,
			act: (_a, n) => n,
			shouldContinue: (_n, iter) => iter < 2,
			gate: true,
		});

		// Open gate before starting — should auto-approve
		(agent as any).open();
		agent.start(0);
		await vi.waitFor(() => expect(agent.phase.get()).toBe("completed"));

		expect(agent.iteration.get()).toBe(2);
	});

	it("stop() during awaiting_approval unblocks cleanly", async () => {
		const agent = agentLoop<string, string>({
			observe: (ctx) => ctx,
			plan: () => "action1",
			act: (_a, ctx) => ctx,
			gate: true,
		});

		agent.start("test");
		await vi.waitFor(() => expect(agent.phase.get()).toBe("awaiting_approval"));

		agent.stop();
		// Should complete, not hang
		expect(agent.phase.get()).toBe("completed");
		expect(agent.error.get()).toBeUndefined();
	});

	it("stop() during plan phase halts cleanly", async () => {
		const agent = agentLoop<string, string>({
			observe: (ctx) => ctx,
			plan: async () => {
				await new Promise((r) => setTimeout(r, 50));
				return "go";
			},
			act: (_a, ctx) => ctx,
			shouldContinue: () => true,
			maxIterations: 100,
		});

		agent.start("test");
		// Let observe complete, plan should be in progress
		await new Promise((r) => setTimeout(r, 10));
		agent.stop();

		await new Promise((r) => setTimeout(r, 100));
		// Should have stopped — not errored
		expect(["completed"]).toContain(agent.phase.get());
		expect(agent.error.get()).toBeUndefined();
	});
});
