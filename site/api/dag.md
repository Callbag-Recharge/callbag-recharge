# dag()

Validate a task DAG for acyclicity and register edges with Inspector.
Throws if a cycle is detected.

## Signature

```ts
function dag(nodes: DagNode[]): DagResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `nodes` | `DagNode[]` |  |

## Basic Usage

```ts
const daily = fromCron('0 9 * * *');
const fetchBank = pipe(daily, exhaustMap(() => fromPromise(plaid.sync())));
const fetchCards = pipe(daily, exhaustMap(() => fromPromise(stripe.charges())));
const aggregate = derived([fetchBank, fetchCards], () => merge(...));

// Validate the DAG — throws if cycles exist
const { order } = dag([
    { store: daily, name: 'cron' },
    { store: fetchBank, deps: [daily], name: 'fetch-bank' },
    { store: fetchCards, deps: [daily], name: 'fetch-cards' },
    { store: aggregate, deps: [fetchBank, fetchCards], name: 'aggregate' },
  ]);
```
