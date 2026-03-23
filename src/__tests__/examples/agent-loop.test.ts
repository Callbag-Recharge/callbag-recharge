import { describe, expect, it, vi } from "vitest";
import { agentLoop } from "../../patterns/agentLoop/index";

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
};

function simulateSearch(query: string): string[] {
	for (const [key, results] of Object.entries(SEARCH_DB)) {
		if (query.toLowerCase().includes(key.toLowerCase())) {
			return results;
		}
	}
	return [`No specific results for "${query}" - try refining`];
}

function createTestAgent() {
	return agentLoop<ResearchContext, ResearchAction>({
		name: "test-researcher",

		observe: (ctx) => {
			if (ctx.searchResults.length === 0) {
				return { ...ctx, searchResults: simulateSearch(ctx.question) };
			}
			const lastRefinement = ctx.refinements[ctx.refinements.length - 1];
			if (lastRefinement) {
				const newResults = simulateSearch(lastRefinement);
				return { ...ctx, searchResults: [...ctx.searchResults, ...newResults] };
			}
			return ctx;
		},

		plan: (ctx) => {
			if (ctx.searchResults.length < 4 && ctx.refinements.length < 2) {
				const refinement = `${ctx.question} details`;
				return { tool: "search" as const, query: refinement };
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

describe("agent-loop example", () => {
	it("initial phase is idle", () => {
		const agent = createTestAgent();
		expect(agent.phase.get()).toBe("idle");
	});

	it("initial context is undefined", () => {
		const agent = createTestAgent();
		expect(agent.context.get()).toBeUndefined();
	});

	it("initial iteration is 0", () => {
		const agent = createTestAgent();
		expect(agent.iteration.get()).toBe(0);
	});

	it("startResearch sets question and transitions out of idle", async () => {
		const agent = createTestAgent();

		agent.start({ question: "TypeScript", searchResults: [], refinements: [] });

		// After start, phase should not be idle anymore
		await vi.waitFor(() => {
			expect(agent.phase.get()).not.toBe("idle");
		});

		// Context should have the question
		const ctx = agent.context.get();
		expect(ctx?.question).toBe("TypeScript");
	});

	it("with gate enabled, pauses at awaiting_approval after plan", async () => {
		const agent = createTestAgent();

		agent.start({ question: "TypeScript", searchResults: [], refinements: [] });

		await vi.waitFor(() => {
			expect(agent.phase.get()).toBe("awaiting_approval");
		});

		// Should have a pending action
		expect(agent.pending.get().length).toBeGreaterThan(0);
		const pendingAction = agent.pending.get()[0];
		expect(pendingAction.tool).toBe("search");
	});

	it("approve() advances iteration count", async () => {
		const agent = createTestAgent();

		agent.start({ question: "TypeScript", searchResults: [], refinements: [] });

		await vi.waitFor(() => {
			expect(agent.phase.get()).toBe("awaiting_approval");
		});

		const iterBefore = agent.iteration.get();
		agent.approve();

		// After approval, the loop should continue (act, then next iteration or complete)
		// The iteration count should increase
		await vi.waitFor(() => {
			expect(agent.iteration.get()).toBeGreaterThan(iterBefore);
		});
	});

	it("stop() sets phase to completed", async () => {
		const agent = createTestAgent();

		agent.start({ question: "TypeScript", searchResults: [], refinements: [] });

		await vi.waitFor(() => {
			expect(agent.phase.get()).not.toBe("idle");
		});

		agent.stop();
		expect(agent.phase.get()).toBe("completed");
	});

	it("history tracks phase transitions", async () => {
		const agent = createTestAgent();

		agent.start({ question: "TypeScript", searchResults: [], refinements: [] });

		await vi.waitFor(() => {
			expect(agent.phase.get()).toBe("awaiting_approval");
		});

		const hist = agent.history.get();
		expect(hist.length).toBeGreaterThan(0);
		// History should contain at least observe and plan entries
		const phases = hist.map((h) => h.phase);
		expect(phases).toContain("observe");
		expect(phases).toContain("plan");
	});
});
