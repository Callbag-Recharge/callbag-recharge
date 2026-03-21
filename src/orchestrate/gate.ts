// ---------------------------------------------------------------------------
// gate — human-in-the-loop operator
// ---------------------------------------------------------------------------
// Pauses a stream, queues pending values, and lets an external controller
// approve, reject, or modify values before forwarding them downstream.
// Supports open/close modes for automatic passthrough.
//
// Usage:
//   const gated = pipe(source, gate());
//   gated.pending.get();   // [pendingValue]
//   gated.approve();       // forwards and removes first pending
//   gated.open();          // auto-approve all future values
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";

export interface GateOptions {
	/** Maximum queue size. Oldest values are dropped when exceeded. Default: Infinity. */
	maxPending?: number;
	/** Start in open mode (auto-approve). Default: false. */
	startOpen?: boolean;
	/** Debug name for Inspector. */
	name?: string;
}

export interface GatedStore<A> extends Store<A | undefined> {
	/** Reactive store of values waiting for approval. */
	pending: Store<A[]>;
	/** Whether the gate is currently open (auto-approving). */
	isOpen: Store<boolean>;
	/** Approve and forward the next `count` pending values (default: 1). */
	approve(count?: number): void;
	/** Reject (discard) the next `count` pending values (default: 1). */
	reject(count?: number): void;
	/** Transform and forward the next pending value. */
	modify(fn: (value: A) => A): void;
	/** Approve all pending values and auto-approve future values. */
	open(): void;
	/** Re-enable gating (stop auto-approving). */
	close(): void;
}

/**
 * Human-in-the-loop: pauses stream, inspects pending values, approve/reject/modify before forwarding (Tier 2).
 *
 * @param opts - Optional configuration.
 *
 * @returns A function that takes `Store<A>` and returns `GatedStore<A>`.
 *
 * @returnsTable get() | () => A \| undefined | Last approved value.
 * pending | Store\<A[]\> | Reactive queue of values awaiting approval.
 * isOpen | Store\<boolean\> | Whether auto-approving.
 * approve(n?) | (count?: number) => void | Forward next n pending values.
 * reject(n?) | (count?: number) => void | Discard next n pending values.
 * modify(fn) | (fn: (A) => A) => void | Transform and forward next pending.
 * open() | () => void | Flush pending + auto-approve future values.
 * close() | () => void | Re-enable gating.
 * source | (type, payload?) => void | Underlying reactive source for subscriptions.
 *
 * @remarks **Tier 2:** Cycle boundary — each approved value starts a new reactive update cycle.
 * @remarks **Queue:** Values queue while gate is closed. `maxPending` limits queue size (FIFO drop).
 * @remarks **Open/close:** `open()` flushes all pending and auto-approves future values. `close()` re-enables manual gating.
 * @remarks **Teardown:** After the gate's producer is torn down (unsubscribed), all controls throw. Re-subscribing resets the gate to a clean state.
 *
 * @example
 * ```ts
 * import { state, pipe, subscribe } from 'callbag-recharge';
 * import { gate } from 'callbag-recharge/orchestrate';
 *
 * const input = state(0);
 * const gated = pipe(input, gate());
 *
 * subscribe(gated, v => console.log("approved:", v));
 * input.set(1);
 * gated.pending.get();  // [1]
 * gated.approve();      // logs "approved: 1"
 * gated.pending.get();  // []
 * ```
 *
 * @example Auto-approve mode
 * ```ts
 * const gated = pipe(input, gate({ startOpen: true }));
 * // All values pass through immediately
 * gated.close(); // Re-enable manual gating
 * ```
 *
 * @seeAlso [track](./track) — lifecycle metadata, [route](./route) — conditional routing
 *
 * @category orchestrate
 */
export function gate<A>(opts?: GateOptions): (input: Store<A>) => GatedStore<A> {
	const maxPending = opts?.maxPending ?? Infinity;
	if (maxPending < 1 && maxPending !== Infinity) {
		throw new RangeError("gate: maxPending must be >= 1");
	}
	const startOpen = opts?.startOpen ?? false;
	const baseName = opts?.name ?? "gate";

	return (input: Store<A>) => {
		const pendingStore = state<A[]>([], {
			name: `${baseName}:pending`,
			equals: () => false,
		});
		const isOpenStore = state<boolean>(startOpen, {
			name: `${baseName}:isOpen`,
		});

		let _emit: ((value: A) => void) | null = null;
		let _error: ((e: unknown) => void) | null = null;
		let _complete: (() => void) | null = null;
		let _torn = false;
		let queue: A[] = [];

		function enqueue(value: A) {
			queue.push(value);
			if (queue.length > maxPending) {
				queue.shift();
			}
			pendingStore.set([...queue]);
		}

		function dequeue(count: number): A[] {
			const items = queue.splice(0, count);
			pendingStore.set([...queue]);
			return items;
		}

		function flushAll() {
			const items = queue.splice(0, queue.length);
			pendingStore.set([]);
			for (const item of items) {
				if (_torn) break;
				_emit?.(item);
			}
		}

		const store = producer<A>(
			({ emit, error, complete }) => {
				_emit = emit;
				_error = error;
				_complete = complete;

				// Reset state on reconnect
				_torn = false;
				queue = [];
				pendingStore.set([]);
				isOpenStore.set(startOpen);

				const unsub = subscribe(
					input,
					(v) => {
						if (isOpenStore.get()) {
							emit(v);
						} else {
							enqueue(v);
						}
					},
					{
						onEnd: (err) => {
							if (err !== undefined) error(err);
							else complete();
							// Mark torn so controls throw instead of silently no-oping
							_emit = null;
							_error = null;
							_complete = null;
							_torn = true;
							queue = [];
							pendingStore.set([]);
						},
					},
				);

				return () => {
					_emit = null;
					_error = null;
					_complete = null;
					_torn = true;
					queue = [];
					pendingStore.set([]);
					unsub();
				};
			},
			{ initial: input.get() },
		);

		Inspector.register(store, { kind: "gate" });

		const gated = store as unknown as GatedStore<A>;

		function guardTorn(method: string) {
			if (_torn) throw new Error(`gate: ${method}() called after gate was torn down`);
		}

		Object.defineProperties(gated, {
			pending: { value: pendingStore, enumerable: true },
			isOpen: { value: isOpenStore, enumerable: true },
			approve: {
				value(count = 1) {
					guardTorn("approve");
					const items = dequeue(count);
					for (const item of items) {
						if (_torn) break;
						_emit?.(item);
					}
				},
				enumerable: true,
			},
			reject: {
				value(count = 1) {
					guardTorn("reject");
					dequeue(count);
				},
				enumerable: true,
			},
			modify: {
				value(fn: (value: A) => A) {
					guardTorn("modify");
					const items = dequeue(1);
					if (items.length > 0) {
						_emit?.(fn(items[0]));
					}
				},
				enumerable: true,
			},
			open: {
				value() {
					guardTorn("open");
					isOpenStore.set(true);
					flushAll();
				},
				enumerable: true,
			},
			close: {
				value() {
					guardTorn("close");
					isOpenStore.set(false);
				},
				enumerable: true,
			},
		});

		return gated;
	};
}
