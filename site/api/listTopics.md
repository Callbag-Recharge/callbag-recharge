# listTopics()

List information about a set of topics.

## Signature

```ts
function listTopics(topics: Record<string, Topic<any>> | Topic<any>[]): TopicInfo[]
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `topics` | `Record&lt;string, Topic&lt;any&gt;&gt; | Topic&lt;any&gt;[]` | Map of name → topic instance (or array of topics). |

## Returns

Array of `TopicInfo` snapshots.
