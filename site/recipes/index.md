---
outline: deep
---

# Recipes

Practical patterns that show how to solve real problems with callbag-recharge. Each recipe is a self-contained example you can copy into your project.

## Streaming & Async

| Recipe | What it shows |
|--------|--------------|
| [AI Chat with Streaming](./ai-chat-streaming) | producer + switchMap + scan for streaming LLM responses with auto-cancellation |

## State Management

| Recipe | What it shows |
|--------|--------------|
| [createStore (Zustand Migration)](./zustand-migration) | Zustand-compatible API with diamond-safe selectors and push-phase memoization |

## Coming Soon

- **Reactive Data Pipeline** — fromAsyncIter + operators for ETL
- **Real-time Dashboard** — fromEvent + combine + throttle
- **Form Validation** — derived + debounce + effect
- **Cron Pipeline** — fromCron + exhaustMap + retry (Airflow-in-TypeScript)
