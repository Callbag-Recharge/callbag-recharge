---
layout: doc
---

# Real-time Dashboard

Live metrics with reactive data structures — per-service aggregation, event streaming, health classification.

**Try it:** Click Start to begin the simulation. Watch service cards update with live latency, error rates, and request counts. Events stream into the tail log.

<ClientOnly>
  <RealtimeDashboard />
</ClientOnly>

## What it demonstrates

| Primitive | Module | Role |
|-----------|--------|------|
| `reactiveMap` | `data` | Per-service metrics with TTL auto-expiry |
| `reactiveLog` | `data` | Bounded event stream (last 100 events) |
| `derived` | `core` | Health summary aggregation |
| `useSubscribe` | `compat/vue` | Bridge stores to Vue refs |

## How it works

`reactiveMap` stores per-service metrics with 30s TTL — stale services auto-expire. `reactiveLog` maintains a bounded circular buffer of metric events. `derived` views compute health summaries (healthy/warning/critical) from the map's current state.

The simulation uses `setInterval` to inject random metric events. `reactiveLog.tail(10)` provides the last 10 events as a reactive store.

All tree-shakeable. Zero framework lock-in.
