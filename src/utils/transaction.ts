// ---------------------------------------------------------------------------
// transaction — atomic multi-store writes with rollback
// ---------------------------------------------------------------------------
// Extends batch(): captures snapshots before, applies fn inside batch(),
// rolls back all stores on throw. batch() is fire-and-forget; transaction()
// is all-or-nothing.
//
// Usage:
//   const a = state(1), b = state(2);
//   transaction([a, b], () => {
//     a.set(10);
//     b.set(20);
//     throw new Error("rollback!");
//   });
//   // a.get() === 1, b.get() === 2 — rolled back
// ---------------------------------------------------------------------------

import { batch } from "../core/protocol";
import type { WritableStore } from "../core/types";

export interface TransactionOptions {
	/** If true, suppress the re-thrown error after rollback. Default: false. */
	silent?: boolean;
}

/**
 * Atomic multi-store writes with rollback on error.
 *
 * @param stores - Array of writable stores to snapshot and potentially roll back.
 * @param fn - Synchronous function that mutates the stores. If it throws, all stores are rolled back.
 * @param opts - Optional configuration.
 *
 * @returns The return value of `fn` on success.
 *
 * @remarks **Extends batch():** The function runs inside `batch()`, so all mutations are deferred until the outermost batch completes. On throw, rollback happens inside the same batch — downstream sees either the final state or the original state, never a partial update.
 * @remarks **Snapshot:** Captures `store.get()` for each store before running `fn`. On throw, calls `store.set(snapshot)` for each.
 * @remarks **Re-throw:** The error is re-thrown after rollback (unless `silent: true`), so callers can handle it.
 * @remarks **Shallow snapshot:** Snapshots capture `store.get()` references, not deep clones. This assumes immutable update patterns (replace via `set()`, not in-place mutation via `store.get().items.push()`). In-place mutation corrupts the snapshot — use `set({...old})` style updates.
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 * import { transaction } from 'callbag-recharge/utils';
 *
 * const balance = state(100);
 * const ledger = state<string[]>([]);
 * try {
 *   transaction([balance, ledger], () => {
 *     balance.set(balance.get() - 150); // overdraft
 *     if (balance.get() < 0) throw new Error("insufficient funds");
 *     ledger.set([...ledger.get(), "withdraw 150"]);
 *   });
 * } catch {
 *   // balance is still 100, ledger is still []
 * }
 * ```
 *
 * @category utils
 */
export function transaction<T>(
	stores: WritableStore<any>[],
	fn: () => T,
	opts?: TransactionOptions,
): T {
	// Capture snapshots before any mutations
	const snapshots: any[] = stores.map((s) => s.get());

	return batch(() => {
		try {
			return fn();
		} catch (err) {
			// Rollback all stores to their pre-transaction values
			for (let i = 0; i < stores.length; i++) {
				stores[i].set(snapshots[i]);
			}
			if (opts?.silent) return undefined as T;
			throw err;
		}
	});
}
