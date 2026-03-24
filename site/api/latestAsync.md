# latestAsync()

Wraps an async function so that only the result of the most recent
invocation is delivered. Stale results from earlier calls are discarded.

Use `cancel()` to invalidate all in-flight calls (e.g. on destroy). If
`onError` is omitted, errors from the latest call are silently dropped.

No core dependencies — safe to import from any layer.

## Signature

```ts
function latestAsync<TInput, TResult>(
	fn: (input: TInput) => Promise<TResult>,
): {
	/**
	 * Invoke `fn` with `input`. If this is the most recent call when the
	 * Promise settles, `onResult` (or `onError`) is called. Otherwise the
	 * result is silently dropped.
	 */
	call(input: TInput, onResult: (result: TResult) => void, onError?: (err: unknown) => void): void;
	/** Discard all pending in-flight results. */
	cancel(): void;
}
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `(input: TInput) =&gt; Promise&lt;TResult&gt;` | The async function to wrap. |

## Returns

An object with `call(input, onResult, onError?)` and `cancel()`.

## Basic Usage

```ts
import { latestAsync } from 'callbag-recharge/raw';

const latest = latestAsync((query: string) => embed(query));

// Only the result of the last call is delivered
latest.call('hello', result => console.log(result));
latest.call('world', result => console.log(result)); // 'hello' discarded

// Invalidate all in-flight calls (e.g. on component destroy)
latest.cancel();
```
