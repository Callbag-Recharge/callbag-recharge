# fromNodeCallback()

Creates a raw callbag source from a Node.js-style one-shot callback.
The `setup` function receives `resolve` and `reject` callbacks — call
one when the operation completes. Returns an optional cleanup function.

Unlike `new Promise`, this participates in the callbag protocol:
the sink can send END to cancel, which triggers cleanup.

## Signature

```ts
function fromNodeCallback<T = void>(
	setup: (
		resolve: (value: T) => void,
		reject: (error: unknown) => void,
	) => (() => void) | undefined,
): CallbagSource
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `setup` | `(
		resolve: (value: T) =&gt; void,
		reject: (error: unknown) =&gt; void,
	) =&gt; (() =&gt; void) | undefined` | `(resolve, reject) =&gt; cleanup?` |
