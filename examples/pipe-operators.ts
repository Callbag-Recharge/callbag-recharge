/**
 * Pipe — compose operators into an inspectable store chain
 *
 * Each step in the pipe is a separate store you can .get() at any time.
 *
 * Run: npx tsx examples/pipe-operators.ts
 */
import { pipe, state } from "callbag-recharge";
import { filter, map, scan, subscribe } from "callbag-recharge/extra";

const input = state(0);

const result = pipe(
	input,
	map((n) => n * 2),
	filter((n) => n > 0),
	scan((acc, n) => acc + n, 0),
);

const unsub = subscribe(result, (value) => {
	console.log("accumulated:", value);
});

input.set(1); // accumulated: 2
input.set(2); // accumulated: 6  (2 + 4)
input.set(3); // accumulated: 12 (6 + 6)
input.set(0); // filtered out (0 * 2 = 0, not > 0)

unsub();
