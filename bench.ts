import { state, derived, pipe, map, filter, effect } from './src/index';

function bench(name: string, fn: () => void, iterations = 100_000) {
  // Warmup
  for (let i = 0; i < 1000; i++) fn();

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
bench('state read', () => {
  count();
});

bench('state write', () => {
  count.set(Math.random());
});

// 2. Derived (auto-tracking) — read after dep change
const a = state(0);
const b = state(0);
const sum = derived(() => a() + b());
bench('derived read (cached)', () => {
  sum();
});

let di = 0;
bench('derived recompute', () => {
  a.set(di++);
  sum();
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
bench('pipe (3 operators) propagate', () => {
  src.set(pi++);
});

bench('pipe (3 operators) read', () => {
  piped();
});

// 4. Effect re-run
const trigger = state(0);
let effectRuns = 0;
effect(() => {
  trigger();
  effectRuns++;
});

let ei = 0;
bench('effect re-run', () => {
  trigger.set(ei++);
});

// 5. Subscriber fan-out (1 state, 10 subscribers)
const fanSrc = state(0);
for (let i = 0; i < 10; i++) {
  fanSrc.subscribe(() => {});
}

let fi = 0;
bench('fan-out (10 subscribers)', () => {
  fanSrc.set(fi++);
});

// 6. Diamond pattern: A -> B, A -> C, B+C -> D
const dA = state(0);
const dB = derived(() => dA() + 1);
const dC = derived(() => dA() * 2);
const dD = derived(() => dB() + dC());

let ddi = 0;
bench('diamond (A->B,C->D) propagate+read', () => {
  dA.set(ddi++);
  dD();
});

console.log('\n--- Memory ---');
const before = process.memoryUsage();
const stores: any[] = [];
for (let i = 0; i < 10_000; i++) {
  stores.push(state(i));
}
const after = process.memoryUsage();
const perStore = (after.heapUsed - before.heapUsed) / 10_000;
console.log(`10,000 state stores: ~${perStore.toFixed(0)} bytes/store`);
console.log(
  `Heap delta: ${((after.heapUsed - before.heapUsed) / 1024).toFixed(0)} KB`,
);
