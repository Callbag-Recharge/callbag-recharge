// ---------------------------------------------------------------------------
// State Machine — finite state machine with typed transitions + reactive state
// ---------------------------------------------------------------------------
// Pure state machine logic with reactive stores for current state and context.
// Supports onEnter/onExit hooks and typed event-driven transitions.
//
// - current: Store<TState> — reactive current state name
// - context: Store<TContext> — reactive context data
// - send(event) — trigger a transition, returns true if accepted
// - matches(state) — check if machine is in given state
// - reset() — return to initial state and context
// ---------------------------------------------------------------------------

import { state } from "../core/state";
import type { Store } from "../core/types";

export interface StateMachineConfig<TContext, TState extends string, TEvent extends string> {
	/** Initial state name. */
	initial: TState;
	/** State definitions with optional onEnter/onExit. */
	states: Record<
		TState,
		{
			onEnter?: (ctx: TContext) => TContext | undefined;
			onExit?: (ctx: TContext) => TContext | undefined;
		}
	>;
	/** Transition handlers: return new context, or false to reject. */
	on: Partial<
		Record<
			TEvent,
			(
				ctx: TContext,
				current: TState,
				payload?: any,
			) => { state: TState; context?: TContext } | false
		>
	>;
}

export interface StateMachineResult<TContext, TState extends string, TEvent extends string> {
	/** Current state name. */
	current: Store<TState>;
	/** Current context data. */
	context: Store<TContext>;
	/** Send an event to trigger a transition. Returns true if transition happened. */
	send: (event: TEvent, payload?: any) => boolean;
	/** Check if machine is in given state. */
	matches: (s: TState) => boolean;
	/** Reset to initial state and context. */
	reset: () => void;
}

/**
 * Creates a finite state machine with reactive state and context stores.
 *
 * @param initialContext - Initial context data.
 * @param config - State machine configuration (initial state, states, transitions).
 *
 * @returns `StateMachineResult` — `current`, `context`, `send`, `matches`, `reset`.
 *
 * @example
 * ```ts
 * import { stateMachine } from 'callbag-recharge/utils';
 *
 * const machine = stateMachine({ text: '', cursor: 0 }, {
 *   initial: 'idle',
 *   states: { idle: {}, editing: {}, saving: {} },
 *   on: {
 *     EDIT: (ctx) => ({ state: 'editing', context: ctx }),
 *     SAVE: (ctx, current) => current === 'editing'
 *       ? { state: 'saving' }
 *       : false,
 *     DONE: () => ({ state: 'idle' }),
 *   },
 * });
 *
 * machine.current.get(); // 'idle'
 * machine.send('EDIT');  // true
 * machine.current.get(); // 'editing'
 * ```
 *
 * @category utils
 */
export function stateMachine<TContext, TState extends string, TEvent extends string>(
	initialContext: TContext,
	config: StateMachineConfig<TContext, TState, TEvent>,
): StateMachineResult<TContext, TState, TEvent> {
	const currentStore = state<TState>(config.initial);

	// Run onEnter for initial state at construction
	let startCtx = initialContext;
	const initialStateDef = config.states[config.initial];
	if (initialStateDef?.onEnter) {
		const enterResult = initialStateDef.onEnter(startCtx);
		if (enterResult !== undefined) startCtx = enterResult;
	}
	const contextStore = state<TContext>(startCtx);

	function send(event: TEvent, payload?: any): boolean {
		const handler = config.on[event];
		if (!handler) return false;

		const currentState = currentStore.get();
		const ctx = contextStore.get();
		const result = handler(ctx, currentState, payload);

		if (result === false) return false;

		// Run onExit for current state
		const currentStateDef = config.states[currentState];
		let updatedCtx = result.context !== undefined ? result.context : ctx;
		if (currentStateDef?.onExit) {
			const exitResult = currentStateDef.onExit(updatedCtx);
			if (exitResult !== undefined) {
				updatedCtx = exitResult;
			}
		}

		// Run onEnter for new state
		const newStateDef = config.states[result.state];
		if (newStateDef?.onEnter) {
			const enterResult = newStateDef.onEnter(updatedCtx);
			if (enterResult !== undefined) {
				updatedCtx = enterResult;
			}
		}

		// Update stores
		currentStore.set(result.state);
		contextStore.set(updatedCtx);

		return true;
	}

	function matches(s: TState): boolean {
		return currentStore.get() === s;
	}

	function reset(): void {
		const currentState = currentStore.get();
		const ctx = contextStore.get();

		// Run onExit for current state — honor return value for consistency with send()
		const currentStateDef = config.states[currentState];
		let updatedCtx = initialContext;
		if (currentStateDef?.onExit) {
			const exitResult = currentStateDef.onExit(ctx);
			// onExit can influence the context passed to onEnter, but reset
			// always resets to initialContext as the baseline
			if (exitResult !== undefined) updatedCtx = exitResult;
			else updatedCtx = initialContext;
		}

		currentStore.set(config.initial);

		// Run onEnter for initial state
		const initialStateDef = config.states[config.initial];
		if (initialStateDef?.onEnter) {
			const enterResult = initialStateDef.onEnter(updatedCtx);
			contextStore.set(enterResult !== undefined ? enterResult : updatedCtx);
		} else {
			contextStore.set(updatedCtx);
		}
	}

	return {
		current: currentStore,
		context: contextStore,
		send,
		matches,
		reset,
	};
}
