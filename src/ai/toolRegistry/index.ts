// ---------------------------------------------------------------------------
// toolRegistry — reactive tool dispatch with optional job queue backing
// ---------------------------------------------------------------------------
// Maps tool names → handlers. Each tool can run inline (direct execution)
// or through a jobQueue (durable, retryable, with stall detection).
// Dispatches single or parallel tool calls, collects results reactively.
//
// Built on: producer (callbag source for execute), jobQueue (durable mode),
//           rawFromAny + rawSubscribe (inline execution), state (stores)
//
// Usage:
//   const registry = toolRegistry({
//     tools: {
//       search: {
//         description: "Search the web",
//         parameters: { type: "object", properties: { query: { type: "string" } } },
//         handler: (signal, args) => searchAPI(args.query),
//       },
//       code: {
//         description: "Run code in sandbox",
//         handler: (signal, args) => execCode(args.code),
//         queue: { concurrency: 2, retry: { maxRetries: 3 } },
//       },
//     },
//   });
//
//   // Fire-and-forget single dispatch
//   registry.dispatch("search", { query: "weather" });
//
//   // Batch execute — returns callbag source, works in agentLoop act phase
//   const agent = agentLoop({
//     act: (action, ctx) => registry.execute(action.toolCalls, ctx),
//   });
// ---------------------------------------------------------------------------

import { producer } from "../../core/producer";
import { batch, teardown } from "../../core/protocol";
import { state } from "../../core/state";
import type { Store } from "../../core/types";
import { jobQueue } from "../../messaging/jobQueue";
import type { JobQueue, JobQueueOptions, Topic } from "../../messaging/types";
import { rawFromAny } from "../../raw/fromAny";
import { fromTimer } from "../../raw/fromTimer";
import type { CallbagSource } from "../../raw/subscribe";
import { rawSubscribe } from "../../raw/subscribe";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schema for runtime validation of tool arguments. Compatible with Zod/Valibot/ArkType. */
export interface ToolSchema<T = unknown> {
	parse(value: unknown): T;
}

/** Definition of a single tool in the registry. */
export interface ToolDefinition<TArgs = any, TResult = any> {
	/** Human-readable description (passed to LLM for function calling). */
	description: string;
	/** JSON Schema for the tool's parameters (passed to LLM for function calling). */
	parameters?: Record<string, unknown>;
	/** Runtime schema validation for args. Compatible with Zod/Valibot/ArkType. */
	schema?: ToolSchema<TArgs>;
	/**
	 * Tool handler. Signal-first per project conventions.
	 * Signal is aborted on timeout or when the registry is destroyed.
	 */
	handler: (signal: AbortSignal, args: TArgs) => TResult | Promise<TResult>;
	/**
	 * If set, tool calls are routed through a jobQueue for durable execution
	 * with retry, stall detection, and dead-letter support.
	 * If omitted, handler runs inline (direct execution).
	 */
	queue?: Pick<
		JobQueueOptions<any>,
		"concurrency" | "ackTimeout" | "stallInterval" | "stalledJobAction" | "retry" | "topicOptions"
	>;
	/** Per-call timeout in ms. 0 = no timeout (default). */
	timeout?: number;
}

/** A request to call a tool. Matches LLM tool_calls structure. */
export interface ToolCallRequest {
	/** Call ID from the LLM (for matching responses). */
	id?: string;
	/** Tool name (must exist in registry). */
	tool: string;
	/** Arguments to pass to the tool handler. */
	args: unknown;
}

/** Result of a single tool call. */
export interface ToolResult {
	/** Call ID (mirrors the request). */
	id?: string;
	/** Tool name. */
	tool: string;
	/** Arguments that were passed. */
	args: unknown;
	/** Result value (if completed). */
	result?: unknown;
	/** Error (if errored). */
	error?: unknown;
	/** Final status. */
	status: "completed" | "errored";
	/** Execution duration in ms. */
	duration: number;
}

/** Options for creating a tool registry. */
export interface ToolRegistryOptions {
	/** Named tool definitions. */
	tools: Record<string, ToolDefinition>;
	/** Debug name for stores. */
	name?: string;
	/** Max history entries. Default: 200. */
	maxHistory?: number;
	/** Shared dead-letter topic for queued tools. */
	deadLetterTopic?: Topic<unknown>;
}

/** Result of creating a tool registry. */
export interface ToolRegistryResult {
	/**
	 * Fire-and-forget single tool dispatch. Updates reactive stores.
	 * For collecting results, use `execute()` instead.
	 */
	dispatch: (tool: string, args: unknown, id?: string) => void;

	/**
	 * Execute one or more tool calls in parallel. Returns a callbag source
	 * that emits `ToolResult[]` once when ALL calls complete (or error).
	 *
	 * Compatible with `agentLoop` act phase — `rawFromAny` in agentLoop
	 * passes callbag sources through.
	 *
	 * @example
	 * ```ts
	 * // In agentLoop act phase:
	 * act: (action, ctx) => registry.execute(action.toolCalls, ctx)
	 * ```
	 */
	execute: <TCtx = undefined>(calls: ToolCallRequest[], ctx?: TCtx) => CallbagSource;

	/** Reactive count of currently executing tool calls. */
	active: Store<number>;
	/** Reactive history of all completed/errored tool calls. */
	history: Store<ToolResult[]>;
	/** Reactive results from the last `execute()` batch. */
	lastResults: Store<ToolResult[]>;

	/**
	 * Tool definitions formatted for LLM function calling.
	 * Returns the OpenAI-compatible `tools` array shape.
	 */
	definitions: () => Array<{
		type: "function";
		function: { name: string; description: string; parameters?: Record<string, unknown> };
	}>;

	/** Whether a tool name exists in the registry. */
	has: (tool: string) => boolean;

	/** Destroy all internal job queues and stores. */
	destroy: () => void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a reactive tool registry for LLM tool call dispatch.
 *
 * Each tool can run inline (direct handler execution) or through a `jobQueue`
 * for durable processing with retry, stall detection, and dead-letter routing.
 * Parallel execution collects results into a callbag source compatible with
 * `agentLoop`'s act phase.
 *
 * @param opts - Registry configuration with tool definitions.
 *
 * @returns `ToolRegistryResult` — reactive stores, dispatch/execute methods, LLM-compatible definitions, lifecycle.
 *
 * @remarks **Signal-first:** Tool handlers receive `(signal, args)` — signal is aborted on timeout or destroy.
 * @remarks **Callbag-native:** `execute()` returns a callbag source (no Promises). Works directly in `agentLoop` act phase.
 * @remarks **Dual mode:** Tools without `queue` option run inline. Tools with `queue` get full jobQueue semantics (retry, stall detection, DLQ).
 * @remarks **Parallel:** `execute()` dispatches all calls concurrently and emits when all settle.
 *
 * @example
 * ```ts
 * import { toolRegistry } from 'callbag-recharge/ai/toolRegistry';
 * import { agentLoop } from 'callbag-recharge/ai/agentLoop';
 *
 * const registry = toolRegistry({
 *   tools: {
 *     search: {
 *       description: "Search the web for information",
 *       parameters: {
 *         type: "object",
 *         properties: { query: { type: "string" } },
 *         required: ["query"],
 *       },
 *       handler: (signal, args) => fetch(`/api/search?q=${args.query}`, { signal }).then(r => r.json()),
 *     },
 *     calculate: {
 *       description: "Evaluate a math expression",
 *       handler: (_signal, args) => eval(args.expr),
 *       queue: { concurrency: 1, retry: { maxRetries: 2 } },
 *     },
 *   },
 * });
 *
 * // Pass definitions to LLM
 * llm.generate(messages, { tools: registry.definitions() });
 *
 * // Execute tool calls from LLM response
 * const agent = agentLoop({
 *   plan: (ctx) => parseLLMToolCalls(ctx.response),
 *   act: (toolCalls, ctx) => registry.execute(toolCalls, ctx),
 * });
 * ```
 *
 * @example With job queue for durable execution
 * ```ts
 * const registry = toolRegistry({
 *   tools: {
 *     deploy: {
 *       description: "Deploy to production",
 *       handler: (signal, args) => deployService(signal, args.service),
 *       queue: {
 *         concurrency: 1,
 *         ackTimeout: 60_000,
 *         stalledJobAction: "retry",
 *         retry: { maxRetries: 3 },
 *       },
 *       timeout: 120_000,
 *     },
 *   },
 * });
 * ```
 *
 * @seeAlso [toolCallState](/api/toolCallState) — single tool lifecycle, [jobQueue](/api/jobQueue) — durable job processing, [agentLoop](/api/agentLoop) — agent orchestration
 *
 * @category ai
 */
export function toolRegistry(opts: ToolRegistryOptions): ToolRegistryResult {
	const name = opts.name ?? "toolRegistry";
	const maxHistory = opts.maxHistory ?? 200;
	const toolDefs = opts.tools;

	let _destroyed = false;
	const _registryAbort = new AbortController();

	// --- Companion stores ---
	const _activeStore = state<number>(0, { name: `${name}.active` });
	const _historyStore = state<ToolResult[]>([], { name: `${name}.history` });
	const _lastResultsStore = state<ToolResult[]>([], { name: `${name}.lastResults` });

	// --- Job queues (created lazily for tools with queue option) ---
	const _queues = new Map<string, JobQueue<{ args: unknown; callId?: string }, unknown>>();

	for (const [toolName, def] of Object.entries(toolDefs)) {
		if (def.queue) {
			const queueOpts: JobQueueOptions<{ args: unknown; callId?: string }> = {
				...def.queue,
			};
			if (opts.deadLetterTopic) {
				queueOpts.deadLetterTopic = opts.deadLetterTopic as Topic<{
					args: unknown;
					callId?: string;
				}>;
			}
			const q = jobQueue<{ args: unknown; callId?: string }, unknown>(
				`${name}:${toolName}`,
				(signal, data) => def.handler(signal, data.args),
				queueOpts,
			);
			_queues.set(toolName, q);
		}
	}

	// --- Helpers ---

	function _addToHistory(result: ToolResult): void {
		_historyStore.update((prev) => {
			const next = [...prev, result];
			return next.length > maxHistory ? next.slice(-maxHistory) : next;
		});
	}

	function _createCallAbort(timeout?: number): { signal: AbortSignal; cleanup: () => void } {
		const ac = new AbortController();

		// Chain to registry-level abort
		const onRegistryAbort = () => ac.abort();
		_registryAbort.signal.addEventListener("abort", onRegistryAbort, { once: true });

		let timerUnsub: (() => void) | undefined;

		if (timeout && timeout > 0) {
			// Timeout via fromTimer (callbag-native, no setTimeout)
			const timerSub = rawSubscribe(
				fromTimer(timeout, ac.signal),
				() => {
					if (!ac.signal.aborted) ac.abort();
				},
				{
					onEnd: () => {
						// Timer aborted or completed — no-op
					},
				},
			);
			timerUnsub = () => timerSub.unsubscribe();
		}

		return {
			signal: ac.signal,
			cleanup: () => {
				_registryAbort.signal.removeEventListener("abort", onRegistryAbort);
				timerUnsub?.();
			},
		};
	}

	/**
	 * Run a single tool call. Calls onDone when complete.
	 * Handles both inline and queue modes.
	 */
	function _runOne(req: ToolCallRequest, onDone: (result: ToolResult) => void): void {
		const def = toolDefs[req.tool];
		if (!def) {
			const result: ToolResult = {
				id: req.id,
				tool: req.tool,
				args: req.args,
				error: new Error(`Unknown tool: ${req.tool}`),
				status: "errored",
				duration: 0,
			};
			_addToHistory(result);
			onDone(result);
			return;
		}

		// Validate args if schema is provided
		let validatedArgs = req.args;
		if (def.schema) {
			try {
				validatedArgs = def.schema.parse(req.args);
			} catch (err) {
				const result: ToolResult = {
					id: req.id,
					tool: req.tool,
					args: req.args,
					error: err,
					status: "errored",
					duration: 0,
				};
				_addToHistory(result);
				onDone(result);
				return;
			}
		}

		_activeStore.update((v) => v + 1);
		const startTime = Date.now();

		const queue = _queues.get(req.tool);

		if (queue) {
			// --- Queue mode: route through jobQueue ---
			const seq = queue.add({ args: validatedArgs, callId: req.id });

			// Listen for this specific job's completion/failure
			const offCompleted = queue.on("completed", (job) => {
				if (job.seq !== seq) return;
				cleanup();
				const result: ToolResult = {
					id: req.id,
					tool: req.tool,
					args: req.args,
					result: job.result,
					status: "completed",
					duration: Date.now() - startTime,
				};
				_activeStore.update((v) => Math.max(0, v - 1));
				_addToHistory(result);
				onDone(result);
			});

			const offFailed = queue.on("failed", (job) => {
				if (job.seq !== seq) return;
				cleanup();
				const result: ToolResult = {
					id: req.id,
					tool: req.tool,
					args: req.args,
					error: job.error,
					status: "errored",
					duration: Date.now() - startTime,
				};
				_activeStore.update((v) => Math.max(0, v - 1));
				_addToHistory(result);
				onDone(result);
			});

			const cleanup = () => {
				offCompleted();
				offFailed();
			};
		} else {
			// --- Inline mode: direct execution ---
			const { signal, cleanup } = _createCallAbort(def.timeout);

			let handlerResult: unknown;
			try {
				handlerResult = def.handler(signal, validatedArgs);
			} catch (err) {
				cleanup();
				const result: ToolResult = {
					id: req.id,
					tool: req.tool,
					args: req.args,
					error: err,
					status: "errored",
					duration: Date.now() - startTime,
				};
				_activeStore.update((v) => Math.max(0, v - 1));
				_addToHistory(result);
				onDone(result);
				return;
			}

			rawSubscribe(
				rawFromAny(handlerResult),
				(value: unknown) => {
					cleanup();
					const duration = Date.now() - startTime;
					const result: ToolResult = {
						id: req.id,
						tool: req.tool,
						args: req.args,
						result: value,
						status: "completed",
						duration,
					};
					_activeStore.update((v) => Math.max(0, v - 1));
					_addToHistory(result);
					onDone(result);
				},
				{
					onEnd: (err?: unknown) => {
						if (err === undefined) return; // success handled above
						cleanup();
						const duration = Date.now() - startTime;
						const result: ToolResult = {
							id: req.id,
							tool: req.tool,
							args: req.args,
							error: err,
							status: "errored",
							duration,
						};
						_activeStore.update((v) => Math.max(0, v - 1));
						_addToHistory(result);
						onDone(result);
					},
				},
			);
		}
	}

	// --- Public API ---

	function dispatch(tool: string, args: unknown, id?: string): void {
		if (_destroyed) return;
		_runOne({ id, tool, args }, () => {});
	}

	function execute<TCtx = undefined>(calls: ToolCallRequest[], ctx?: TCtx): CallbagSource {
		if (calls.length === 0) {
			// Empty calls — emit result immediately via one-shot producer.
			// Cannot use rawFromAny([]) because it iterates the empty array (zero emissions).
			const emptyResult = ctx !== undefined ? ctx : [];
			return producer<unknown>(
				({ emit, complete }) => {
					emit(emptyResult);
					complete();
					return undefined;
				},
				{ _skipInspect: true },
			).source;
		}

		// One-shot producer: dispatches all calls in parallel,
		// collects results, emits once when all settle.
		return producer<TCtx extends undefined ? ToolResult[] : TCtx>(
			({ emit, complete }) => {
				if (_destroyed) {
					emit((ctx !== undefined ? ctx : []) as TCtx extends undefined ? ToolResult[] : TCtx);
					complete();
					return;
				}

				const results: ToolResult[] = [];
				let remaining = calls.length;

				for (const call of calls) {
					_runOne(call, (result) => {
						results.push(result);
						remaining--;

						if (remaining === 0) {
							batch(() => {
								_lastResultsStore.set(results);
							});

							// If ctx provided, emit ctx (enriched by caller via
							// reactive stores). Otherwise emit results array.
							emit(
								(ctx !== undefined ? ctx : results) as TCtx extends undefined ? ToolResult[] : TCtx,
							);
							complete();
						}
					});
				}

				return undefined;
			},
			{ _skipInspect: true },
		).source;
	}

	function definitions(): Array<{
		type: "function";
		function: {
			name: string;
			description: string;
			parameters?: Record<string, unknown>;
		};
	}> {
		return Object.entries(toolDefs).map(([toolName, def]) => ({
			type: "function" as const,
			function: {
				name: toolName,
				description: def.description,
				...(def.parameters ? { parameters: def.parameters } : {}),
			},
		}));
	}

	function has(tool: string): boolean {
		return tool in toolDefs;
	}

	function destroy(): void {
		if (_destroyed) return;
		_destroyed = true;
		_registryAbort.abort();

		for (const q of _queues.values()) {
			q.destroy();
		}
		_queues.clear();

		batch(() => {
			teardown(_activeStore);
			teardown(_historyStore);
			teardown(_lastResultsStore);
		});
	}

	return {
		dispatch,
		execute,
		active: _activeStore as Store<number>,
		history: _historyStore as Store<ToolResult[]>,
		lastResults: _lastResultsStore as Store<ToolResult[]>,
		definitions,
		has,
		destroy,
	};
}
