# task()

## Signature

```ts
function task<T>(
	fn: (signal: AbortSignal) => T | Promise<T>,
	opts?: TaskOpts<T>,
): TaskStepDef<T>
function task<T>(
	deps: string[],
	fn: (signal: AbortSignal, values: any[]) => T | Promise<T>,
	opts?: TaskOpts<T>,
): TaskStepDef<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `depsOrFn` | `string[] | ((signal: AbortSignal) =&gt; T | Promise&lt;T&gt;)` |  |
| `fnOrOpts` | `((signal: AbortSignal, values: any[]) =&gt; T | Promise&lt;T&gt;) | TaskOpts&lt;T&gt;` |  |
| `maybeOpts` | `TaskOpts&lt;T&gt;` |  |
