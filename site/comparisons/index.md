---
outline: deep
---

# Comparisons

How callbag-recharge compares to other tools. Each comparison focuses on concrete differences — not opinions.

## State Management

| | [vs Zustand](./zustand) | [vs Jotai](./jotai) | [vs RxJS](./rxjs) |
|---|---|---|---|
| Core model | Single store | Atomic | Observable streams |
| Diamond resolution | None | Glitchy | Not applicable |
| Streaming operators | None | None | 200+ |
| Framework | React-first | React-first | Framework-agnostic |

## Workflow & Orchestration

| | [vs Airflow](./airflow) | [vs n8n](./n8n) | [vs LangGraph.js](./langgraph) | [vs Vercel AI SDK](./vercel-ai-sdk) |
|---|---|---|---|---|
| Language | Python | JSON/UI | TypeScript | TypeScript |
| Runs in browser | No | No | No | Partial |
| Reactive | No (polling) | No (webhook) | No (state dict) | Partial (hooks) |
| Human-in-loop | Yes | Yes | Yes (interrupt) | No |
