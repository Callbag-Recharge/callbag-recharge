# effect()

Runs a side effect when all dependencies have resolved after a change; returns `dispose()`.
Eagerly subscribes to deps on creation. Not a store — no `get()` or `source()`.

## Signature

```ts
function effect(
	deps: Store<unknown>[],
	fn: () => undefined | (() => void),
	opts?: { name?: string },
): () => void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `Store&lt;unknown&gt;[]` | Stores to watch; effect runs when dirty tracking shows all deps settled. |
| `fn` | `() =&gt; undefined | (() =&gt; void)` | Called on each run; may return a cleanup function run before the next run or on dispose. |
| `opts` | `{ name?: string }` | Optional `{ name }` for Inspector. |

## Returns

`() =&gt; void` — call to unsubscribe and run final cleanup.

## Basic Usage

```ts
import { state, effect } from 'callbag-recharge';

const count = state(0);
let runs = 0;
const stop = effect([count], () => {
    runs++;
  });
// runs === 1
count.set(1);
// runs === 2
stop();
```

## Options / Behavior Details

- **Immediate first run:** `fn()` runs once right after wiring deps.
- **RESOLVED skip:** If deps send RESOLVED without value changes, the effect may not re-run.
- **Cleanup:** Return a function from `fn` to tear down listeners before the next run.

## See Also

- [derived](./derived)
- [state](./state)
- [subscribe](/api/subscribe)
