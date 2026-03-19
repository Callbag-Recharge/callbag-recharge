/**
 * Tool Call State Machine for Local LLMs
 *
 * Demonstrates: Reactive state machine for the LLM tool call lifecycle:
 * LLM requests tool → tool executes → result feeds back → LLM continues.
 * Uses stateMachine util + producer for a clean, observable flow.
 */

import { derived, effect } from "callbag-recharge";
import { stateMachine } from "callbag-recharge/utils";

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

type ToolState =
	| { status: "idle" }
	| { status: "pending"; call: ToolCall }
	| { status: "executing"; call: ToolCall; startedAt: number }
	| { status: "completed"; call: ToolCall; result: ToolResult }
	| { status: "error"; call: ToolCall; error: string };

type ToolEvent =
	| { type: "REQUEST"; call: ToolCall }
	| { type: "EXECUTE" }
	| { type: "COMPLETE"; result: ToolResult }
	| { type: "ERROR"; error: string }
	| { type: "RESET" };

// ── State machine ────────────────────────────────────────────

const toolFSM = stateMachine<ToolState, ToolEvent>(
	{ status: "idle" },
	{
		idle: {
			REQUEST: (_state, event) => ({
				status: "pending",
				call: event.call,
			}),
		},
		pending: {
			EXECUTE: (s) => ({
				status: "executing",
				call: s.call,
				startedAt: Date.now(),
			}),
			RESET: () => ({ status: "idle" }),
		},
		executing: {
			COMPLETE: (s, event) => ({
				status: "completed",
				call: s.call,
				result: event.result,
			}),
			ERROR: (s, event) => ({
				status: "error",
				call: s.call,
				error: event.error,
			}),
		},
		completed: {
			REQUEST: (_state, event) => ({
				status: "pending",
				call: event.call,
			}),
			RESET: () => ({ status: "idle" }),
		},
		error: {
			REQUEST: (_state, event) => ({
				status: "pending",
				call: event.call,
			}),
			RESET: () => ({ status: "idle" }),
		},
	},
);

// ── Derived views ────────────────────────────────────────────

const _isExecuting = derived([toolFSM.store], () => toolFSM.store.get().status === "executing", {
	name: "isExecuting",
});

const lastResult = derived(
	[toolFSM.store],
	() => {
		const s = toolFSM.store.get();
		return s.status === "completed" ? s.result : null;
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
	toolFSM.send({ type: "REQUEST", call });
	console.log(`[PENDING] Tool call: ${call.name}(${JSON.stringify(call.args)})`);

	toolFSM.send({ type: "EXECUTE" });
	console.log(`[EXECUTING] ${call.name}...`);

	const handler = tools[call.name];
	if (!handler) {
		toolFSM.send({ type: "ERROR", error: `Unknown tool: ${call.name}` });
		return;
	}

	try {
		const startMs = Date.now();
		const result = await handler(call.args);
		toolFSM.send({
			type: "COMPLETE",
			result: { name: call.name, result, durationMs: Date.now() - startMs },
		});
		console.log(`[COMPLETED] ${call.name} →`, result);
	} catch (e) {
		toolFSM.send({ type: "ERROR", error: String(e) });
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

toolFSM.send({ type: "RESET" });
console.log("\nFinal state:", toolFSM.store.get().status);

dispose();
