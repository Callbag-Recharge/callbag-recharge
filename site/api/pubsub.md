# pubsub()

Creates a lightweight topic-based publish/subscribe channel.

## Signature

```ts
function pubsub<T = unknown>(opts?: { id?: string }): PubSub<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `{ id?: string }` | Optional configuration. |

## Returns

`PubSub&lt;T&gt;` — topic publish/subscribe API with snapshot and lifecycle methods.

## Basic Usage

```ts
import { pubsub } from "callbag-recharge/data";

const bus = pubsub<string>();
const chat = bus.subscribe("chat");

bus.publish("chat", "hello");
chat.get(); // "hello"
```

## Options / Behavior Details

- **Lazy channels:** Topics are created on first publish/subscribe.
- **Reactive subscription:** `subscribe(topic)` returns a read-only store for latest topic value.
- **Ephemeral emission semantics:** Message updates always emit, even for referentially equal values.

## See Also

- [topic](/api/topic)
- [subscription](/api/subscription)
- [reactiveMap](./reactiveMap)
