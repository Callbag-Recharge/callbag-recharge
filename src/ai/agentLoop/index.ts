// ---------------------------------------------------------------------------
// agentLoop — Observe → Plan → Act reactive agent cycle
// ---------------------------------------------------------------------------
// Reactive pattern for AI agent orchestration. Each iteration cycles through
// observe (gather context), plan (decide action), act (execute). The graph
// rewires per iteration based on agent phase. Supports async phases,
// iteration limits, conditional continuation, and human-in-the-loop gating.
//
// Built on: state (phase tracking), gate (human approval)
//
// Usage:
//   const agent = agentLoop({
//     observe: (ctx) => ({ ...ctx, data: fetchData() }),
//     plan: (ctx) => ({ action: 'summarize', target: ctx.data }),
//     act: (action, ctx) => ({ ...ctx, result: execute(action) }),
//   });
//   agent.start({ query: 'What is TypeScript?' });
//
// With gate:
//   const agent = agentLoop({
//     observe, plan, act,
//     gate: true,
//   });
//   agent.start(ctx);
//   // agent pauses at "awaiting_approval" after plan
//   agent.approve();  // forwards to act
// ---------------------------------------------------------------------------

import { producer } from "../../core/producer";
import { state } from "../../core/state";
import type { Store } from "../../core/types";
import type { GateController, GateOptions } from "../../orchestrate/gate";
import { firstValueFrom } from "../../raw/firstValueFrom";

/** Thrown internally when an action is rejected via gate.reject(). Causes the loop to re-plan. */
class GateRejected extends Error {
	constructor() {
		super("Gate: action rejected");
	}
}

export type AgentPhase =
	| "idle"
	| "observe"
	| "plan"
	| "awaiting_approval"
	| "act"
	| "completed"
	| "errored";

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
	/** Enable human-in-the-loop gating between plan and act. Default: false. */
	gate?: boolean | Omit<GateOptions, "name">;
	/** Debug name for stores. */
	name?: string;
}

/** Base result without gate controls. */
export interface AgentLoopResultBase<TContext, TAction> {
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

/** Result with gate controls (when gate option is enabled). */
export interface GatedAgentLoopResult<TContext, TAction>
	extends AgentLoopResultBase<TContext, TAction>,
		GateController<TAction> {}

/** Result type — includes gate controls only when gate option is set. */
export type AgentLoopResult<TContext, TAction> =
	| AgentLoopResultBase<TContext, TAction>
	| GatedAgentLoopResult<TContext, TAction>;

/**
 * Creates a reactive Observe→Plan→Act agent loop.
 *
 * @param opts - Agent loop configuration with observe, plan, act phases.
 *
 * @returns `AgentLoopResult<TContext, TAction>` — reactive stores for phase, context, lastAction, iteration, error, plus `start()` and `stop()`. When `gate` is enabled, also includes `pending`, `isOpen`, `approve()`, `reject()`, `modify()`, `open()`, `close()`.
 *
 * @remarks **Lifecycle:** idle → observe → plan → [awaiting_approval →] act → (shouldContinue ? observe : completed).
 * @remarks **Async phases:** All three phases (observe, plan, act) can be async.
 * @remarks **Safety limit:** `maxIterations` prevents infinite loops (default: 10).
 * @remarks **History:** Tracks every phase transition with context and action.
 * @remarks **Gate:** When `gate: true`, planned actions are queued for human approval before executing. The loop pauses at `awaiting_approval` until `approve()` or `modify()` is called. Calling `reject()` discards the pending action and re-runs the loop from the next iteration (observe → plan → new approval request). Each rejection counts toward `maxIterations`.
 *
 * @example
 * ```ts
 * import { agentLoop } from 'callbag-recharge/ai/agentLoop';
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
 * @example With human-in-the-loop gate
 * ```ts
 * const agent = agentLoop({
 *   observe: (ctx) => ctx,
 *   plan: (ctx) => ({ tool: 'search', query: ctx.question }),
 *   act: (action, ctx) => ({ ...ctx, result: execute(action) }),
 *   gate: true,
 * });
 *
 * agent.start({ question: 'What is TypeScript?' });
 * // phase goes: observe → plan → awaiting_approval (pauses)
 * agent.pending.get();  // [{ tool: 'search', query: 'What is TypeScript?' }]
 * agent.approve();      // resumes → act → completed
 * ```
 *
 * @seeAlso [gate](/api/gate) — human-in-the-loop operator, [chatStream](/api/chatStream) — LLM streaming
 *
 * @category ai
 */
export function agentLoop<TContext, TAction>(
	opts: AgentLoopOptions<TContext, TAction> & { gate: true | Omit<GateOptions, "name"> },
): GatedAgentLoopResult<TContext, TAction>;
export function agentLoop<TContext, TAction>(
	opts: AgentLoopOptions<TContext, TAction>,
): AgentLoopResultBase<TContext, TAction>;
export function agentLoop<TContext, TAction>(
	opts: AgentLoopOptions<TContext, TAction>,
): AgentLoopResult<TContext, TAction> {
	const name = opts.name ?? "agentLoop";
	const maxIterations = opts.maxIterations ?? 10;
	const shouldContinue = opts.shouldContinue ?? (() => false);
	const gateEnabled = !!opts.gate;

	const phaseStore = state<AgentPhase>("idle", { name: `${name}.phase` });
	const contextStore = state<TContext | undefined>(undefined, { name: `${name}.context` });
	const lastActionStore = state<TAction | undefined>(undefined, { name: `${name}.lastAction` });
	const iterationStore = state<number>(0, { name: `${name}.iteration` });
	const errorStore = state<unknown | undefined>(undefined, { name: `${name}.error` });
	const historyStore = state<AgentLoopEntry<TContext, TAction>[]>([], {
		name: `${name}.history`,
	});

	// Gate queue for human-in-the-loop approval
	const gateOpts = typeof opts.gate === "object" ? opts.gate : {};
	const maxPending = gateOpts.maxPending ?? Infinity;
	const pendingStore = gateEnabled
		? state<TAction[]>([], { name: `${name}.pending`, equals: () => false })
		: undefined;
	const isOpenStore = gateEnabled
		? state<boolean>(gateOpts.startOpen ?? false, { name: `${name}.isOpen` })
		: undefined;

	let gateQueue: TAction[] = [];
	// Callbag-native gate signal: one-shot producer emits when approve/reject fires.
	let emitGate: ((action: TAction) => void) | null = null;
	let errorGate: ((e: unknown) => void) | null = null;

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

	/** Wait for an action to be approved through the gate. */
	function waitForApproval(action: TAction): Promise<TAction> {
		if (!gateEnabled || !pendingStore) return Promise.resolve(action);
		if (stopped) return Promise.resolve(action);

		// If gate is open, pass through immediately
		if (isOpenStore!.get()) return Promise.resolve(action);

		// Enqueue and wait
		gateQueue.push(action);
		if (gateQueue.length > maxPending) gateQueue.shift();
		pendingStore.set([...gateQueue]);

		// One-shot callbag source — resolves when approve/reject fires.
		const gateSource = producer<TAction>(
			({ emit, complete, error }) => {
				emitGate = (v: TAction) => {
					emit(v);
					complete();
				};
				errorGate = (e: unknown) => {
					error(e);
				};
				return () => {
					emitGate = null;
					errorGate = null;
				};
			},
			{ _skipInspect: true },
		);

		return firstValueFrom<TAction>(gateSource.source);
	}

	function dequeueAction(count: number): TAction[] {
		const items = gateQueue.splice(0, count);
		pendingStore?.set([...gateQueue]);
		return items;
	}

	async function runLoop(initialContext: TContext, gen: number): Promise<void> {
		// Wait for previous loop to finish
		if (loopPromise) {
			stopped = true;
			// Unblock any pending gate wait so loopPromise can settle
			if (emitGate) {
				emitGate(gateQueue[0] ?? (undefined as unknown as TAction));
			}
			await loopPromise;
		}
		// Check if superseded by a newer start() call
		if (gen !== generation) return;

		running = true;
		stopped = false;
		gateQueue = [];
		emitGate = null;
		errorGate = null;
		pendingStore?.set([]);

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
				let action = await opts.plan(ctx);
				lastActionStore.set(action);
				if (stopped) break;

				// Gate: await approval if enabled
				if (gateEnabled) {
					phaseStore.set("awaiting_approval");
					addHistory("awaiting_approval", ctx, action);
					try {
						action = await waitForApproval(action);
					} catch (e) {
						// reject() fires GateRejected — re-plan on next iteration
						if (e instanceof GateRejected && !stopped) continue;
						throw e;
					}
					lastActionStore.set(action); // may have been modified
					if (stopped) break;
				}

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
		// Unblock any pending gate wait — emit so the await settles.
		// The value doesn't matter; `if (stopped) break` fires immediately after.
		if (emitGate) {
			emitGate(gateQueue[0] ?? (undefined as unknown as TAction));
		}
		if (!running) return;
		phaseStore.set("completed");
	}

	const base: AgentLoopResultBase<TContext, TAction> = {
		phase: phaseStore,
		context: contextStore,
		lastAction: lastActionStore,
		iteration: iterationStore,
		error: errorStore,
		start,
		stop,
		history: historyStore,
	};

	if (!gateEnabled) return base;

	// Gate controls
	const gated = base as GatedAgentLoopResult<TContext, TAction>;
	gated.pending = pendingStore!;
	gated.isOpen = isOpenStore!;

	gated.approve = (_count = 1) => {
		// agentLoop processes one action per iteration — clamp to 1
		const items = dequeueAction(1);
		if (items.length > 0 && emitGate) {
			emitGate(items[0]);
		}
	};

	gated.reject = (_count = 1) => {
		dequeueAction(1);
		// Unblock the waiting source so the loop can re-observe and re-plan
		if (errorGate) {
			errorGate(new GateRejected());
		}
	};

	gated.modify = (fn: (value: TAction) => TAction) => {
		const items = dequeueAction(1);
		if (items.length > 0 && emitGate) {
			emitGate(fn(items[0]));
		}
	};

	gated.open = () => {
		isOpenStore!.set(true);
		// Flush all pending — resolve with the first (only one in-flight at a time)
		const items = dequeueAction(gateQueue.length);
		if (items.length > 0 && emitGate) {
			emitGate(items[0]);
		}
	};

	gated.close = () => {
		isOpenStore!.set(false);
	};

	return gated;
}
