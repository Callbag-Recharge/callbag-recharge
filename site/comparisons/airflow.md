---
outline: deep
---

# callbag-recharge vs Apache Airflow

Both orchestrate data pipelines with DAG semantics. callbag-recharge is lightweight, reactive, runs anywhere, and requires no infrastructure.

## At a Glance

| Feature | Airflow | callbag-recharge |
|---------|---------|-----------------|
| **Language** | Python | TypeScript |
| **Infrastructure** | Scheduler + Workers + DB + UI | None (runs in-process) |
| **Runs in browser** | No | Yes |
| **DAG definition** | Python decorators / YAML | `pipeline()` + `step()` — TypeScript |
| **Scheduling** | Built-in scheduler | `fromCron()` — zero-dep cron parser |
| **Execution model** | Polling (check DB) | Reactive (push-based) |
| **Persistence** | PostgreSQL/MySQL | `checkpoint()` — file, SQLite, IndexedDB |
| **Human-in-the-loop** | Manual approval sensor | `gate()` — native, reactive |
| **Monitoring** | Web UI + logs | `Inspector` + `executionLog()` + `toSSE()` |
| **Retry** | Task-level retry | `retry()`, `withRetry()` — composable |
| **Latency** | Seconds (polling + DB) | Microseconds (in-process, push) |

## The Key Difference

Airflow is a platform — you deploy it, manage it, and build on it. callbag-recharge is a library — `npm i @callbag-recharge/callbag-recharge` and compose pipelines in your existing TypeScript codebase.

```ts
// Airflow (Python)
@dag(schedule='0 9 * * *', start_date=datetime(2024, 1, 1))
def daily_pipeline():
    data = fetch_data()
    transformed = transform(data)
    save(transformed)

// callbag-recharge (TypeScript)
const daily = fromCron('0 9 * * *')
const data = pipe(daily, exhaustMap(() => fromPromise(fetchData())), retry(3))
const transformed = derived([data], () => transform(data.get()))
effect([transformed], () => save(transformed.get()))
```

## What Airflow Lacks

### 1. Browser / Edge execution

Airflow requires a server. callbag-recharge runs in the browser, edge runtimes, serverless functions, or your laptop.

### 2. Reactive execution

Airflow polls a database to check if tasks are ready. callbag-recharge pushes values through the graph — microsecond latency vs seconds.

### 3. TypeScript native

Airflow is Python. If your app is TypeScript, you maintain two stacks. callbag-recharge is your app language.

### 4. Composability

Airflow tasks are isolated Python functions. callbag-recharge steps are reactive stores — compose them with `derived()`, `pipe()`, `switchMap()`, and the full operator set.

## What Airflow Does Better

- **Battle-tested at scale** — production-proven for massive data pipelines (1000+ DAGs)
- **Rich UI** — web dashboard for DAG visualization, task logs, trigger management
- **Ecosystem** — 1000+ pre-built operators (AWS, GCP, Spark, Kubernetes, etc.)
- **Multi-team coordination** — RBAC, connection management, variable store
- **Distributed execution** — Celery/Kubernetes executors for horizontal scaling

## When to Choose callbag-recharge

- Your pipeline is part of a TypeScript application (not a standalone data platform)
- You need browser-side or edge execution
- You want reactive (push-based) execution, not polling
- Infrastructure overhead of Airflow is too high for your use case
- You need human-in-the-loop (`gate()`) or real-time monitoring (`toSSE()`)
- Your pipeline has < 100 steps and doesn't need distributed execution
