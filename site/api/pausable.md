# pausable()

Gates DATA flow through a pause/resume mechanism, with PAUSE/RESUME propagating as TYPE 3 STATE signals.

## Signature

```ts
function pausable<A>(opts?: StoreOptions): (input: Store<A>) => PausableStore<A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `StoreOptions` | Optional `name` and `equals` for the output store. |

## Returns

A function that wraps an input store and returns a `PausableStore&lt;A&gt;`.

## Basic Usage

```ts
import { state, pipe, subscribe } from 'callbag-recharge';
import { pausable } from 'callbag-recharge/extra';

const source = state(0);
const gated = pipe(source, pausable());
const lockId = gated.pause();
source.set(1); // DATA not forwarded
source.set(2);
gated.resume(lockId); // emits 2 (latest)
```

## Options / Behavior Details

- **Lock-based pause:** Each `pause()` returns a unique lock ID. Only `resume(lockId)` with the
matching ID can unpause. This prevents upstream RESUME signals from overriding an imperative pause.
- **PAUSE/RESUME signals flow downstream:** When paused (imperatively or via upstream signal),
PAUSE propagates to all subscribers. On resume, RESUME propagates followed by the latest DATA.
- **DIRTY/RESOLVED pass through:** Graph coordination signals are never blocked, even while paused.
This preserves diamond resolution correctness.
- **`get()` while paused** returns the last emitted value (before pause), consistent with
RxJS/callbag semantics where paused means the value is held back entirely.
