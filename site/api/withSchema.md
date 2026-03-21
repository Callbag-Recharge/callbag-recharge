# withSchema()

Wraps a store with runtime schema validation. Invalid upstream values are
rejected (not forwarded) and the error is exposed via an `error` companion store.

## Signature

```ts
function withSchema<T>(
	store: Store<unknown>,
	schema: Schema<T>,
	opts?: WithSchemaOptions,
): WithSchemaStore<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `store` | `Store&lt;unknown&gt;` | The source store to validate. |
| `schema` | `Schema&lt;T&gt;` | Any object with `parse(v: unknown): T`. Throws on invalid input. |
| `opts` | `WithSchemaOptions` | Optional configuration. |

## Returns

`WithSchemaStore&lt;T&gt;` — a store that only emits valid values, with `error` companion and `set()` for validated writes.

## Basic Usage

```ts
import { state, subscribe } from 'callbag-recharge';
import { withSchema } from 'callbag-recharge/utils';

const raw = state<unknown>(0);
const validated = withSchema(raw, { parse: (v) => { if (typeof v !== 'number') throw new Error('not a number'); return v; } });
subscribe(validated.error, e => console.log(e?.message)); // "not a number"
raw.set("bad"); // rejected — error companion fires
raw.set(42);    // passes — emitted downstream, error cleared
```

## Options / Behavior Details

- **Schema interface:** `{ parse(v: unknown): T }` — compatible with Zod (`z.string()`), Valibot (`v.string()`), ArkType, or any custom validator that throws on invalid input.
- **Rejection:** Invalid values are silently dropped (not forwarded downstream). The `error` companion store is set with the validation error.
- **Writable:** If the input store has `set()`, the returned store's `set()` validates before forwarding. Invalid values are rejected with error set. Throws if upstream is read-only.
- **Initial validation:** Throws at construction if the store's initial value fails schema validation. This ensures `get()` always returns a valid `T`.
