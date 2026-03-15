import { derived, effect, operator, pipe, producer, state } from "./src/index";
import { filter } from "./src/extra/filter";
import { map } from "./src/extra/map";
import { subscribe } from "./src/extra/subscribe";

function bench(name: string, fn: () => void, iterations = 100_000) {
	for (let i = 0; i < 1000; i++) fn(); // warmup
	const start = performance.now();
	for (let i = 0; i < iterations; i++) fn();
	const elapsed = performance.now() - start;
	const opsPerSec = (iterations / elapsed) * 1000;
	console.log(
		`${name}: ${elapsed.toFixed(1)}ms for ${iterations.toLocaleString()} ops (${(opsPerSec / 1_000_000).toFixed(2)}M ops/sec)`,
	);
}

// 1. State read/write
const count = state(0);
bench("state.get()", () => {
	count.get();
});
bench("state.set()", () => {
	count.set(Math.random());
});

// 2. Derived (explicit deps)
const a = state(0);
const b = state(0);
const sum = derived([a, b], () => a.get() + b.get());
bench("derived.get() (cached, no dep change)", () => {
	sum.get();
});

let di = 0;
bench("derived.get() after dep change", () => {
	a.set(di++);
	sum.get();
});

// 3. Pipe operators
const src = state(0);
const piped = pipe(
	src,
	map((n) => n * 2),
	filter((n) => n > 0),
	map((n) => n + 1),
);
let pi = 0;
bench("pipe (3 ops) set + get", () => {
	src.set(pi++);
	piped.get();
});

bench("pipe (3 ops) get only", () => {
	piped.get();
});

// 4. Effect re-run
const trigger = state(0);
let _effectRuns = 0;
effect([trigger], () => {
	trigger.get();
	_effectRuns++;
	return undefined;
});
let ei = 0;
bench("effect re-run", () => {
	trigger.set(ei++);
});

// 5. Fan-out (1 state, 10 subscribers)
const fanSrc = state(0);
for (let i = 0; i < 10; i++) subscribe(fanSrc, () => {});
let fi = 0;
bench("fan-out (10 subscribers)", () => {
	fanSrc.set(fi++);
});

// 6. Diamond: A -> B, A -> C, B+C -> D
const dA = state(0);
const dB = derived([dA], () => dA.get() + 1);
const dC = derived([dA], () => dA.get() * 2);
const dD = derived([dB, dC], () => dB.get() + dC.get());
let ddi = 0;
bench("diamond (A->B,C->D) set + get", () => {
	dA.set(ddi++);
	dD.get();
});

// 7. Producer emit + get
const prod = producer<number>(({ emit }) => {
	(prod as any)._emit = emit;
	return undefined;
}, { initial: 0 });
subscribe(prod, () => {}); // connect a sink to activate
let prodI = 0;
bench("producer emit + get", () => {
	(prod as any)._emit(prodI++);
	prod.get();
});

// 8. Operator (passthrough transform)
const opSrc = state(0);
const opStore = operator<number>([opSrc], (actions) => {
	return (_depIndex, type, data) => {
		if (type === 1) actions.emit(data * 2);
		else if (type === 3) actions.signal(data);
	};
}, { initial: 0 });
subscribe(opStore, () => {}); // connect
let opI = 0;
bench("operator (1 dep, transform) set + get", () => {
	opSrc.set(opI++);
	opStore.get();
});

console.log("\n--- Memory ---");
const before = process.memoryUsage();
const stores: any[] = [];
for (let i = 0; i < 10_000; i++) stores.push(state(i));
const after = process.memoryUsage();
const perStore = (after.heapUsed - before.heapUsed) / 10_000;
console.log(`10,000 state stores: ~${perStore.toFixed(0)} bytes/store`);
console.log(`Heap delta: ${((after.heapUsed - before.heapUsed) / 1024).toFixed(0)} KB`);
