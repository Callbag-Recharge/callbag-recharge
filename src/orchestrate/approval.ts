// ---------------------------------------------------------------------------
// approval — human-in-the-loop approval as pipeline step
// ---------------------------------------------------------------------------
// High-level gating for pipeline(). Values queue until approved/rejected.
// Built on gate() internally. Exposes approve/reject/modify/open/close
// controls directly on the pipeline step.
//
// Usage:
//   const wf = pipeline({
//     input:   step(fromTrigger<string>()),
//     review:  approval("input"),
//     process: task(["review"], async (v) => { ... }),
//   });
//   wf.steps.review.approve(); // forward next pending value
// ---------------------------------------------------------------------------

import type { Store } from "../core/types";
import type { GateOptions } from "./gate";
import { gate } from "./gate";
import type { StepDef } from "./pipeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApprovalOpts {
	/** Debug name for Inspector. */
	name?: string;
	/** Maximum queue size. Oldest values are dropped when exceeded. Default: Infinity. */
	maxPending?: number;
	/** Start in open mode (auto-approve). Default: false. */
	startOpen?: boolean;
}

/** Extended StepDef that carries gate controls for pipeline step access. */
export interface ApprovalStepDef<T = any> extends StepDef<T | undefined> {
	/** Reactive store of values waiting for approval. */
	pending: Store<T[]>;
	/** Whether the gate is currently open (auto-approving). */
	isOpen: Store<boolean>;
	/** Approve and forward the next `count` pending values (default: 1). */
	approve(count?: number): void;
	/** Reject (discard) the next `count` pending values (default: 1). */
	reject(count?: number): void;
	/** Transform and forward the next pending value. */
	modify(fn: (value: T) => T): void;
	/** Approve all pending values and auto-approve future values. */
	open(): void;
	/** Re-enable gating (stop auto-approving). */
	close(): void;
	/** @internal Called by pipeline destroy() to invalidate controls. */
	_destroy(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a human-in-the-loop approval step in a pipeline. Values from the
 * upstream dep are queued until explicitly approved, rejected, or modified.
 *
 * The returned step definition exposes `approve()`, `reject()`, `modify()`,
 * `open()`, and `close()` controls. In a pipeline result, access them via
 * `wf.steps.review` (where "review" is the step name).
 *
 * @param dep - Name of the upstream step to gate.
 * @param opts - Optional configuration (maxPending, startOpen, name).
 *
 * @returns `ApprovalStepDef<T>` — step definition for pipeline() with approval controls.
 *
 * @remarks **Queue:** Values queue while gate is closed. `maxPending` limits queue size (FIFO drop).
 * @remarks **Open/close:** `open()` flushes all pending and auto-approves. `close()` re-enables manual gating.
 * @remarks **Destroy:** After `pipeline.destroy()`, all controls and store accessors throw. This prevents stale references from silently no-oping on a torn-down gate.
 *
 * @example
 * ```ts
 * import { pipeline, step, task, approval, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * const wf = pipeline({
 *   input:   step(fromTrigger<string>()),
 *   review:  approval("input"),
 *   process: task(["review"], async (v) => saveToDb(v)),
 * });
 *
 * // Values queue at the review step
 * wf.steps.input.fire("draft-1");
 * wf.steps.review.pending.get(); // ["draft-1"]
 *
 * // Approve to let it flow to process
 * wf.steps.review.approve();
 * ```
 *
 * @category orchestrate
 */
export function approval<T>(dep: string, opts?: ApprovalOpts): ApprovalStepDef<T> {
	const gateOpts: GateOptions = {
		name: opts?.name ?? "approval",
		maxPending: opts?.maxPending,
		startOpen: opts?.startOpen,
	};

	const factory = (depStore: Store<T>): Store<T | undefined> => {
		const gated = gate<T>(gateOpts)(depStore);

		// Wire up controls on the def now that we have the gated store
		def.pending = gated.pending;
		def.isOpen = gated.isOpen;
		def.approve = (count?: number) => gated.approve(count);
		def.reject = (count?: number) => gated.reject(count);
		def.modify = (fn: (value: T) => T) => gated.modify(fn);
		def.open = () => gated.open();
		def.close = () => gated.close();

		return gated;
	};

	// Placeholder controls that throw if called before pipeline wires the step.
	const notWired = (method: string) => () => {
		throw new Error(`approval: ${method}() called before pipeline wired the step`);
	};
	const destroyed = (method: string) => () => {
		throw new Error(`approval: ${method}() called after pipeline was destroyed`);
	};
	const destroyedStore = (name: string) => ({
		get() {
			throw new Error(`approval: ${name} accessed after pipeline was destroyed`);
		},
		source() {
			throw new Error(`approval: ${name} accessed after pipeline was destroyed`);
		},
	});

	const def: ApprovalStepDef<T> = {
		factory: factory as any,
		deps: [dep],
		name: opts?.name,
		pending: undefined as any, // wired by factory
		isOpen: undefined as any, // wired by factory
		approve: notWired("approve") as any,
		reject: notWired("reject") as any,
		modify: notWired("modify") as any,
		open: notWired("open") as any,
		close: notWired("close") as any,
		_destroy() {
			def.approve = destroyed("approve") as any;
			def.reject = destroyed("reject") as any;
			def.modify = destroyed("modify") as any;
			def.open = destroyed("open") as any;
			def.close = destroyed("close") as any;
			def.pending = destroyedStore("pending") as any;
			def.isOpen = destroyedStore("isOpen") as any;
		},
	};

	return def;
}
