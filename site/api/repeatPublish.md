# repeatPublish()

Publish messages to a topic on a recurring schedule.

## Signature

```ts
function repeatPublish<T>(
	topicRef: Topic<T>,
	valueOrFactory: T | (() => T),
	opts: RepeatPublishOptions,
): RepeatHandle
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `topicRef` | `Topic&lt;T&gt;` | The topic to publish to. |
| `valueOrFactory` | `T | (() =&gt; T)` | A fixed value or factory function that returns a new value each time. |
| `opts` | `RepeatPublishOptions` | Scheduling configuration. |

## Returns

`RepeatHandle` — `cancel()` to stop, `count` store for reactive tracking.

## Basic Usage

```ts
// Publish every 5 seconds
const handle = repeatPublish(myTopic, () => ({ type: 'heartbeat', ts: Date.now() }), {
    every: 5000,
    limit: 100,
  });

// Publish on cron schedule
const handle = repeatPublish(myTopic, { type: 'daily-report' }, {
    cron: '0 9 * * *', // 9am daily
  });

// Cancel
handle.cancel();
```

## Options / Behavior Details

- **Interval mode:** Set `every` to publish at fixed intervals (ms).
- **Cron mode:** Set `cron` to publish on a cron schedule. Uses the library's built-in
cron parser (`parseCron`/`matchesCron`). Checks every 60s by default.
- **Limit:** Set `limit` to stop after N publications. 0 = unlimited.
- **Dedup:** Set `dedupKey` to prevent duplicate publications within the topic's dedup window.
