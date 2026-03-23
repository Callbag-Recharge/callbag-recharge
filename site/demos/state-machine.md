---
layout: doc
---

# State Machine Visualizer

Interactive order workflow FSM with typed transitions, guards, and diagram export.

**Try it:** Click the event buttons to drive the order through its lifecycle. The graph highlights the current state and available transitions. View the auto-generated Mermaid diagram.

<ClientOnly>
  <StateMachine />
</ClientOnly>

## What it demonstrates

| Primitive | Module | Role |
|-----------|--------|------|
| `stateMachine` | `utils` | Declarative FSM with state-centric transitions |
| `derived` | `core` | Available events from current state |
| `toMermaid()` | `utils` | Auto-generated state diagram |
| `useSubscribe` | `compat/vue` | Bridge stores to Vue refs |

## How it works

`stateMachine()` uses a declarative, state-centric config — each state declares its `on` map with target states, guards, and actions. This makes the graph intrinsic to the config: `toMermaid()` and `toD2()` serialize it directly.

Guards reject transitions based on context (e.g., "can't cancel after payment"). Actions update context on transition (e.g., record payment timestamp). `onEnter`/`onExit` hooks run lifecycle logic.

`transitions` returns the raw edge list — the Vue component uses it to render the SVG graph.

All tree-shakeable. Zero framework lock-in.
