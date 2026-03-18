import { computed, signal, effect as signalEffect } from "@preact/signals-core";
import cbFilter from "callbag-filter";
import cbMap from "callbag-map";
import cbPipe from "callbag-pipe";
import cbSubscribe from "callbag-subscribe";
import { afterAll, beforeAll, bench, describe } from "vitest";
import { filter as rFilter } from "../extra/filter";
import { map as rMap } from "../extra/map";
import { pipeRaw } from "../extra/pipeRaw";
import { subscribe as rSubscribe } from "../extra/subscribe";
import {
	batch,
	derived,
	Inspector,
	operator,
	producer,
	effect as rechargeEffect,
	pipe as rPipe,
	state,
} from "../index";

describe("compare: state read", () => {
	const pSignal = signal(0);
	const rState = state(0);
	bench("Preact signal()", () => {
		pSignal.value;
	});
	bench("Recharge state.get()", () => {
		rState.get();
	});
});

describe("compare: state write (no subscribers)", () => {
	const pSignal = signal(0);
	const rState = state(0);
	bench("Preact signal.value =", () => {
		pSignal.value = Math.random();
	});
	bench("Recharge state.set()", () => {
		rState.set(Math.random());
	});
});

describe("compare: computed read after dep change", () => {
	const pA = signal(0);
	const pB = signal(0);
	const pSum = computed(() => pA.value + pB.value);
	let pi = 0;
	const rA = state(0);
	const rB = state(0);
	const rSum = derived([rA, rB], () => rA.get() + rB.get());
	let ri = 0;
	bench("Preact computed", () => {
		pA.value = pi++;
		pSum.value;
	});
	bench("Recharge derived", () => {
		rA.set(ri++);
		rSum.get();
	});
});

describe("compare: computed read (unchanged deps)", () => {
	const pA = signal(5);
	const pSum = computed(() => pA.value * 2);
	pSum.value;
	const rA = state(5);
	const rSum = derived([rA], () => rA.get() * 2);
	bench("Preact computed (cached)", () => {
		pSum.value;
	});
	bench("Recharge derived (recomputes)", () => {
		rSum.get();
	});
});

describe("compare: diamond", () => {
	const pA = signal(0);
	const pB = computed(() => pA.value + 1);
	const pC = computed(() => pA.value * 2);
	const pD = computed(() => pB.value + pC.value);
	let pi = 0;
	const rA = state(0);
	const rB = derived([rA], () => rA.get() + 1);
	const rC = derived([rA], () => rA.get() * 2);
	const rD = derived([rB, rC], () => rB.get() + rC.get());
	let ri = 0;
	bench("Preact signals", () => {
		pA.value = pi++;
		pD.value;
	});
	bench("Recharge stores", () => {
		rA.set(ri++);
		rD.get();
	});
});

describe("compare: effect re-run", () => {
	const pTrigger = signal(0);
	signalEffect(() => {
		pTrigger.value;
	});
	let pi = 0;
	const rTrigger = state(0);
	rechargeEffect([rTrigger], () => {
		rTrigger.get();
		return undefined;
	});
	let ri = 0;
	bench("Preact effect", () => {
		pTrigger.value = pi++;
	});
	bench("Recharge effect", () => {
		rTrigger.set(ri++);
	});
});

describe("compare: producer emit + get", () => {
	const pSignal = signal(0);
	signalEffect(() => {
		pSignal.value;
	});
	let pi = 0;
	const rProd = producer<number>(
		({ emit }) => {
			(rProd as { _emit?: (n: number) => void })._emit = emit;
			return undefined;
		},
		{ initial: 0 },
	);
	rSubscribe(rProd, () => {});
	let ri = 0;
	bench("Preact signal.value =", () => {
		pSignal.value = pi++;
	});
	bench("Recharge producer.emit()", () => {
		(rProd as { _emit?: (n: number) => void })._emit!(ri++);
		rProd.get();
	});
});

describe("compare: operator vs Preact computed", () => {
	const pA = signal(0);
	const pDerived = computed(() => pA.value * 2);
	signalEffect(() => {
		pDerived.value;
	});
	let pi = 0;
	const rA = state(0);
	const rOp = operator<number>(
		[rA],
		(actions) => {
			return (_depIndex, type, data) => {
				if (type === 1) actions.emit(data * 2);
				else if (type === 3) actions.signal(data);
			};
		},
		{ initial: 0 },
	);
	rSubscribe(rOp, () => {});
	let ri = 0;
	bench("Preact computed", () => {
		pA.value = pi++;
		pDerived.value;
	});
	bench("Recharge operator", () => {
		rA.set(ri++);
		rOp.get();
	});
});

describe("compare: pipe 3 operators", () => {
	const rSrc = state(0);
	const rPiped = rPipe(
		rSrc,
		rMap((n) => n * 2),
		rFilter((n) => n > 0),
		rMap((n) => (n ?? 0) + 1),
	);
	let ri = 0;
	let _cbResult = 0;
	let cbEmitter: ((v: number) => void) | null = null;
	const cbSource = (start: number, sink: (t: number, d?: unknown) => void) => {
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
	bench("Recharge pipe", () => {
		rSrc.set(ri++);
		rPiped.get();
	});
	bench("Callbag pipe", () => {
		cbEmitter?.(ci++);
	});
});

describe("compare: fan-out 10 subscribers", () => {
	const pSrc = signal(0);
	for (let i = 0; i < 10; i++)
		signalEffect(() => {
			pSrc.value;
		});
	let pi = 0;
	const rSrc = state(0);
	for (let i = 0; i < 10; i++) rSubscribe(rSrc, () => {});
	let ri = 0;
	bench("Preact 10 effects", () => {
		pSrc.value = pi++;
	});
	bench("Recharge 10 subscribe", () => {
		rSrc.set(ri++);
	});
});

// Short time budget: each run allocates a new store — avoids unbounded heap/GC vs default ~500ms bench window.
const _inspectorStoreCreationTimeMs = 200;

describe("compare: Inspector ON (store creation)", () => {
	beforeAll(() => {
		Inspector.enabled = true;
	});
	bench(
		"Recharge state",
		() => {
			state(0);
		},
		{ time: _inspectorStoreCreationTimeMs },
	);
});

describe("compare: Inspector OFF (store creation)", () => {
	beforeAll(() => {
		Inspector.enabled = false;
	});
	bench(
		"Recharge state",
		() => {
			state(0);
		},
		{ time: _inspectorStoreCreationTimeMs },
	);
	afterAll(() => {
		Inspector.enabled = true;
	});
});

describe("compare: batch 10 sets + effect", () => {
	const items = Array.from({ length: 10 }, (_, i) => state(i));
	rechargeEffect(items, () => {
		for (const s of items) s.get();
		return undefined;
	});
	let k = 0;
	let k2 = 0;
	bench("Recharge unbatched (10 sets)", () => {
		for (const s of items) s.set(k++);
	});
	bench("Recharge batched (10 sets)", () => {
		batch(() => {
			for (const s of items) s.set(k2++);
		});
	});
});

describe("compare: pipeRaw vs pipe", () => {
	const rSrc1 = state(0);
	const rPiped1 = rPipe(
		rSrc1,
		rMap((n) => n * 2),
		rFilter((n) => n > 0),
		rMap((n) => (n ?? 0) + 1),
	);
	let ri1 = 1;
	const rSrc2 = state(0);
	const rPiped2 = pipeRaw(
		rSrc2,
		(n: number) => n * 2,
		(n: number) => (n > 0 ? n : undefined),
		(n: number | undefined) => (n ?? 0) + 1,
	);
	let ri2 = 1;
	bench("Recharge pipe", () => {
		rSrc1.set(ri1++);
		rPiped1.get();
	});
	bench("Recharge pipeRaw", () => {
		rSrc2.set(ri2++);
		rPiped2.get();
	});
});

describe("compare: equals on diamond intermediates", () => {
	const a1 = state(0);
	const b1 = derived([a1], () => (a1.get() >= 5 ? 1 : 0));
	const c1 = derived([a1], () => a1.get() * 2);
	rechargeEffect([b1, c1], () => {
		b1.get();
		c1.get();
		return undefined;
	});
	let k1 = 0;
	const a2 = state(0);
	const b2 = derived([a2], () => (a2.get() >= 5 ? 1 : 0), {
		equals: (x, y) => x === y,
	});
	const c2 = derived([a2], () => a2.get() * 2);
	rechargeEffect([b2, c2], () => {
		b2.get();
		c2.get();
		return undefined;
	});
	let k2 = 0;
	bench("Without equals", () => {
		a1.set(k1++);
	});
	bench("With equals", () => {
		a2.set(k2++);
	});
});
