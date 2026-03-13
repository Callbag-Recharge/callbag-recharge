import { derived, effect, filter, map, pipe, state, stream, subscribe } from "./src/index";

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

// 2. Derived (no cache — always recomputes)
const a = state(0);
const b = state(0);
const sum = derived(() => a.get() + b.get());
bench("derived.get() (always recomputes)", () => {
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
effect(() => {
	trigger.get();
	_effectRuns++;
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
const dB = derived(() => dA.get() + 1);
const dC = derived(() => dA.get() * 2);
const dD = derived(() => dB.get() + dC.get());
let ddi = 0;
bench("diamond (A->B,C->D) set + get", () => {
	dA.set(ddi++);
	dD.get();
});

// 7. Pull-based stream
let pullCount = 0;
const pullable = stream<number>((emit, request) => {
	request(() => emit(++pullCount));
});
pullable.source(0, () => {});
bench("stream.pull() + get()", () => {
	pullable.pull();
	pullable.get();
});

console.log("\n--- Memory ---");
const before = process.memoryUsage();
const stores: any[] = [];
for (let i = 0; i < 10_000; i++) stores.push(state(i));
const after = process.memoryUsage();
const perStore = (after.heapUsed - before.heapUsed) / 10_000;
console.log(`10,000 state stores: ~${perStore.toFixed(0)} bytes/store`);
console.log(`Heap delta: ${((after.heapUsed - before.heapUsed) / 1024).toFixed(0)} KB`);
