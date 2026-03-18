# filter()

Forwards upstream values only when `predicate` returns true; otherwise holds the last passing value.
Returns a `StoreOperator` for use with `pipe()`.

## Signature

```ts
function filter<A>(
	predicate: (value: A) => boolean,
	opts?: StoreOptions,
): StoreOperator<A, A | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `predicate` | `(value: A) =&gt; boolean` | If false, downstream gets RESOLVED (no new DATA) when the held value is unchanged. |
| `opts` | `StoreOptions` | Optional `name` and `equals` for memoization. |

### StoreOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `undefined` | Debug name for Inspector. |
| `equals` | `(a: A, b: A) =&gt; boolean` | `undefined` | Push-phase dedup when the filtered value repeats. |

## Returns

`StoreOperator&lt;A, A | undefined&gt;` — `get()` re-evaluates the predicate against the current input when disconnected.

## Basic Usage

```ts
import { state, pipe } from 'callbag-recharge';
import { filter } from 'callbag-recharge/extra';

const n = state(0);
const evens = pipe(n, filter((x) => x % 2 === 0));
n.set(2);
evens.get(); // 2
```

## Options / Behavior Details

- **Tier 1:** Participates in diamond resolution; forwards STATE from upstream.

## See Also

- [pipe](/api/pipe)
- [map](/api/map)
