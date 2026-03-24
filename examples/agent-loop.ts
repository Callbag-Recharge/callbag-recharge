/**
 * Agent Loop — Observe → Plan → Act with human-in-the-loop gate
 *
 * Demonstrates: agentLoop pattern with gate for human approval,
 * multi-iteration research agent that searches, evaluates, and refines.
 */

import { agentLoop } from "callbag-recharge/ai/agentLoop";

// #region display

// ── Types ────────────────────────────────────────────────────

export interface ResearchContext {
	question: string;
	searchResults: string[];
	refinements: string[];
	answer?: string;
}

export interface ResearchAction {
	tool: "search" | "summarize";
	query: string;
}

// ── Simulated tools ──────────────────────────────────────────

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
	// Match against keywords in the DB
	for (const [key, results] of Object.entries(SEARCH_DB)) {
		if (query.toLowerCase().includes(key.toLowerCase())) {
			return results;
		}
	}
	return [`No specific results for "${query}" — try refining`];
}

// ── Agent loop with gate ─────────────────────────────────────

export const agent = agentLoop<ResearchContext, ResearchAction>({
	name: "researcher",

	observe: (ctx) => {
		// Observe: add search results to context
		if (ctx.searchResults.length === 0) {
			return { ...ctx, searchResults: simulateSearch(ctx.question) };
		}
		// On subsequent iterations, search with refinements
		const lastRefinement = ctx.refinements[ctx.refinements.length - 1];
		if (lastRefinement) {
			const newResults = simulateSearch(lastRefinement);
			return {
				...ctx,
				searchResults: [...ctx.searchResults, ...newResults],
			};
		}
		return ctx;
	},

	plan: (ctx) => {
		// Plan: decide whether to search more or summarize
		if (ctx.searchResults.length < 4 && ctx.refinements.length < 2) {
			const refinement = `${ctx.question} details`;
			return { tool: "search" as const, query: refinement };
		}
		return { tool: "summarize" as const, query: ctx.question };
	},

	act: (action, ctx) => {
		if (action.tool === "search") {
			return {
				...ctx,
				refinements: [...ctx.refinements, action.query],
			};
		}
		// Summarize — produce final answer
		const summary = `${ctx.searchResults.slice(0, 3).join(". ")}.`;
		return { ...ctx, answer: summary };
	},

	shouldContinue: (ctx) => !ctx.answer,
	maxIterations: 5,
	gate: true,
});

// ── Exports for the demo ─────────────────────────────────────

export const {
	phase,
	context,
	lastAction,
	iteration,
	error,
	history,
	pending,
	start,
	stop,
	approve,
	reject,
	modify,
} = agent;

export function startResearch(question: string) {
	start({ question, searchResults: [], refinements: [] });
}

// #endregion display
