/**
 * Diamond dependency graph — derived computes exactly once
 *
 *     base
 *    /    \
 * doubled  tripled
 *    \    /
 *     sum
 *
 * Run: npx tsx examples/diamond.ts
 */
import { derived, effect, state } from "callbag-recharge";

const base = state(1);
const doubled = derived([base], () => base.get() * 2);
const tripled = derived([base], () => base.get() * 3);
const sum = derived([doubled, tripled], () => doubled.get() + tripled.get());

let computeCount = 0;
const dispose = effect([sum], () => {
	computeCount++;
	console.log(`sum = ${sum.get()} (effect ran ${computeCount} time(s))`);
	return undefined;
});

base.set(2); // sum = 10 (effect ran 2 times) — once for init, once for update
base.set(3); // sum = 15 (effect ran 3 times) — still one computation per update

dispose();
