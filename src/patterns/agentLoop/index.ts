// ---------------------------------------------------------------------------
// agentLoop — Observe → Plan → Act reactive agent cycle
// ---------------------------------------------------------------------------
// Reactive pattern for AI agent orchestration. Each iteration cycles through
// observe (gather context), plan (decide action), act (execute). The graph
// rewires per iteration based on agent phase. Supports async phases,
// iteration limits, and conditional continuation.
//
// Built on: state (phase tracking), Inspector.annotate (reasoning trace)
//
// Usage:
//   const agent = agentLoop({
//     observe: (ctx) => ({ ...ctx, data: fetchData() }),
//     plan: (ctx) => ({ action: 'summarize', target: ctx.data }),
//     act: (action, ctx) => ({ ...ctx, result: execute(action) }),
//   });
//   agent.start({ query: 'What is TypeScript?' });
// ---------------------------------------------------------------------------

import { state } from "../../core/state";
import type { Store } from "../../core/types";

export type AgentPhase = "idle" | "observe" | "plan" | "act" | "completed" | "errored";

export interface AgentLoopEntry<TContext, TAction> {
	phase: AgentPhase;
	context: TContext;
	action?: TAction;
	iteration: number;
}

export interface AgentLoopOptions<TContext, TAction> {
	/** Observe phase: gather/enrich context. */
	observe: (ctx: TContext) => TContext | Promise<TContext>;
	/** Plan phase: decide on an action given the context. */
	plan: (ctx: TContext) => TAction | Promise<TAction>;
	/** Act phase: execute the action, return updated context. */
	act: (action: TAction, ctx: TContext) => TContext | Promise<TContext>;
	/** Whether to continue after an act phase. Default: () => false (single iteration). */
	shouldContinue?: (ctx: TContext, iteration: number) => boolean;
	/** Maximum iterations (safety limit). Default: 10. */
	maxIterations?: number;
	/** Debug name for stores. */
	name?: string;
}

export interface AgentLoopResult<TContext, TAction> {
	/** Current agent phase. */
	phase: Store<AgentPhase>;
	/** Current context. */
	context: Store<TContext | undefined>;
	/** Last planned action. */
	lastAction: Store<TAction | undefined>;
	/** Current iteration count. */
	iteration: Store<number>;
	/** Last error, if any. */
	error: Store<unknown | undefined>;
	/** Start the agent loop with initial context. */
	start: (initialContext: TContext) => void;
	/** Stop the agent loop (sets phase to 'completed'). */
	stop: () => void;
	/** History of all phase transitions. */
	history: Store<AgentLoopEntry<TContext, TAction>[]>;
}

/**
 * Creates a reactive Observe→Plan→Act agent loop.
 *
 * @param opts - Agent loop configuration with observe, plan, act phases.
 *
 * @returns `AgentLoopResult<TContext, TAction>` — reactive stores for phase, context, lastAction, iteration, error, plus `start()` and `stop()`.
 *
 * @remarks **Lifecycle:** idle → observe → plan → act → (shouldContinue ? observe : completed).
 * @remarks **Async phases:** All three phases (observe, plan, act) can be async.
 * @remarks **Safety limit:** `maxIterations` prevents infinite loops (default: 10).
 * @remarks **History:** Tracks every phase transition with context and action.
 *
 * @example
 * ```ts
 * import { agentLoop } from 'callbag-recharge/patterns/agentLoop';
 *
 * const agent = agentLoop({
 *   observe: (ctx) => ({ ...ctx, data: 'observed' }),
 *   plan: (ctx) => ({ type: 'summarize', input: ctx.data }),
 *   act: (action, ctx) => ({ ...ctx, result: `done: ${action.input}` }),
 * });
 *
 * agent.start({ query: 'test' });
 * // agent.phase.get() cycles: 'observe' → 'plan' → 'act' → 'completed'
 * // agent.context.get() → { query: 'test', data: 'observed', result: 'done: observed' }
 * ```
 *
 * @seeAlso [toolCallState](/api/toolCallState) — tool call lifecycle, [chatStream](/api/chatStream) — LLM streaming
 *
 * @category patterns
 */
export function agentLoop<TContext, TAction>(
	opts: AgentLoopOptions<TContext, TAction>,
): AgentLoopResult<TContext, TAction> {
	const name = opts.name ?? "agentLoop";
	const maxIterations = opts.maxIterations ?? 10;
	const shouldContinue = opts.shouldContinue ?? (() => false);

	const phaseStore = state<AgentPhase>("idle", { name: `${name}.phase` });
	const contextStore = state<TContext | undefined>(undefined, { name: `${name}.context` });
	const lastActionStore = state<TAction | undefined>(undefined, { name: `${name}.lastAction` });
	const iterationStore = state<number>(0, { name: `${name}.iteration` });
	const errorStore = state<unknown | undefined>(undefined, { name: `${name}.error` });
	const historyStore = state<AgentLoopEntry<TContext, TAction>[]>([], {
		name: `${name}.history`,
	});

	let stopped = false;
	let running = false;
	let generation = 0;
	let loopPromise: Promise<void> | null = null;

	function addHistory(phase: AgentPhase, context: TContext, action?: TAction): void {
		historyStore.update((prev) => [
			...prev,
			{ phase, context, action, iteration: iterationStore.get() },
		]);
	}

	async function runLoop(initialContext: TContext, gen: number): Promise<void> {
		// Wait for previous loop to finish
		if (loopPromise) {
			stopped = true;
			await loopPromise;
		}
		// Check if superseded by a newer start() call
		if (gen !== generation) return;

		running = true;
		stopped = false;

		let ctx = initialContext;
		let iteration = 0;
		contextStore.set(ctx);
		iterationStore.set(0);
		errorStore.set(undefined);
		lastActionStore.set(undefined);

		try {
			for (;;) {
				if (stopped) break;

				if (iteration >= maxIterations) {
					phaseStore.set("completed");
					addHistory("completed", ctx);
					break;
				}

				iteration++;
				iterationStore.set(iteration);

				// Observe
				phaseStore.set("observe");
				addHistory("observe", ctx);
				ctx = await opts.observe(ctx);
				contextStore.set(ctx);
				if (stopped) break;

				// Plan
				phaseStore.set("plan");
				addHistory("plan", ctx);
				const action = await opts.plan(ctx);
				lastActionStore.set(action);
				if (stopped) break;

				// Act
				phaseStore.set("act");
				addHistory("act", ctx, action);
				ctx = await opts.act(action, ctx);
				contextStore.set(ctx);
				if (stopped) break;

				// Check continuation
				if (!shouldContinue(ctx, iteration)) {
					phaseStore.set("completed");
					addHistory("completed", ctx);
					break;
				}
			}
		} catch (err) {
			if (!stopped) {
				errorStore.set(err);
				phaseStore.set("errored");
				addHistory("errored", ctx);
			}
		} finally {
			running = false;
		}
	}

	function start(initialContext: TContext): void {
		generation++;
		const gen = generation;
		historyStore.set([]);
		loopPromise = runLoop(initialContext, gen).catch(() => {});
	}

	function stop(): void {
		stopped = true;
		if (!running) return;
		phaseStore.set("completed");
	}

	return {
		phase: phaseStore,
		context: contextStore,
		lastAction: lastActionStore,
		iteration: iterationStore,
		error: errorStore,
		start,
		stop,
		history: historyStore,
	};
}
