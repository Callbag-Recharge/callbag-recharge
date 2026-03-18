# share()

Identity operator for API compatibility — stores are already multicast (shared by reference).

## Signature

```ts
function share<A>(): StoreOperator<A, A>
```

## Returns

`StoreOperator&lt;A, A&gt;` — returns the input store unchanged.
