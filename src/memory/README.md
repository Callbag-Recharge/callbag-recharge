# Memory

Agent memory primitives built on data structures. Push-based reactive memory with decay-scored eviction — no other agent memory system uses reactive/push-based state management.

- `memoryNode` — content + metadata + reactive score
- `collection` — bounded container with decay-scored eviction via `reactiveIndex` tag integration
- `decay` / `computeScore` — recency decay, importance, frequency scoring

Imports from `core/`, `utils/`, and `data/`.
