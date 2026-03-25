# latestAsync()

Wraps an async function so that only the result of the most recent
invocation is delivered. Stale results from earlier calls are discarded
and their AbortSignal is fired.

Use `cancel()` to invalidate all in-flight calls (e.g. on destroy). If
`onError` is omitted, errors from the latest call are silently dropped.

No core dependencies — safe to import from any layer.

## Signature

```ts
function latestAsync<TInput, TResult>(
	fn: (input: TInput, signal: AbortSignal) => Promise<TResult>,
): {
	/**
	 * Invoke `fn` with `input` and an AbortSignal. If this is the most recent
	 * call when the Promise settles, `onResult` (or `onError`) is called.
	 * Otherwise the result is silently dropped and the signal is aborted.
	 */
	call(input: TInput, onResult: (result: TResult) => void, onError?: (err: unknown) => void): void;
	/** Abort + discard all pending in-flight results. */
	cancel(): void;
}
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `(input: TInput, signal: AbortSignal) =&gt; Promise&lt;TResult&gt;` | The async function to wrap. Receives `(input, signal)`. |

## Returns

An object with `call(input, onResult, onError?)` and `cancel()`.

## Basic Usage

```ts
import { latestAsync } from 'callbag-recharge/raw';

const latest = latestAsync((query: string, signal: AbortSignal) => embed(query));

// Only the result of the last call is delivered; earlier calls are aborted
latest.call('hello', result => console.log(result));
latest.call('world', result => console.log(result)); // 'hello' aborted

// Invalidate all in-flight calls (e.g. on component destroy)
latest.cancel();
```
