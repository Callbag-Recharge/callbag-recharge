---
outline: deep
---

# Comparisons

How callbag-recharge compares to other tools. Each comparison focuses on concrete differences — not opinions.

## State Management

| | **callbag-recharge** | [vs Zustand](./zustand) | [vs Jotai](./jotai) | [vs RxJS](./rxjs) |
|---|---|---|---|---|
| Core model | Reactive state graph | Single store | Atomic | Observable streams |
| Diamond resolution | Glitch-free | None | Glitchy | Not applicable |
| Streaming operators | 70+ | None | None | 200+ |
| Framework | Framework-agnostic | React-first | React-first | Framework-agnostic |

## Workflow & Orchestration

| | **callbag-recharge** | [vs Airflow](./airflow) | [vs n8n](./n8n) | [vs LangGraph.js](./langgraph) | [vs Vercel AI SDK](./vercel-ai-sdk) |
|---|---|---|---|---|---|
| Language | TypeScript | Python | JSON/UI | TypeScript | TypeScript |
| Runs in browser | Yes | No | No | No | Partial |
| Reactive | Yes (push-based) | No (polling) | No (webhook) | No (state dict) | Partial (hooks) |
| Human-in-loop | Yes (`gate()`) | Yes | Yes | Yes (interrupt) | No |
