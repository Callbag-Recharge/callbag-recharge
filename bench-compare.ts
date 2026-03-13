// ---------------------------------------------------------------------------
// Head-to-head benchmark: callbag-recharge vs @preact/signals-core vs callbag
// ---------------------------------------------------------------------------

import { computed, signal, effect as signalEffect } from "@preact/signals-core";
import cbFilter from "callbag-filter";
import cbMap from "callbag-map";
// callbag imports
import cbPipe from "callbag-pipe";
import cbSubscribe from "callbag-subscribe";
import {
	derived,
	effect as rechargeEffect,
	filter as rFilter,
	map as rMap,
	pipe as rPipe,
	subscribe as rSubscribe,
	state,
} from "./src/index";

function bench(name: string, fn: () => void, iterations = 100_000) {
	for (let i = 0; i < 1000; i++) fn();
	const start = performance.now();
	for (let i = 0; i < iterations; i++) fn();
	const elapsed = performance.now() - start;
	const opsPerSec = (iterations / elapsed) * 1000;
	return { name, elapsed, opsPerSec };
}

function printGroup(
	title: string,
	results: Array<{ name: string; elapsed: number; opsPerSec: number }>,
) {
	console.log(`\n## ${title}`);
	console.log("| Library | ops/sec | time |");
	console.log("|---|---|---|");
	const sorted = results.sort((a, b) => b.opsPerSec - a.opsPerSec);
	for (const r of sorted) {
		const ops =
			r.opsPerSec >= 1_000_000
				? `${(r.opsPerSec / 1_000_000).toFixed(1)}M`
				: `${(r.opsPerSec / 1_000).toFixed(0)}K`;
		console.log(`| ${r.name} | ${ops} | ${r.elapsed.toFixed(1)}ms |`);
	}
}

// ============================================================
// 1. State read
// ============================================================
{
	const pSignal = signal(0);
	const rState = state(0);

	printGroup("State read", [
		bench("Preact signal()", () => {
			pSignal.value;
		}),
		bench("Recharge state.get()", () => {
			rState.get();
		}),
	]);
}

// ============================================================
// 2. State write (no subscribers)
// ============================================================
{
	const pSignal = signal(0);
	const rState = state(0);

	printGroup("State write (no subscribers)", [
		bench("Preact signal.value =", () => {
			pSignal.value = Math.random();
		}),
		bench("Recharge state.set()", () => {
			rState.set(Math.random());
		}),
	]);
}

// ============================================================
// 3. Computed/derived read (after dep change)
// ============================================================
{
	const pA = signal(0);
	const pB = signal(0);
	const pSum = computed(() => pA.value + pB.value);
	let pi = 0;

	const rA = state(0);
	const rB = state(0);
	const rSum = derived(() => rA.get() + rB.get());
	let ri = 0;

	printGroup("Computed read after dep change", [
		bench("Preact computed", () => {
			pA.value = pi++;
			pSum.value;
		}),
		bench("Recharge derived", () => {
			rA.set(ri++);
			rSum.get();
		}),
	]);
}

// ============================================================
// 4. Computed/derived read (no change — cached vs recompute)
// ============================================================
{
	const pA = signal(5);
	const pSum = computed(() => pA.value * 2);
	pSum.value; // prime cache

	const rA = state(5);
	const rSum = derived(() => rA.get() * 2);

	printGroup("Computed read (unchanged deps)", [
		bench("Preact computed (cached)", () => {
			pSum.value;
		}),
		bench("Recharge derived (recomputes)", () => {
			rSum.get();
		}),
	]);
}

// ============================================================
// 5. Diamond: A -> B, A -> C, B+C -> D
// ============================================================
{
	const pA = signal(0);
	const pB = computed(() => pA.value + 1);
	const pC = computed(() => pA.value * 2);
	const pD = computed(() => pB.value + pC.value);
	let pi = 0;

	const rA = state(0);
	const rB = derived(() => rA.get() + 1);
	const rC = derived(() => rA.get() * 2);
	const rD = derived(() => rB.get() + rC.get());
	let ri = 0;

	printGroup("Diamond (A→B,C→D) write + read", [
		bench("Preact signals", () => {
			pA.value = pi++;
			pD.value;
		}),
		bench("Recharge stores", () => {
			rA.set(ri++);
			rD.get();
		}),
	]);
}

// ============================================================
// 6. Effect re-run
// ============================================================
{
	const pTrigger = signal(0);
	let _pRuns = 0;
	signalEffect(() => {
		pTrigger.value;
		_pRuns++;
	});
	let pi = 0;

	const rTrigger = state(0);
	let _rRuns = 0;
	rechargeEffect(() => {
		rTrigger.get();
		_rRuns++;
	});
	let ri = 0;

	printGroup("Effect re-run", [
		bench("Preact effect", () => {
			pTrigger.value = pi++;
		}),
		bench("Recharge effect", () => {
			rTrigger.set(ri++);
		}),
	]);
}

// ============================================================
// 7. Pipe: 3 operators (map → filter → map)
// ============================================================
{
	// Recharge: pipe with operators
	const rSrc = state(0);
	const rPiped = rPipe(
		rSrc,
		rMap((n) => n * 2),
		rFilter((n) => n > 0),
		rMap((n) => (n ?? 0) + 1),
	);
	let ri = 0;

	// Callbag: push-based source that emits values
	let _cbResult = 0;
	let cbEmitter: ((v: number) => void) | null = null;
	const cbSource = (start: number, sink: any) => {
		if (start !== 0) return;
		const talkback = (_t: number) => {};
		sink(0, talkback);
		cbEmitter = (v: number) => sink(1, v);
	};

	cbPipe(
		cbSource,
		cbMap((n: number) => n * 2),
		cbFilter((n: number) => n > 0),
		cbMap((n: number) => n + 1),
		cbSubscribe((v: number) => {
			_cbResult = v;
		}),
	);

	let ci = 1;
	printGroup("Pipe (3 operators) push through", [
		bench("Recharge pipe", () => {
			rSrc.set(ri++);
			rPiped.get();
		}),
		bench("Callbag pipe", () => {
			cbEmitter?.(ci++);
		}),
	]);
}

// ============================================================
// 8. Subscribe/fan-out (10 subscribers)
// ============================================================
{
	const pSrc = signal(0);
	for (let i = 0; i < 10; i++)
		signalEffect(() => {
			pSrc.value;
		});
	let pi = 0;

	const rSrc = state(0);
	for (let i = 0; i < 10; i++) rSubscribe(rSrc, () => {});
	let ri = 0;

	printGroup("Fan-out (10 subscribers)", [
		bench("Preact 10 effects", () => {
			pSrc.value = pi++;
		}),
		bench("Recharge 10 subscribe", () => {
			rSrc.set(ri++);
		}),
	]);
}

// ============================================================
// 9. Memory per store
// ============================================================
console.log("\n## Memory per store (10,000 stores)");
console.log("| Library | bytes/store | heap delta |");
console.log("|---|---|---|");

{
	global.gc?.();
	const before = process.memoryUsage();
	const stores: any[] = [];
	for (let i = 0; i < 10_000; i++) stores.push(signal(i));
	const after = process.memoryUsage();
	const perStore = (after.heapUsed - before.heapUsed) / 10_000;
	console.log(
		`| Preact signal | ~${perStore.toFixed(0)} | ${((after.heapUsed - before.heapUsed) / 1024).toFixed(0)} KB |`,
	);
	stores.length = 0; // allow GC
}

{
	global.gc?.();
	const before = process.memoryUsage();
	const stores: any[] = [];
	for (let i = 0; i < 10_000; i++) stores.push(state(i));
	const after = process.memoryUsage();
	const perStore = (after.heapUsed - before.heapUsed) / 10_000;
	console.log(
		`| Recharge state | ~${perStore.toFixed(0)} | ${((after.heapUsed - before.heapUsed) / 1024).toFixed(0)} KB |`,
	);
	stores.length = 0;
}
