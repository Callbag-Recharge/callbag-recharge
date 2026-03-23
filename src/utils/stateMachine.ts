// ---------------------------------------------------------------------------
// State Machine — finite state machine with typed transitions + reactive state
// ---------------------------------------------------------------------------
// Declarative state machine with state-centric transitions. Each state declares
// which events it handles and where they lead. Enables toMermaid()/toD2() for
// graph visualization.
//
// - current: Store<TState> — reactive current state name
// - context: Store<TContext> — reactive context data
// - send(event, payload?) — trigger a transition, returns true if accepted
// - matches(state) — check if machine is in given state
// - reset() — return to initial state and context
// - transitions — extracted graph edges
// - toMermaid() / toD2() — diagram serializers
// ---------------------------------------------------------------------------

import { state } from "../core/state";
import type { Store } from "../core/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single transition: target state with optional guard and action. */
export interface TransitionDef<TContext, TState extends string> {
	/** Target state. */
	to: TState;
	/** Guard: return false to reject the transition. */
	guard?: (ctx: TContext, payload?: any) => boolean;
	/** Action: run on transition, return updated context (or void to keep current). */
	action?: (ctx: TContext, payload?: any) => TContext | undefined;
}

/** A transition can be a full def, just a target state string, or an array of guarded alternatives. */
export type Transition<TContext, TState extends string> =
	| TState
	| TransitionDef<TContext, TState>
	| Array<TransitionDef<TContext, TState>>;

/** State node: onEnter/onExit hooks + event→transition map. */
export interface StateNode<TContext, TState extends string, TEvent extends string> {
	/** Called when entering this state. Return updated context or void. */
	onEnter?: (ctx: TContext) => TContext | undefined;
	/** Called when exiting this state. Return updated context or void. */
	onExit?: (ctx: TContext) => TContext | undefined;
	/** Event handlers: event name → transition definition. */
	on?: Partial<Record<TEvent, Transition<TContext, TState>>>;
}

/** State machine configuration. */
export interface StateMachineConfig<TContext, TState extends string, TEvent extends string> {
	/** Initial state name. */
	initial: TState;
	/** State definitions with transitions. */
	states: Record<TState, StateNode<TContext, TState, TEvent>>;
}

/** An extracted graph edge for visualization. */
export interface TransitionEdge<TState extends string, TEvent extends string> {
	from: TState;
	event: TEvent;
	to: TState;
	guarded: boolean;
}

export interface MermaidOpts {
	/** Flowchart direction. Default: "LR". */
	direction?: "TD" | "LR" | "BT" | "RL";
}

export interface D2Opts {
	/** Diagram direction. Default: "right". */
	direction?: "right" | "down" | "left" | "up";
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
	/** Extracted transition graph edges (for visualization). Read-only. */
	transitions: readonly TransitionEdge<TState, TEvent>[];
	/** Serialize the state graph to Mermaid flowchart syntax. */
	toMermaid: (opts?: MermaidOpts) => string;
	/** Serialize the state graph to D2 diagram syntax. */
	toD2: (opts?: D2Opts) => string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a Transition<> to an array of TransitionDef<>. */
function normalizeDefs<TContext, TState extends string>(
	t: Transition<TContext, TState>,
): TransitionDef<TContext, TState>[] {
	if (typeof t === "string") return [{ to: t }];
	if (Array.isArray(t)) return t;
	return [t];
}

/** Apply onExit/onEnter hooks and return updated context. */
function applyHooks<TContext, TState extends string, TEvent extends string>(
	config: StateMachineConfig<TContext, TState, TEvent>,
	fromState: TState,
	toState: TState,
	ctx: TContext,
): TContext {
	let updated = ctx;

	// onExit
	const fromDef = config.states[fromState];
	if (fromDef?.onExit) {
		const r = fromDef.onExit(updated);
		if (r !== undefined) updated = r;
	}

	// onEnter
	const toDef = config.states[toState];
	if (toDef?.onEnter) {
		const r = toDef.onEnter(updated);
		if (r !== undefined) updated = r;
	}

	return updated;
}

/** Extract all transition edges from config for visualization. */
function extractEdges<TContext, TState extends string, TEvent extends string>(
	config: StateMachineConfig<TContext, TState, TEvent>,
): TransitionEdge<TState, TEvent>[] {
	const edges: TransitionEdge<TState, TEvent>[] = [];
	for (const [stateName, node] of Object.entries(config.states) as [
		TState,
		StateNode<TContext, TState, TEvent>,
	][]) {
		if (!node.on) continue;
		for (const [eventName, transition] of Object.entries(node.on) as [
			TEvent,
			Transition<TContext, TState>,
		][]) {
			if (transition === undefined) continue;
			for (const def of normalizeDefs(transition)) {
				edges.push({
					from: stateName,
					event: eventName,
					to: def.to,
					guarded: !!def.guard,
				});
			}
		}
	}
	return edges;
}

/** Sanitize a name for diagram node IDs. */
function sanitizeId(name: string): string {
	return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a finite state machine with reactive state, context stores, and diagram export.
 *
 * Transitions are declared per-state, making the graph intrinsic to the config.
 * Each state defines which events it handles and where they lead.
 *
 * @param initialContext - Initial context data.
 * @param config - State machine configuration (initial state, states with transitions).
 *
 * @returns `StateMachineResult` — `current`, `context`, `send`, `matches`, `reset`, `transitions`, `toMermaid`, `toD2`.
 *
 * @remarks **Declarative transitions:** Each state declares its own `on` map. Transitions can be a target state string, a `{ to, guard?, action? }` object, or an array of guarded alternatives (first match wins).
 * @remarks **Guards:** `guard(ctx, payload)` returns false to reject. With an array of alternatives, the first passing guard wins.
 * @remarks **Actions:** `action(ctx, payload)` returns updated context (or void). Runs after guard, before onExit/onEnter.
 * @remarks **Visualization:** `toMermaid()` and `toD2()` serialize the state graph. `transitions` returns the frozen edge list (read-only).
 *
 * @example
 * ```ts
 * import { stateMachine } from 'callbag-recharge/utils';
 *
 * const machine = stateMachine({ retries: 0 }, {
 *   initial: 'idle',
 *   states: {
 *     idle: {
 *       on: { START: 'running' },
 *     },
 *     running: {
 *       on: {
 *         DONE: 'idle',
 *         FAIL: {
 *           to: 'error',
 *           action: (ctx) => ({ retries: ctx.retries + 1 }),
 *         },
 *       },
 *     },
 *     error: {
 *       on: {
 *         RETRY: {
 *           to: 'running',
 *           guard: (ctx) => ctx.retries < 3,
 *         },
 *       },
 *     },
 *   },
 * });
 *
 * machine.current.get(); // 'idle'
 * machine.send('START'); // true
 * machine.current.get(); // 'running'
 * console.log(machine.toMermaid());
 * ```
 *
 * @example Shorthand transitions
 * ```ts
 * // String shorthand: just the target state
 * idle: { on: { GO: 'active' } }
 *
 * // Array of guarded alternatives (first match wins)
 * active: {
 *   on: {
 *     SUBMIT: [
 *       { to: 'premium', guard: (ctx) => ctx.isPremium },
 *       { to: 'standard' },
 *     ],
 *   },
 * }
 * ```
 *
 * @seeAlso [pipeline](./pipeline) — workflow DAG, [toMermaid](./toMermaid) — pipeline diagrams
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

	// Pre-compute transition edges for visualization (frozen to prevent external mutation)
	const edges = Object.freeze(extractEdges(config));

	function send(event: TEvent, payload?: any): boolean {
		const currentState = currentStore.get();
		const stateDef = config.states[currentState];
		if (!stateDef?.on) return false;

		const transition = stateDef.on[event];
		if (transition === undefined) return false;

		const defs = normalizeDefs(transition);
		const ctx = contextStore.get();

		// Find first matching transition (first passing guard, or first unguarded)
		for (const def of defs) {
			if (def.guard && !def.guard(ctx, payload)) continue;

			// Run action
			let updatedCtx = ctx;
			if (def.action) {
				const r = def.action(ctx, payload);
				if (r !== undefined) updatedCtx = r;
			}

			// Run onExit / onEnter hooks
			updatedCtx = applyHooks(config, currentState, def.to, updatedCtx);

			// Update stores
			currentStore.set(def.to);
			contextStore.set(updatedCtx);

			return true;
		}

		return false;
	}

	function matches(s: TState): boolean {
		return currentStore.get() === s;
	}

	function reset(): void {
		const currentState = currentStore.get();
		const ctx = contextStore.get();

		// Run onExit for current state (side effects only — return value ignored on reset)
		const currentStateDef = config.states[currentState];
		if (currentStateDef?.onExit) {
			currentStateDef.onExit(ctx);
		}

		currentStore.set(config.initial);

		// Run onEnter for initial state with clean initialContext (not onExit's return)
		const initDef = config.states[config.initial];
		if (initDef?.onEnter) {
			const enterResult = initDef.onEnter(initialContext);
			contextStore.set(enterResult !== undefined ? enterResult : initialContext);
		} else {
			contextStore.set(initialContext);
		}
	}

	function toMermaid(opts?: MermaidOpts): string {
		const direction = opts?.direction ?? "LR";
		const lines: string[] = [`stateDiagram-v2`, `  direction ${direction}`];

		// State declarations
		const stateNames = Object.keys(config.states) as TState[];
		for (const s of stateNames) {
			const id = sanitizeId(s);
			lines.push(`  ${id} : ${s}`);
		}

		// Initial arrow
		lines.push(`  [*] --> ${sanitizeId(config.initial)}`);

		// Edges
		for (const edge of edges) {
			const from = sanitizeId(edge.from);
			const to = sanitizeId(edge.to);
			const label = edge.guarded ? `${edge.event} [guarded]` : edge.event;
			lines.push(`  ${from} --> ${to} : ${label}`);
		}

		return lines.join("\n");
	}

	function toD2(opts?: D2Opts): string {
		const direction = opts?.direction ?? "right";
		const lines: string[] = [`direction: ${direction}`, ""];

		// State declarations
		const stateNames = Object.keys(config.states) as TState[];
		for (const s of stateNames) {
			const id = sanitizeId(s);
			const isInitial = s === config.initial;
			const label = isInitial ? `${s} (initial)` : s;
			lines.push(`${id}: "${label}"`);
		}

		// Edges
		if (edges.length > 0) {
			lines.push("");
			for (const edge of edges) {
				const from = sanitizeId(edge.from);
				const to = sanitizeId(edge.to);
				const label = edge.guarded ? `${edge.event} [guarded]` : edge.event;
				lines.push(`${from} -> ${to}: ${label}`);
			}
		}

		return lines.join("\n");
	}

	return {
		current: currentStore,
		context: contextStore,
		send,
		matches,
		reset,
		transitions: edges,
		toMermaid,
		toD2,
	};
}
