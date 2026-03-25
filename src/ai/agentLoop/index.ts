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
import { rawFromAny } from "../../raw/fromAny";
import { rawSubscribe } from "../../raw/subscribe";

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
	let loopDoneCallback: (() => void) | null = null;

	function addHistory(phase: AgentPhase, context: TContext, action?: TAction): void {
		historyStore.update((prev) => [
			...prev,
			{ phase, context, action, iteration: iterationStore.get() },
		]);
	}

	/** Wait for an action to be approved through the gate. Calls onApproved or onError. */
	function waitForApproval(
		action: TAction,
		onApproved: (action: TAction) => void,
		onError: (err: unknown) => void,
	): void {
		if (!gateEnabled || !pendingStore || stopped) {
			onApproved(action);
			return;
		}

		// If gate is open, pass through immediately
		if (isOpenStore!.get()) {
			onApproved(action);
			return;
		}

		// Enqueue and wait
		gateQueue.push(action);
		if (gateQueue.length > maxPending) gateQueue.shift();
		pendingStore.set([...gateQueue]);

		// One-shot callbag source — resolves when approve/reject fires.
		// Teardown guards: emit(v) synchronously triggers the next iteration's
		// waitForApproval (which overwrites emitGate), then complete() fires
		// this producer's teardown. Without the identity check the teardown
		// would null the *new* gate's emitGate.
		const gateSource = producer<TAction>(
			({ emit, complete, error }) => {
				const myEmit = (v: TAction) => {
					emit(v);
					complete();
				};
				const myError = (e: unknown) => {
					error(e);
				};
				emitGate = myEmit;
				errorGate = myError;
				return () => {
					if (emitGate === myEmit) emitGate = null;
					if (errorGate === myError) errorGate = null;
				};
			},
			{ _skipInspect: true },
		);

		rawSubscribe(
			gateSource.source,
			(approvedAction: TAction) => {
				onApproved(approvedAction);
			},
			{
				onEnd: (err?: unknown) => {
					if (err !== undefined) onError(err);
				},
			},
		);
	}

	function dequeueAction(count: number): TAction[] {
		const items = gateQueue.splice(0, count);
		pendingStore?.set([...gateQueue]);
		return items;
	}

	function finishLoop(): void {
		running = false;
		const cb = loopDoneCallback;
		loopDoneCallback = null;
		cb?.();
	}

	function handleError(err: unknown, ctx: TContext): void {
		if (!stopped) {
			errorStore.set(err);
			phaseStore.set("errored");
			addHistory("errored", ctx);
		}
		finishLoop();
	}

	/** Run one iteration of the observe→plan→[gate→]act cycle, then recurse or finish. */
	function runIteration(ctx: TContext, iteration: number, gen: number): void {
		if (stopped || gen !== generation) {
			finishLoop();
			return;
		}

		if (iteration >= maxIterations) {
			phaseStore.set("completed");
			addHistory("completed", ctx);
			finishLoop();
			return;
		}

		const nextIteration = iteration + 1;
		iterationStore.set(nextIteration);

		// Observe
		phaseStore.set("observe");
		addHistory("observe", ctx);
		let observeResult: TContext | Promise<TContext>;
		try {
			observeResult = opts.observe(ctx);
		} catch (err) {
			handleError(err, ctx);
			return;
		}
		rawSubscribe(
			rawFromAny(observeResult),
			(observedCtx: TContext) => {
				contextStore.set(observedCtx);
				if (stopped || gen !== generation) {
					finishLoop();
					return;
				}

				// Plan
				phaseStore.set("plan");
				addHistory("plan", observedCtx);
				let planResult: TAction | Promise<TAction>;
				try {
					planResult = opts.plan(observedCtx);
				} catch (err) {
					handleError(err, observedCtx);
					return;
				}
				rawSubscribe(
					rawFromAny(planResult),
					(action: TAction) => {
						lastActionStore.set(action);
						if (stopped || gen !== generation) {
							finishLoop();
							return;
						}

						const proceedToAct = (finalAction: TAction) => {
							lastActionStore.set(finalAction);
							if (stopped || gen !== generation) {
								finishLoop();
								return;
							}

							// Act
							phaseStore.set("act");
							addHistory("act", observedCtx, finalAction);
							let actResult: TContext | Promise<TContext>;
							try {
								actResult = opts.act(finalAction, observedCtx);
							} catch (err) {
								handleError(err, observedCtx);
								return;
							}
							rawSubscribe(
								rawFromAny(actResult),
								(newCtx: TContext) => {
									contextStore.set(newCtx);
									if (stopped || gen !== generation) {
										finishLoop();
										return;
									}

									// Check continuation
									if (!shouldContinue(newCtx, nextIteration)) {
										phaseStore.set("completed");
										addHistory("completed", newCtx);
										finishLoop();
									} else {
										runIteration(newCtx, nextIteration, gen);
									}
								},
								{
									onEnd: (err?: unknown) => {
										if (err !== undefined) handleError(err, observedCtx);
									},
								},
							);
						};

						// Gate: await approval if enabled
						if (gateEnabled) {
							phaseStore.set("awaiting_approval");
							addHistory("awaiting_approval", observedCtx, action);
							waitForApproval(
								action,
								(approvedAction) => {
									proceedToAct(approvedAction);
								},
								(err) => {
									// reject() fires GateRejected — re-plan on next iteration
									if (err instanceof GateRejected && !stopped) {
										runIteration(observedCtx, nextIteration, gen);
									} else {
										handleError(err, observedCtx);
									}
								},
							);
						} else {
							proceedToAct(action);
						}
					},
					{
						onEnd: (err?: unknown) => {
							if (err !== undefined) handleError(err, observedCtx);
						},
					},
				);
			},
			{
				onEnd: (err?: unknown) => {
					if (err !== undefined) handleError(err, ctx);
				},
			},
		);
	}

	function startLoop(initialContext: TContext, gen: number): void {
		if (gen !== generation) return;

		running = true;
		stopped = false;
		gateQueue = [];
		emitGate = null;
		errorGate = null;
		pendingStore?.set([]);

		contextStore.set(initialContext);
		iterationStore.set(0);
		errorStore.set(undefined);
		lastActionStore.set(undefined);

		runIteration(initialContext, 0, gen);
	}

	function start(initialContext: TContext): void {
		generation++;
		const gen = generation;
		historyStore.set([]);

		if (running) {
			// Stop the current loop and schedule restart.
			// Set loopDoneCallback BEFORE emitGate — the gate callback chain
			// is synchronous and finishLoop() fires inside emitGate().
			stopped = true;
			loopDoneCallback = () => {
				if (gen !== generation) return;
				startLoop(initialContext, gen);
			};
			if (emitGate) {
				emitGate(gateQueue[0] ?? (undefined as unknown as TAction));
			}
		} else {
			startLoop(initialContext, gen);
		}
	}

	function stop(): void {
		stopped = true;
		if (running) {
			phaseStore.set("completed");
		}
		// Unblock any pending gate wait — emit so the callback fires.
		// The value doesn't matter; `if (stopped)` check fires immediately after.
		if (emitGate) {
			emitGate(gateQueue[0] ?? (undefined as unknown as TAction));
		}
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
