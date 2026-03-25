# memoryStore()

Creates a three-tier memory store for AI/LLM applications.

## Signature

```ts
function memoryStore<T>(opts?: MemoryStoreOptions): MemoryStoreResult<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `MemoryStoreOptions` | Optional configuration for capacity and scoring. |

## Returns

`MemoryStoreResult&lt;T&gt;` — session, working, and long-term memory with cross-tier operations.

## Basic Usage

```ts
import { memoryStore } from 'callbag-recharge/ai/memoryStore';

const memory = memoryStore<string>({ workingCapacity: 10, longTermCapacity: 100 });

// Current conversation
memory.remember('User prefers TypeScript');

// Active reasoning context
memory.focus('Current task: refactor auth module', { tags: ['task'] });

// Persistent knowledge
memory.store('Project uses callbag-recharge for state', {
    tags: ['architecture'],
    importance: 0.9,
  });

// Cross-tier recall (touches nodes — updates access scores)
const relevant = memory.recall(5); // top 5 across all tiers
const tagged = memory.recallByTag('architecture');

// Read-only query (no touch — safe in derived computations)
const top3 = memory.query(3);

// New conversation
memory.resetSession(); // clears session, keeps working + long-term
```

## Options / Behavior Details

- **Session memory:** Unbounded, ephemeral. Cleared on `resetSession()`. For current conversation context.
- **Working memory:** Bounded (FIFO eviction). For active context window the agent is currently reasoning about.
- **Long-term memory:** Bounded (decay-scored eviction). For persistent knowledge across conversations.
- **Promotion:** `promote()` moves a memory from session/working to long-term, preserving metadata.
- **recall vs query:** `recall(k)` returns top-K and calls `touch()` on each (updating `accessCount`/`accessedAt`). `query(k)` returns the same ranking without touching — safe inside `derived` computations where side effects would inflate scores on every recomputation.
