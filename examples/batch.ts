/**
 * Batching — multiple set() calls coalesce into one recomputation
 *
 * Run: npx tsx examples/batch.ts
 */
import { batch, derived, effect, state } from "callbag-recharge";

const a = state(1);
const b = state(2);
const sum = derived([a, b], () => a.get() + b.get());

let runs = 0;
const dispose = effect([sum], () => {
	runs++;
	console.log(`sum = ${sum.get()} (effect run #${runs})`);
	return undefined;
});

// Without batch: effect would run twice (once per set)
// With batch: effect runs once after both sets complete
batch(() => {
	a.set(10);
	b.set(20);
});
// logs: "sum = 30 (effect run #2)" — only one recomputation

dispose();
