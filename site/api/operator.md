# operator()

Creates a custom transform node: you handle every callbag signal from each dependency and decide what to forward.
Building block for Tier 1 operators; participates in diamond resolution when you forward STATE correctly.

## Signature

```ts
function operator<B>(
	deps: Store<unknown>[],
	init: (actions: Actions<B>) => (depIndex: number, type: number, data: any) => void,
	opts?: OperatorOpts<B>,
): Store<B>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `Store&lt;unknown&gt;[]` | Upstream stores (multi-dep uses bitmask dirty tracking). |
| `init` | `(actions: Actions&lt;B&gt;) =&gt; (depIndex: number, type: number, data: any) =&gt; void` | Receives `emit`, `signal`, `complete`, `error`, `disconnect`, `seed`; return per-signal handler. |
| `opts` | `OperatorOpts&lt;B&gt;` | `initial`, `getter`, `equals`, `name`, `resetOnTeardown`, etc. (see `SourceOptions`). |

## Returns

`Store&lt;B&gt;` — output store with standard `get()` / `source()`.

## Basic Usage

```ts
import { state, operator } from 'callbag-recharge';
import { DATA, STATE } from 'callbag-recharge';

const n = state(2);
const doubled = operator<number>([n], ({ emit, signal }) => {
    return (_, type, data) => {
      if (type === STATE) signal(data);
      else if (type === DATA) emit((data as number) * 2);
    };
});
doubled.get(); // 4
```

## Options / Behavior Details

- **STATE channel:** Forward `DIRTY`/`RESOLVED` (and unknown signals) for correct graph behavior.
- **Skip re-emit:** After DIRTY, if the output value is unchanged, call `signal(RESOLVED)` instead of `emit`.

## See Also

- [producer](./producer)
- [derived](./derived)
- [map](/api/map)
