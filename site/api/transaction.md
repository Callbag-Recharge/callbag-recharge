# transaction()

Atomic multi-store writes with rollback on error.

## Signature

```ts
function transaction<T>(
	stores: WritableStore<any>[],
	fn: () => T,
	opts?: TransactionOptions,
): T
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `stores` | `WritableStore&lt;any&gt;[]` | Array of writable stores to snapshot and potentially roll back. |
| `fn` | `() =&gt; T` | Synchronous function that mutates the stores. If it throws, all stores are rolled back. |
| `opts` | `TransactionOptions` | Optional configuration. |

## Returns

The return value of `fn` on success.

## Basic Usage

```ts
import { state } from 'callbag-recharge';
import { transaction } from 'callbag-recharge/utils';

const balance = state(100);
const ledger = state<string[]>([]);
try {
  transaction([balance, ledger], () => {
      balance.set(balance.get() - 150); // overdraft
      if (balance.get() < 0) throw new Error("insufficient funds");
      ledger.set([...ledger.get(), "withdraw 150"]);
    });
} catch {
// balance is still 100, ledger is still []
}
```

## Options / Behavior Details

- **Extends batch():** The function runs inside `batch()`, so all mutations are deferred until the outermost batch completes. On throw, rollback happens inside the same batch — downstream sees either the final state or the original state, never a partial update.
- **Snapshot:** Captures `store.get()` for each store before running `fn`. On throw, calls `store.set(snapshot)` for each.
- **Re-throw:** The error is re-thrown after rollback (unless `silent: true`), so callers can handle it.
- **Shallow snapshot:** Snapshots capture `store.get()` references, not deep clones. This assumes immutable update patterns (replace via `set()`, not in-place mutation via `store.get().items.push()`). In-place mutation corrupts the snapshot — use `set({...old})` style updates.
