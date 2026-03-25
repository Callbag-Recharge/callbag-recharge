// ---------------------------------------------------------------------------
// toolCallState — reactive state machine for tool call lifecycle
// ---------------------------------------------------------------------------
// Manages the full lifecycle of LLM tool calls: request → execute → result.
// Built on stateMachine util for typed transitions and state stores for
// reactive metadata. Tracks tool name, arguments, result, error, duration,
// and maintains a history of all calls.
//
// Usage:
//   const tool = toolCallState<SearchArgs, SearchResult>();
//   tool.request('search', { query: 'weather' });
//   await tool.execute(args => searchAPI(args));
//   tool.result.get(); // { temperature: 72, ... }
// ---------------------------------------------------------------------------

import { state } from "../../core/state";
import type { Store } from "../../core/types";
import { rawFromAny } from "../../raw/fromAny";
import { rawSubscribe } from "../../raw/subscribe";

export type ToolCallStatus = "idle" | "pending" | "executing" | "completed" | "errored";

export interface ToolCallEntry<TArgs, TResult> {
	/** Tool name. */
	toolName: string;
	/** Arguments passed to the tool. */
	args: TArgs;
	/** Result of the tool call, if completed. */
	result?: TResult;
	/** Error, if the tool call errored. */
	error?: unknown;
	/** Status of this call. */
	status: ToolCallStatus;
	/** Duration in ms (from execute start to completion/error). */
	duration?: number;
	/** Timestamp of the request. */
	requestedAt: number;
}

export interface ToolCallStateOptions {
	/** Debug name for stores. */
	name?: string;
	/** Max history entries to keep. Default: 100. */
	maxHistory?: number;
}

export interface ToolCallStateResult<TArgs, TResult> {
	/** Current lifecycle status. */
	status: Store<ToolCallStatus>;
	/** Current tool name (set on request). */
	toolName: Store<string | undefined>;
	/** Current arguments (set on request). */
	args: Store<TArgs | undefined>;
	/** Current result (set on completion). */
	result: Store<TResult | undefined>;
	/** Current error (set on failure). */
	error: Store<unknown | undefined>;
	/** Duration of last execution in ms. */
	duration: Store<number | undefined>;
	/** Request a tool call. Sets status to 'pending'. */
	request: (toolName: string, args: TArgs) => void;
	/** Execute the pending tool call. Transitions: pending → executing → completed/errored. */
	execute: (fn: (args: TArgs) => Promise<TResult> | TResult) => void;
	/** Reset to idle state. */
	reset: () => void;
	/** History of all tool calls. */
	history: Store<ToolCallEntry<TArgs, TResult>[]>;
}

/**
 * Creates a reactive state machine for tool call lifecycle management.
 *
 * @param opts - Optional configuration.
 *
 * @returns `ToolCallStateResult<TArgs, TResult>` — reactive stores for status, args, result, error, duration, plus `request()`, `execute()`, `reset()`.
 *
 * @remarks **Lifecycle:** idle → pending (request) → executing (execute) → completed/errored → idle (reset).
 * @remarks **History:** Tracks all calls with args, result, error, duration. Bounded by `maxHistory`.
 * @remarks **Auto-transition:** `execute()` handles the pending → executing → completed/errored transition.
 *
 * @example
 * ```ts
 * import { toolCallState } from 'callbag-recharge/ai/toolCallState';
 *
 * const tool = toolCallState<{ query: string }, string[]>();
 *
 * tool.request('search', { query: 'weather' });
 * tool.status.get(); // 'pending'
 *
 * await tool.execute(async (args) => {
 *   const res = await fetch(`/api/search?q=${args.query}`);
 *   return res.json();
 * });
 *
 * tool.status.get(); // 'completed'
 * tool.result.get(); // ['sunny', '72°F']
 * tool.history.get(); // [{ toolName: 'search', args: {...}, result: [...], status: 'completed', ... }]
 * ```
 *
 * @seeAlso [stateMachine](/api/stateMachine) — underlying FSM, [agentLoop](/api/agentLoop) — agent orchestration
 *
 * @category ai
 */
export function toolCallState<TArgs = unknown, TResult = unknown>(
	opts?: ToolCallStateOptions,
): ToolCallStateResult<TArgs, TResult> {
	const name = opts?.name ?? "toolCall";
	const maxHistory = opts?.maxHistory ?? 100;

	const statusStore = state<ToolCallStatus>("idle", { name: `${name}.status` });
	const toolNameStore = state<string | undefined>(undefined, { name: `${name}.toolName` });
	const argsStore = state<TArgs | undefined>(undefined, { name: `${name}.args` });
	const resultStore = state<TResult | undefined>(undefined, { name: `${name}.result` });
	const errorStore = state<unknown | undefined>(undefined, { name: `${name}.error` });
	const durationStore = state<number | undefined>(undefined, { name: `${name}.duration` });
	const historyStore = state<ToolCallEntry<TArgs, TResult>[]>([], {
		name: `${name}.history`,
	});

	let currentEntry: ToolCallEntry<TArgs, TResult> | null = null;

	function request(toolName: string, args: TArgs): void {
		const current = statusStore.get();
		if (current === "executing") return; // don't interrupt execution

		toolNameStore.set(toolName);
		argsStore.set(args);
		resultStore.set(undefined);
		errorStore.set(undefined);
		durationStore.set(undefined);
		statusStore.set("pending");

		currentEntry = {
			toolName,
			args,
			status: "pending",
			requestedAt: Date.now(),
		};
	}

	function execute(fn: (args: TArgs) => Promise<TResult> | TResult): void {
		if (statusStore.get() !== "pending") return;
		if (currentEntry === null) return;

		const args = currentEntry.args;
		const thisEntry = currentEntry;

		statusStore.set("executing");
		thisEntry.status = "executing";
		const startTime = Date.now();

		const addToHistory = () => {
			if (currentEntry === thisEntry) {
				currentEntry = null;
			}
			const entry = { ...thisEntry };
			historyStore.update((prev) => {
				const next = [...prev, entry];
				return next.length > maxHistory ? next.slice(-maxHistory) : next;
			});
		};

		rawSubscribe(
			rawFromAny(fn(args)),
			(result: TResult) => {
				const duration = Date.now() - startTime;

				resultStore.set(result);
				durationStore.set(duration);
				statusStore.set("completed");

				thisEntry.result = result;
				thisEntry.status = "completed";
				thisEntry.duration = duration;
				addToHistory();
			},
			{
				onEnd: (err?: unknown) => {
					if (err === undefined) return;
					const duration = Date.now() - startTime;

					errorStore.set(err);
					durationStore.set(duration);
					statusStore.set("errored");

					thisEntry.error = err;
					thisEntry.status = "errored";
					thisEntry.duration = duration;
					addToHistory();
				},
			},
		);
	}

	function reset(): void {
		statusStore.set("idle");
		toolNameStore.set(undefined);
		argsStore.set(undefined);
		resultStore.set(undefined);
		errorStore.set(undefined);
		durationStore.set(undefined);
		currentEntry = null;
	}

	return {
		status: statusStore,
		toolName: toolNameStore,
		args: argsStore,
		result: resultStore,
		error: errorStore,
		duration: durationStore,
		request,
		execute,
		reset,
		history: historyStore,
	};
}
