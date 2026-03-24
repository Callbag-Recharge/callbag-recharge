---
layout: doc
---

# Agent Loop

Observe → Plan → Act cycle with human-in-the-loop approval gate.

**Try it:** Enter a question and click Start. The agent observes context, plans an action, then pauses for your approval. Approve, reject, or modify the action before it executes.

<ClientOnly>
  <AgentLoop />
</ClientOnly>

## What it demonstrates

| Primitive | Module | Role |
|-----------|--------|------|
| `agentLoop` | `ai/agentLoop` | Reactive observe → plan → act loop |
| `gate` | `orchestrate` | Human-in-the-loop approval queue |
| `useSubscribe` | `compat/vue` | Bridge stores to Vue refs |

## How it works

`agentLoop()` cycles through three async phases. When `gate: true`, the loop pauses at `awaiting_approval` after the plan phase. The planned action is queued — `approve()` forwards it to act, `reject()` discards it, `modify()` transforms it.

All state (phase, context, history, pending actions) is exposed as reactive `Store<T>` instances. The Vue component subscribes via `useSubscribe()` — no polling, no manual state sync.

All tree-shakeable. Zero framework lock-in.
