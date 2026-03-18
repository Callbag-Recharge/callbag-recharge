/**
 * Basic reactive counter — state + derived + effect
 *
 * Run: npx tsx examples/counter.ts
 */
import { derived, effect, state } from "callbag-recharge";

const count = state(0);
const doubled = derived([count], () => count.get() * 2);

const dispose = effect([doubled], () => {
	console.log("doubled:", doubled.get());
	return undefined;
});

count.set(1); // logs: "doubled: 2"
count.set(5); // logs: "doubled: 10"

dispose();
