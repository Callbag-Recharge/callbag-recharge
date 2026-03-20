# task()

## Signature

```ts
function task<T>(fn: () => T | Promise<T>, opts?: TaskOpts<T>): TaskStepDef<T>
function task<T>(
	deps: string[],
	fn: (...values: any[]) => T | Promise<T>,
	opts?: TaskOpts<T>,
): TaskStepDef<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `depsOrFn` | `string[] | (() =&gt; T | Promise&lt;T&gt;)` |  |
| `fnOrOpts` | `((...values: any[]) =&gt; T | Promise&lt;T&gt;) | TaskOpts&lt;T&gt;` |  |
| `maybeOpts` | `TaskOpts&lt;T&gt;` |  |
