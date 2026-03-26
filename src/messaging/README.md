# Messaging

Pulsar-inspired topic/subscription system with distributed bridging. Persistent message streams with cursor-based consumers, retry/DLQ, and transport-agnostic distribution.

```ts
import { topic, subscription, topicBridge, wsMessageTransport } from 'callbag-recharge/messaging';
```

---

## Quick Start

### Local topic + subscription

```ts
const events = topic<string>('events');

// Publish messages
events.publish('user.signup', { key: 'user-123' });
events.publish('user.login', { key: 'user-456' });

// Consume with cursor-based subscription
const sub = subscription(events, {
  name: 'processor',
  initialPosition: 'earliest',
});

const msgs = sub.pull(10);        // pull up to 10 messages
for (const msg of msgs) {
  console.log(msg.value, msg.key);
  sub.ack(msg.seq);               // acknowledge processing
}

// Reactive stores
subscribe(sub.backlog, (n) => console.log(`${n} messages unread`));
subscribe(sub.lag, (ms) => console.log(`${ms}ms behind`));

sub.destroy();
events.destroy();
```

### Distributed topics via bridge

Connect two processes over WebSocket — messages published on one side appear on the other:

```ts
// --- Process A ---
const transport = wsMessageTransport('ws://localhost:8080');
const orders = topic<Order>('orders');

const bridge = topicBridge(transport, {
  orders: { topic: orders },
});

orders.publish({ id: 1, item: 'widget' }); // forwarded to Process B

// --- Process B ---
const transport = wsMessageTransport('ws://localhost:8080');
const orders = topic<Order>('orders');

const bridge = topicBridge(transport, {
  orders: { topic: orders },
});

// orders.get(1) → { id: 1, item: 'widget' } — synced from A
```

---

## Core Concepts

### Topic

Persistent append-only message stream backed by `ReactiveLog`. Messages have sequence numbers, timestamps, optional keys, headers, and priority.

```ts
const t = topic<string>('logs', {
  maxSize: 10_000,          // circular buffer (oldest trimmed)
  ttl: 60_000,              // auto-expire messages older than 60s
});

t.publish('info', { key: 'server-1', headers: { level: 'info' } });
t.publish('error', { key: 'server-2', priority: 1 });

// Random access
const msg = t.get(42);         // by sequence number
const recent = t.slice(-10);   // last 10 messages
const next = t.peek();         // oldest unread
```

### Subscription

Cursor-based consumer with four modes:

| Mode | Behavior |
|------|----------|
| `exclusive` (default) | Independent cursor — each subscription reads all messages |
| `shared` | Same-name subscriptions share cursor, round-robin dispatch |
| `failover` | Same-name subscriptions share cursor, only one active consumer |
| `key_shared` | Same-name subscriptions share cursor, messages routed by partition key hash |

```ts
const sub = subscription(events, {
  mode: 'shared',
  name: 'workers',
  batchSize: 5,
  ackTimeout: 10_000,        // auto-nack after 10s
  retry: { maxRetries: 3 },  // retry with exponential backoff
  deadLetterTopic: dlq,      // route to DLQ after max retries
});
```

### TTL & Expiry

Topics with `ttl` automatically trim expired messages on the next publish:

```ts
const t = topic<string>('ephemeral', { ttl: 5000 });
t.publish('a');
// ... 6 seconds later ...
t.publish('b');  // triggers expiry of 'a'
t.expireMessages(); // or call manually
```

---

## Distribution

### MessageTransport

The `MessageTransport` interface is the abstraction for network communication. Two built-in implementations:

| Transport | Environment | Protocol |
|-----------|-------------|----------|
| `wsMessageTransport` | Browser + Node | WebSocket (JSON frames) |
| `h2MessageTransport` | Node only | HTTP/2 bidirectional stream (NDJSON) |

Both support auto-reconnect with exponential backoff and configurable send buffers:

```ts
const ws = wsMessageTransport('ws://remote:8080', {
  reconnect: true,
  reconnectDelay: 1000,
  maxReconnectDelay: 30_000,
  maxBufferSize: 1000,  // drop oldest if buffer exceeds limit while disconnected
});

subscribe(ws.status, (s) => console.log('Transport:', s)); // connecting → connected
```

### Custom Transport

Implement `MessageTransport` for any channel:

```ts
import type { MessageTransport, TransportEnvelope } from 'callbag-recharge/messaging';

function myTransport(): MessageTransport {
  const handlers = new Set<(e: TransportEnvelope) => void>();
  return {
    send(envelope) { /* serialize and send */ },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    status: state<TransportStatus>('connected'),
    close() { handlers.clear(); },
  };
}
```

### Topic Bridge

`topicBridge` connects local topics to a remote peer through a transport. Echo-dedup via `originId` prevents infinite loops in bidirectional setups.

```ts
const bridge = topicBridge(transport, {
  orders: { topic: ordersTopic },
  events: { topic: eventsTopic, filter: { keys: ['important'] } },
});

// Dynamic topic management
bridge.addTopic('logs', { topic: logsTopic });
bridge.removeTopic('logs');

// Backpressure: check if remote consumer is lagging
const bp = bridge.backpressure.get('orders');
if (bp?.get()) console.log('Remote is lagging on orders');

bridge.destroy(); // cleanup all subscriptions
```

### Message Filtering (SA-2e)

Filter which messages cross the bridge:

```ts
topicBridge(transport, {
  events: {
    topic: eventsTopic,
    filter: {
      keys: ['critical', 'alert'],                    // by partition key
      headers: { 'x-priority': 'high' },              // by header match
      predicate: (msg) => msg.value.score > 0.9,      // by content
    },
  },
});
```

---

## Admin & Observability

```ts
import { listTopics, inspectSubscription, resetCursor } from 'callbag-recharge/messaging';

// Inspect all topics
const info = listTopics({ orders: ordersTopic, events: eventsTopic });
// → [{ name, depth, headSeq, tailSeq, paused, publishCount }, ...]

// Inspect a subscription
const subInfo = inspectSubscription(sub);
// → { name, mode, position, backlog, pending, lag, paused }

// Reset cursor (e.g. replay from beginning)
resetCursor(sub, 'earliest');
resetCursor(sub, 42);  // specific sequence number
```

---

## Job Processing

For durable job processing built on topics, see `jobQueue` (single-queue processing with retry/DLQ) and `jobFlow` (multi-queue DAG chaining).

```ts
const queue = jobQueue<Task>(taskTopic, {
  concurrency: 5,
  processor: async (signal, job) => {
    await processTask(job.value, { signal });
  },
});
```
