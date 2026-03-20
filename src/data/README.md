# Data

Reactive data structures built on core primitives. Version-gated pattern: `state<number>` version counter bumped on structural changes, with lazy `derived` stores for reactive views.

- `reactiveMap` — reactive key-value store with select, TTL, eviction, namespaces
- `reactiveLog` — append-only log with circular buffer for bounded mode
- `reactiveIndex` — dual-key secondary index with O(1) reverse lookups
- `pubsub` — topic-based publish/subscribe with lazy topic creation

All implement `NodeV0` interface (`id`, `version`, `snapshot()`).

Imports from `core/` and `utils/` only.
