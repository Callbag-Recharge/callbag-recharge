# rawSkip()

Raw callbag operator that ignores the first `n` DATA emissions from `source`,
then forwards the rest. Operates at the pure callbag protocol level (type 0/1/2)
— no Store or STATE (type 3) handling.

Intended for use with `firstValueFrom` when you need to wait for the *next*
emission from a source that has already emitted an initial value:

```ts
await firstValueFrom(rawSkip(1)(store.source));
```

For Store-aware skipping (with DIRTY/RESOLVED graph consistency), use
`extra/skip` instead.

## Signature

```ts
function rawSkip(n: number): (source: CallbagSource) => CallbagSource
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `n` | `number` | Number of initial DATA emissions to drop. |

## Returns

A function `(source: CallbagSource) =&gt; CallbagSource`.
