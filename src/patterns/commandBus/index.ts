// ---------------------------------------------------------------------------
// commandBus — typed command dispatch with middleware and undo
// ---------------------------------------------------------------------------
// Typed command dispatch with middleware chains, undo/redo integration,
// and command history tracking.
//
// Built on: state, derived
// ---------------------------------------------------------------------------

import { derived } from "../../core/derived";
import { teardown } from "../../core/protocol";
import { state } from "../../core/state";
import type { Store } from "../../core/types";
import { rawFromAny } from "../../raw/fromAny";
import { rawSubscribe } from "../../raw/subscribe";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandDef<Args = void, Result = void> {
	execute(args: Args): Result | Promise<Result>;
	undo?(args: Args): void | Promise<void>;
}

export type CommandMiddleware = (name: string, args: unknown, next: () => unknown) => unknown;

export interface CommandBusOptions {
	/** Max history for undo. 0 = no history. Default: 50 */
	maxHistory?: number;
	/** Middleware stack (executed in order). */
	middleware?: CommandMiddleware[];
	/** Debug name prefix. */
	name?: string;
}

export interface CommandEntry {
	name: string;
	args: unknown;
	timestamp: number;
}

export interface CommandBusResult<Commands extends Record<string, CommandDef<any, any>>> {
	/** Dispatch a command by name. */
	dispatch<K extends keyof Commands & string>(
		name: K,
		...args: Commands[K] extends CommandDef<infer A, any> ? (A extends void ? [] : [A]) : never
	): Commands[K] extends CommandDef<any, infer R> ? R | Promise<R> : void;

	/** Last dispatched command. */
	lastCommand: Store<CommandEntry | null>;

	/** Whether undo is available. */
	canUndo: Store<boolean>;
	/** Whether redo is available. */
	canRedo: Store<boolean>;
	/** Undo the last command. Returns false if nothing to undo. */
	undo(): boolean;
	/** Redo the last undone command. Returns false if nothing to redo. */
	redo(): boolean;
	/** Last error from an async undo/redo operation. */
	undoRedoError: Store<unknown | undefined>;

	/** Subscribe to specific command executions. Returns unsubscribe function. */
	on<K extends keyof Commands & string>(
		name: K,
		handler: (args: Commands[K] extends CommandDef<infer A, any> ? A : never) => void,
	): () => void;

	/** Dispose — clears history and listeners. */
	dispose(): void;
}

/**
 * Creates a typed command bus with middleware, undo/redo, and command history.
 *
 * @param commands - Map of command names to CommandDef implementations.
 * @param opts - Optional configuration.
 *
 * @returns `CommandBusResult<Commands>` — dispatch, undo, redo, on, and reactive stores.
 *
 * @remarks **Middleware:** Executed in registration order. Each middleware calls `next()` to proceed.
 * @remarks **Undo/redo:** Only commands with an `undo` method participate in undo/redo history.
 * @remarks **Type-safe dispatch:** Command names and args are fully typed.
 *
 * @example
 * ```ts
 * import { commandBus } from 'callbag-recharge/patterns/commandBus';
 *
 * const bus = commandBus({
 *   increment: {
 *     execute: (n: number) => { count += n; },
 *     undo: (n: number) => { count -= n; },
 *   },
 * });
 *
 * bus.dispatch('increment', 5);
 * bus.undo();
 * ```
 *
 * @category patterns
 */
export function commandBus<Commands extends Record<string, CommandDef<any, any>>>(
	commands: Commands,
	opts?: CommandBusOptions,
): CommandBusResult<Commands> {
	const maxHistory = opts?.maxHistory ?? 50;
	const middleware = opts?.middleware ?? [];
	const prefix = opts?.name ?? "commandBus";

	// Undo/redo stacks — store command entries with their args
	const undoStack = state<CommandEntry[]>([], { name: `${prefix}.undoStack` });
	const redoStack = state<CommandEntry[]>([], { name: `${prefix}.redoStack` });

	const lastCommandStore = state<CommandEntry | null>(null, {
		name: `${prefix}.lastCommand`,
	});

	const canUndo = derived([undoStack], () => undoStack.get().length > 0, {
		name: `${prefix}.canUndo`,
	});

	const canRedo = derived([redoStack], () => redoStack.get().length > 0, {
		name: `${prefix}.canRedo`,
	});

	const undoRedoError = state<unknown | undefined>(undefined, {
		name: `${prefix}.undoRedoError`,
	});

	// Per-command listeners
	const listeners = new Map<string, Set<(args: any) => void>>();

	let disposed = false;

	function executeWithMiddleware(name: string, args: unknown): unknown {
		const chain = [...middleware];
		let index = 0;

		function next(): unknown {
			if (index < chain.length) {
				const mw = chain[index++];
				return mw(name, args, next);
			}
			// End of middleware chain — execute the command
			const cmd = commands[name];
			if (!cmd) throw new Error(`Unknown command: ${name}`);
			return cmd.execute(args);
		}

		return next();
	}

	function dispatch(name: string, ...rest: any[]): any {
		if (disposed) return;
		const args = rest[0];
		const cmd = commands[name];
		if (!cmd) throw new Error(`Unknown command: ${name}`);

		const result = executeWithMiddleware(name, args);

		const entry: CommandEntry = { name, args, timestamp: Date.now() };
		lastCommandStore.set(entry);

		// Push to undo stack if command supports undo
		if (cmd.undo && maxHistory > 0) {
			undoStack.update((stack) => {
				const newStack = [...stack, entry];
				if (newStack.length > maxHistory) {
					newStack.splice(0, newStack.length - maxHistory);
				}
				return newStack;
			});
			// Clear redo stack on new command
			redoStack.set([]);
		}

		// Notify listeners (exception-safe — one handler throwing doesn't block others)
		const handlers = listeners.get(name);
		if (handlers) {
			for (const handler of handlers) {
				try {
					handler(args);
				} catch (_) {
					// swallow — consistent with core multi-sink dispatch
				}
			}
		}

		return result;
	}

	function undo(): boolean {
		if (disposed) return false;
		const stack = undoStack.get();
		if (stack.length === 0) return false;

		const entry = stack[stack.length - 1];
		const cmd = commands[entry.name];
		if (!cmd?.undo) return false;

		const result = cmd.undo(entry.args);
		undoRedoError.set(undefined);
		// Fire-and-forget for async undo — track errors via store
		if (result && typeof (result as any).then === "function") {
			rawSubscribe(rawFromAny(result), () => {}, {
				onEnd: (err?: unknown) => {
					if (err !== undefined) undoRedoError.set(err);
				},
			});
		}

		undoStack.update((s) => s.slice(0, -1));
		redoStack.update((s) => [...s, entry]);
		return true;
	}

	function redo(): boolean {
		if (disposed) return false;
		const stack = redoStack.get();
		if (stack.length === 0) return false;

		const entry = stack[stack.length - 1];
		const cmd = commands[entry.name];
		if (!cmd) return false;

		const result = executeWithMiddleware(entry.name, entry.args);
		undoRedoError.set(undefined);
		// Fire-and-forget for async redo — track errors via store
		if (result && typeof (result as any).then === "function") {
			rawSubscribe(rawFromAny(result), () => {}, {
				onEnd: (err?: unknown) => {
					if (err !== undefined) undoRedoError.set(err);
				},
			});
		}

		redoStack.update((s) => s.slice(0, -1));
		undoStack.update((s) => [...s, entry]);
		lastCommandStore.set({ ...entry, timestamp: Date.now() });
		return true;
	}

	function on(name: string, handler: (args: any) => void): () => void {
		let handlers = listeners.get(name);
		if (!handlers) {
			handlers = new Set();
			listeners.set(name, handlers);
		}
		handlers.add(handler);

		return () => {
			handlers!.delete(handler);
			if (handlers!.size === 0) {
				listeners.delete(name);
			}
		};
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		listeners.clear();
		// Reset state before teardown so get() returns clean values
		undoStack.set([]);
		redoStack.set([]);
		// Teardown stores — cascades END to canUndo/canRedo derived stores
		// and any external subscribers.
		teardown(undoStack);
		teardown(redoStack);
		teardown(lastCommandStore);
	}

	return {
		dispatch: dispatch as any,
		lastCommand: lastCommandStore,
		canUndo,
		canRedo,
		undo,
		redo,
		undoRedoError,
		on: on as any,
		dispose,
	};
}
