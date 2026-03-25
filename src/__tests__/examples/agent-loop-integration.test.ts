/**
 * Agent loop integration tests — tests the exact agent-loop.ts example logic
 * including full approve/reject/modify/stop/restart cycles.
 *
 * Regression tests for: gate producer teardown nullifying the next gate's
 * emitGate during synchronous callback chains (promise-to-callbag migration).
 */
import { describe, expect, it } from "vitest";
import { agentLoop } from "../../ai/agentLoop/index";

// ── Types (mirrors examples/agent-loop.ts) ──

interface ResearchContext {
	question: string;
	searchResults: string[];
	refinements: string[];
	answer?: string;
}

interface ResearchAction {
	tool: "search" | "summarize";
	query: string;
}

// ── Simulated tools ──

const SEARCH_DB: Record<string, string[]> = {
	TypeScript: [
		"TypeScript is a typed superset of JavaScript",
		"TypeScript compiles to plain JavaScript",
		"TypeScript supports interfaces and generics",
	],
	reactive: [
		"Reactive programming models data as streams",
		"Observables push values to subscribers",
		"Callbag is a lightweight reactive spec",
	],
	"state management": [
		"State management coordinates app state",
		"Stores provide get/set/subscribe patterns",
		"Derived state computes from dependencies",
	],
};

function simulateSearch(query: string): string[] {
	for (const [key, results] of Object.entries(SEARCH_DB)) {
		if (query.toLowerCase().includes(key.toLowerCase())) return results;
	}
	return [`No specific results for "${query}" - try refining`];
}

function createResearchAgent() {
	return agentLoop<ResearchContext, ResearchAction>({
		name: "test-researcher",
		observe: (ctx) => {
			if (ctx.searchResults.length === 0) {
				return { ...ctx, searchResults: simulateSearch(ctx.question) };
			}
			const last = ctx.refinements[ctx.refinements.length - 1];
			if (last) {
				return { ...ctx, searchResults: [...ctx.searchResults, ...simulateSearch(last)] };
			}
			return ctx;
		},
		plan: (ctx) => {
			if (ctx.searchResults.length < 4 && ctx.refinements.length < 2) {
				return { tool: "search" as const, query: `${ctx.question} details` };
			}
			return { tool: "summarize" as const, query: ctx.question };
		},
		act: (action, ctx) => {
			if (action.tool === "search") {
				return { ...ctx, refinements: [...ctx.refinements, action.query] };
			}
			const summary = `${ctx.searchResults.slice(0, 3).join(". ")}.`;
			return { ...ctx, answer: summary };
		},
		shouldContinue: (ctx) => !ctx.answer,
		maxIterations: 5,
		gate: true,
	});
}

describe("agent-loop example integration", () => {
	it("complete research flow: approve all until completion", () => {
		const agent = createResearchAgent();

		agent.start({
			question: "TypeScript reactive",
			searchResults: [],
			refinements: [],
		});
		expect(agent.phase.get()).toBe("awaiting_approval");

		// First action should be "search" (< 4 results)
		expect(agent.pending.get()[0].tool).toBe("search");

		// Approve search
		agent.approve();
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.iteration.get()).toBe(2);

		// After search + observe with refinement, should have 6 results → summarize
		expect(agent.pending.get()[0].tool).toBe("summarize");

		// Approve summarize
		agent.approve();
		// Should complete — shouldContinue returns false when answer exists
		expect(agent.phase.get()).toBe("completed");
		expect(agent.context.get()?.answer).toBeTruthy();
	});

	it("stop mid-research and restart with new question", () => {
		const agent = createResearchAgent();

		agent.start({
			question: "TypeScript",
			searchResults: [],
			refinements: [],
		});
		expect(agent.phase.get()).toBe("awaiting_approval");
		agent.approve();
		expect(agent.phase.get()).toBe("awaiting_approval");

		// Stop in the middle
		agent.stop();
		expect(agent.phase.get()).toBe("completed");

		// Restart with a different question
		agent.start({
			question: "reactive",
			searchResults: [],
			refinements: [],
		});
		expect(agent.phase.get()).toBe("awaiting_approval");

		// Should be working on the new question
		const ctx = agent.context.get()!;
		expect(ctx.question).toBe("reactive");
		expect(ctx.searchResults).toContain("Reactive programming models data as streams");
	});

	it("reject causes re-plan on next iteration", () => {
		const agent = createResearchAgent();

		agent.start({
			question: "TypeScript",
			searchResults: [],
			refinements: [],
		});
		const iter1 = agent.iteration.get();
		expect(agent.pending.get()[0].tool).toBe("search");

		// Reject the search action
		agent.reject();

		// Should re-plan from next iteration
		expect(agent.iteration.get()).toBeGreaterThan(iter1);
		expect(agent.phase.get()).toBe("awaiting_approval");
	});

	it("modify changes the action and advances through act", () => {
		const agent = createResearchAgent();

		agent.start({
			question: "TypeScript",
			searchResults: [],
			refinements: [],
		});
		expect(agent.pending.get()[0].tool).toBe("search");

		agent.modify((a: ResearchAction) => ({
			...a,
			query: `${a.query} advanced`,
		}));

		// After modify acts as approve+transform, the loop advances
		// through act and into the next iteration's gate
		expect(agent.phase.get()).toBe("awaiting_approval");
		// The context should reflect the modified action was executed
		const ctx = agent.context.get()!;
		expect(ctx.refinements.length).toBeGreaterThan(0);
		expect(ctx.refinements[0]).toContain("advanced");
	});

	it("history tracks all phase transitions", () => {
		const agent = createResearchAgent();

		agent.start({
			question: "TypeScript",
			searchResults: [],
			refinements: [],
		});
		agent.approve();

		const phases = agent.history.get().map((h) => h.phase);
		expect(phases).toContain("observe");
		expect(phases).toContain("plan");
		expect(phases).toContain("awaiting_approval");
		expect(phases).toContain("act");
	});

	it("multiple stop/restart cycles preserve correctness", () => {
		const agent = createResearchAgent();
		const questions = ["TypeScript", "reactive", "state management"];

		for (const q of questions) {
			agent.start({ question: q, searchResults: [], refinements: [] });
			expect(agent.phase.get()).toBe("awaiting_approval");

			const ctx = agent.context.get()!;
			expect(ctx.question).toBe(q);
			expect(ctx.searchResults.length).toBeGreaterThan(0);

			agent.approve();
			expect(agent.phase.get()).toBe("awaiting_approval");

			agent.stop();
			expect(agent.phase.get()).toBe("completed");
		}
	});

	it("full run to completion then restart works", () => {
		const agent = createResearchAgent();

		// First run — approve everything
		agent.start({
			question: "TypeScript reactive",
			searchResults: [],
			refinements: [],
		});

		let safety = 0;
		while (agent.phase.get() === "awaiting_approval" && safety < 20) {
			agent.approve();
			safety++;
		}
		expect(agent.phase.get()).toBe("completed");
		expect(agent.context.get()?.answer).toBeTruthy();

		// Restart after natural completion
		agent.start({
			question: "state management",
			searchResults: [],
			refinements: [],
		});
		expect(agent.phase.get()).toBe("awaiting_approval");
		expect(agent.context.get()?.question).toBe("state management");
		expect(agent.iteration.get()).toBe(1);
	});
});
