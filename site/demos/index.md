---
outline: deep
---

# Demos

Interactive demos showcasing callbag-recharge primitives in action. Each demo is a self-contained Vue app backed by a pure TypeScript store — hover, click, and inspect real-time reactive state.

## Orchestration

| Demo | What it shows |
|------|--------------|
| [Airflow in TypeScript](./airflow) | `pipeline()` + `task()` DAG with circuit breakers, retry, and real-time node status |
| [Agent Loop](./agent-loop) | `agentLoop()` + `gate()` for observe → plan → act with human-in-the-loop approval |
| [Workflow Builder](/demos/workflow-builder.html) | Code-first DAG builder with template selection, node status visualization, and reactive execution logs |

## State & Forms

| Demo | What it shows |
|------|--------------|
| [Form Builder](./form-builder) | `formField()` with sync/async validation, dirty tracking, and derived aggregation |
| [Markdown Editor](/demos/markdown-editor.html) | Split-pane Markdown editor with live preview, reactive toolbar state, and autosave checkpoints |
| [State Machine](./state-machine) | `stateMachine()` with declarative transitions, SVG graph, and Mermaid export |

## Data & Monitoring

| Demo | What it shows |
|------|--------------|
| [Real-time Dashboard](./realtime-dashboard) | `reactiveMap()` + `reactiveLog()` + `derived()` for live service metrics |

## Compatibility

| Demo | What it shows |
|------|--------------|
| [Compat Comparison](./compat-comparison) | Same counter in 4 APIs — native, Jotai, Zustand, and TC39 Signals |
