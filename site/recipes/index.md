---
outline: deep
---

# Recipes

Practical patterns that show how to solve real problems with callbag-recharge. Each recipe is a self-contained example you can copy into your project.

## Orchestration

| Recipe | What it shows |
|--------|--------------|
| [Airflow-Style Pipeline](./airflow-pipeline) | pipeline + step + gate + route for declarative DAG workflows with retry, circuit breakers, and checkpointing |
| [Cron Pipeline](./cron-pipeline) | fromCron + exhaustMap + fromPromise for scheduled pipelines |

## Streaming & Async

| Recipe | What it shows |
|--------|--------------|
| [AI Chat with Streaming](./ai-chat-streaming) | producer + switchMap + scan for streaming LLM responses with auto-cancellation |
| [Reactive Data Pipeline](./data-pipeline) | fromIter/fromAsyncIter + pipe operators for streaming ETL |
| [Real-Time Dashboard](./real-time-dashboard) | state + derived + batch for diamond-safe metrics |

## Edge AI & LLM

| Recipe | What it shows |
|--------|--------------|
| [On-Device LLM Streaming](./on-device-llm-streaming) | fromAbortable + switchMap for Ollama/WebLLM token streams with auto-cancel |
| [Hybrid Cloud+Edge Routing](./hybrid-routing) | Confidence-based routing between local and cloud LLMs with fallback |
| [Tool Calls for Local LLMs](./tool-calls) | Reactive state machine for tool call lifecycle |

## State Management

| Recipe | What it shows |
|--------|--------------|
| [createStore (Zustand Migration)](./zustand-migration) | Zustand-compatible API with diamond-safe selectors and push-phase memoization |

## Migration Guides

| Guide | What it covers |
|-------|---------------|
| [From Zustand](./zustand-migration) | Drop-in compat layer + native API migration |
| [From Jotai](./jotai-migration) | atom() compat + diamond resolution benefits |
| [From Nanostores](./nanostores-migration) | atom/computed/map compat + per-key reactivity via reactiveMap |
