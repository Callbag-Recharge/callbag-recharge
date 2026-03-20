# tokenTracker()

Wraps a stream with reactive token/cost tracking metadata (Tier 2).

## Signature

```ts
function tokenTracker<A>(
	countTokens: (value: A) => TokenUsage,
	opts?: { name?: string },
): StoreOperator<A, A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `countTokens` | `(value: A) =&gt; TokenUsage` | Function that extracts token usage from each emitted value. |
| `opts` | `{ name?: string }` | Optional configuration. |

## Returns

`StoreOperator&lt;A, A&gt;` — pipe-compatible. The returned store has a `tokens` property (`Store&lt;TokenMeta&gt;`).

| Method | Signature | Description |
|--------|-----------|-------------|
| `get()` | `() =&gt; A \` | undefined |
| `tokens` | `Store\&lt;TokenMeta\&gt;` | Reactive metadata: promptTokens, completionTokens, totalTokens, cost, count. |
| `source` | `callbag` | Underlying callbag source for subscriptions. |

## Basic Usage

```ts
import { state, pipe, effect } from 'callbag-recharge';
import { tokenTracker } from 'callbag-recharge/orchestrate';

const llmOutput = state({ text: 'Hello', usage: { promptTokens: 10, completionTokens: 5 } });
const tracked = pipe(llmOutput, tokenTracker(v => v.usage));
effect([tracked.tokens], () => {
    const t = tracked.tokens.get();
    console.log(`${t.totalTokens} tokens`); // "15 tokens"
  });
```

## Options / Behavior Details

- **Tier 2:** Cycle boundary — each forwarded value starts a new DIRTY+value cycle.
- **Accumulative:** Token counts and cost accumulate across all values. Resets on reconnect.
- **Flexible extraction:** `countTokens` can return partial usage — missing fields default to 0.

## See Also

- [track](./track) — lifecycle tracking
- [fromLLM](/api/fromLLM) — LLM adapter
