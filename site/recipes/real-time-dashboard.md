---
outline: deep
---

# How to Build a Real-Time Dashboard with Reactive State

Combine multiple data sources into derived metrics with diamond-safe updates and atomic batching.

## The Problem

Real-time dashboards need:
- **Multiple data sources** updating independently
- **Derived metrics** that stay consistent (no partial updates)
- **Efficient updates** — recalculate only what changed
- **Atomic writes** — update multiple sources without intermediate renders

## The Solution

callbag-recharge's `derived()` handles the hard part: when multiple sources update, derived metrics recompute exactly once with consistent values. `batch()` makes multi-source updates atomic.

<<< @/../examples/real-time-dashboard.ts

## Why This Works

1. **Diamond resolution** — `healthStatus` depends on `errorRate` which depends on `errorCount` and `requestsPerSec`. When both update in a `batch()`, `healthStatus` computes once, not twice, with correct values.

2. **`batch()`** — groups `set()` calls. DIRTY signals propagate immediately, but values flow only when the batch ends. No intermediate states.

3. **Layered derivations** — `errorRate` derives from raw counts; `healthStatus` derives from `errorRate` + `responseTimeMs`; `dashboardSummary` aggregates everything. Each layer is cached and recomputes only when its specific deps change.

4. **`effect()`** — runs side effects (logging, WebSocket push, DOM update) only when the derived metric actually changes.

## Framework Integration

### React

```ts
function useStore<T>(store: Store<T>): T {
  const [value, setValue] = useState(store.get())
  useEffect(() => subscribe(store, setValue), [store])
  return value
}

function Dashboard() {
  const summary = useStore(dashboardSummary)
  return <div className={`status-${summary.status}`}>
    <span>{summary.users} users</span>
    <span>{summary.rps} rps</span>
    <span>{summary.errorRate} errors</span>
  </div>
}
```

### Streaming to Browser via SSE

```ts
import { toSSE } from 'callbag-recharge/adapters'

app.get('/dashboard/stream', (req, res) => {
  toSSE(dashboardSummary, { response: res })
})
```

## See Also

- [Data Pipeline](./data-pipeline) — ETL with composable operators
- [Cron Pipeline](./cron-pipeline) — scheduled data aggregation
