/**
 * Tool Call State Machine for Local LLMs
 *
 * Demonstrates: Reactive state machine for the LLM tool call lifecycle:
 * LLM requests tool → tool executes → result feeds back → LLM continues.
 * Uses stateMachine util + derived for a clean, observable flow.
 */

import { derived, effect } from "callbag-recharge";
import { stateMachine } from "callbag-recharge/utils/stateMachine";

// ── Types ────────────────────────────────────────────────────

interface ToolCall {
	name: string;
	args: Record<string, unknown>;
}

interface ToolResult {
	name: string;
	result: unknown;
	durationMs: number;
}

interface ToolContext {
	call?: ToolCall;
	result?: ToolResult;
	error?: string;
	startedAt?: number;
}

type ToolState = "idle" | "pending" | "executing" | "completed" | "error";
type ToolEvent = "REQUEST" | "EXECUTE" | "COMPLETE" | "ERROR" | "RESET";

// ── State machine ────────────────────────────────────────────

const toolFSM = stateMachine<ToolContext, ToolState, ToolEvent>(
	{},
	{
		initial: "idle",
		states: {
			idle: {
				on: { REQUEST: "pending" },
			},
			pending: {
				on: {
					EXECUTE: {
						to: "executing",
						action: (ctx) => ({ ...ctx, startedAt: Date.now() }),
					},
					RESET: "idle",
				},
			},
			executing: {
				on: {
					COMPLETE: "completed",
					ERROR: "error",
				},
			},
			completed: {
				on: {
					REQUEST: "pending",
					RESET: {
						to: "idle",
						action: () => ({}),
					},
				},
			},
			error: {
				on: {
					REQUEST: "pending",
					RESET: {
						to: "idle",
						action: () => ({}),
					},
				},
			},
		},
	},
);

// ── Derived views ────────────────────────────────────────────

const _isExecuting = derived([toolFSM.current], () => toolFSM.current.get() === "executing", {
	name: "isExecuting",
});

const lastResult = derived(
	[toolFSM.context],
	() => {
		const ctx = toolFSM.context.get();
		return ctx.result ?? null;
	},
	{ name: "lastResult" },
);

// ── Tool registry ────────────────────────────────────────────

const tools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
	get_weather: async (args) => ({
		temp: 72,
		condition: "sunny",
		location: args.location,
	}),
	search_web: async (args) => ({
		results: [`Result for "${args.query}"`, "Another result"],
	}),
};

// ── Execute tool calls ───────────────────────────────────────

async function handleToolCall(call: ToolCall) {
	toolFSM.send("REQUEST", { call });
	console.log(`[PENDING] Tool call: ${call.name}(${JSON.stringify(call.args)})`);

	toolFSM.send("EXECUTE");
	console.log(`[EXECUTING] ${call.name}...`);

	const handler = tools[call.name];
	if (!handler) {
		toolFSM.send("ERROR", { error: `Unknown tool: ${call.name}` });
		return;
	}

	try {
		const startMs = Date.now();
		const result = await handler(call.args);
		const toolResult: ToolResult = {
			name: call.name,
			result,
			durationMs: Date.now() - startMs,
		};
		toolFSM.send("COMPLETE", { result: toolResult });
		console.log(`[COMPLETED] ${call.name} →`, result);
	} catch (e) {
		toolFSM.send("ERROR", { error: String(e) });
		console.log(`[ERROR] ${call.name}: ${e}`);
	}
}

// ── Simulate LLM requesting tool calls ───────────────────────

const dispose = effect([lastResult], () => {
	const result = lastResult.get();
	if (result) {
		console.log(`\nTool result ready to feed back to LLM:`, result);
	}
});

// LLM says: "I need to check the weather"
await handleToolCall({ name: "get_weather", args: { location: "San Francisco" } });

// LLM says: "Now search for restaurants"
await handleToolCall({ name: "search_web", args: { query: "best restaurants SF" } });

toolFSM.send("RESET");
console.log("\nFinal state:", toolFSM.current.get());

// Show the FSM graph
console.log("\n── State Machine Diagram ──");
console.log(toolFSM.toMermaid());

dispose();
