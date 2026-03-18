/**
 * Self-comparison benchmarks — track our own performance across graph shapes.
 * No external package comparisons. Focus on self-improvement.
 */
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

// ─── Primitives ────────────────────────────────────────────

describe("state: read", () => {
	const s = state(0);
	bench("state.get()", () => {
		s.get();
	});
});

describe("state: write (no subscribers)", () => {
	const s = state(0);
	bench("state.set()", () => {
		s.set(Math.random());
	});
});

describe("state: write (with subscriber)", () => {
	const s = state(0);
	rSubscribe(s, () => {});
	bench("state.set() + subscriber", () => {
		s.set(Math.random());
	});
});

// ─── Derived ───────────────────────────────────────────────

describe("derived: single-dep (P0 fast path)", () => {
	const a = state(0);
	const d = derived([a], () => a.get() * 2);
	let i = 0;
	bench("set + get", () => {
		a.set(i++);
		d.get();
	});
});

describe("derived: multi-dep", () => {
	const a = state(0);
	const b = state(0);
	const d = derived([a, b], () => a.get() + b.get());
	let i = 0;
	bench("set one dep + get", () => {
		a.set(i++);
		d.get();
	});
});

describe("derived: cached read (unchanged deps)", () => {
	const a = state(5);
	const d = derived([a], () => a.get() * 2);
	bench("get (cached)", () => {
		d.get();
	});
});

// ─── Diamond ───────────────────────────────────────────────

describe("diamond: A → B,C → D", () => {
	const a = state(0);
	const b = derived([a], () => a.get() + 1);
	const c = derived([a], () => a.get() * 2);
	const d = derived([b, c], () => b.get() + c.get());
	let i = 0;
	bench("set root + get leaf", () => {
		a.set(i++);
		d.get();
	});
});

describe("diamond: deep (5 levels)", () => {
	const root = state(0);
	const l1a = derived([root], () => root.get() + 1);
	const l1b = derived([root], () => root.get() * 2);
	const l2a = derived([l1a, l1b], () => l1a.get() + l1b.get());
	const l2b = derived([l1a, l1b], () => l1a.get() * l1b.get());
	const leaf = derived([l2a, l2b], () => l2a.get() + l2b.get());
	let i = 0;
	bench("set root + get leaf", () => {
		root.set(i++);
		leaf.get();
	});
});

describe("diamond: wide (10 intermediates)", () => {
	const root = state(0);
	const intermediates = Array.from({ length: 10 }, (_, i) => derived([root], () => root.get() + i));
	const leaf = derived(intermediates, () => intermediates.reduce((sum, d) => sum + d.get(), 0));
	let i = 0;
	bench("set root + get leaf", () => {
		root.set(i++);
		leaf.get();
	});
});

// ─── Effect ────────────────────────────────────────────────

describe("effect: single dep re-run", () => {
	const trigger = state(0);
	rechargeEffect([trigger], () => {
		trigger.get();
		return undefined;
	});
	let i = 0;
	bench("state.set() triggers effect", () => {
		trigger.set(i++);
	});
});

describe("effect: multi-dep (diamond + effect)", () => {
	const a = state(0);
	const b = derived([a], () => a.get() + 1);
	const c = derived([a], () => a.get() * 2);
	rechargeEffect([b, c], () => {
		b.get();
		c.get();
		return undefined;
	});
	let i = 0;
	bench("set root, effect runs once", () => {
		a.set(i++);
	});
});

// ─── Producer & Operator ───────────────────────────────────

describe("producer: emit + get", () => {
	const p = producer<number>(
		({ emit }) => {
			(p as { _emit?: (n: number) => void })._emit = emit;
			return undefined;
		},
		{ initial: 0 },
	);
	rSubscribe(p, () => {});
	let i = 0;
	bench("emit + get", () => {
		(p as { _emit?: (n: number) => void })._emit!(i++);
		p.get();
	});
});

describe("operator: transform (x2)", () => {
	const a = state(0);
	const op = operator<number>(
		[a],
		(actions) => {
			return (_depIndex, type, data) => {
				if (type === 1) actions.emit(data * 2);
				else if (type === 3) actions.signal(data);
			};
		},
		{ initial: 0 },
	);
	rSubscribe(op, () => {});
	let i = 0;
	bench("set + get", () => {
		a.set(i++);
		op.get();
	});
});

// ─── Pipe ──────────────────────────────────────────────────

describe("pipe: 3 operators (map → filter → map)", () => {
	const src = state(0);
	const piped = rPipe(
		src,
		rMap((n) => n * 2),
		rFilter((n) => n > 0),
		rMap((n) => (n ?? 0) + 1),
	);
	let i = 1;
	bench("set + get", () => {
		src.set(i++);
		piped.get();
	});
});

describe("pipe: pipeRaw (fused, ~2x faster)", () => {
	const src = state(0);
	const piped = pipeRaw(
		src,
		(n: number) => n * 2,
		(n: number) => (n > 0 ? n : undefined),
		(n: number | undefined) => (n ?? 0) + 1,
	);
	let i = 1;
	bench("set + get", () => {
		src.set(i++);
		piped.get();
	});
});

describe("pipe vs pipeRaw", () => {
	const src1 = state(0);
	const piped1 = rPipe(
		src1,
		rMap((n) => n * 2),
		rFilter((n) => n > 0),
		rMap((n) => (n ?? 0) + 1),
	);
	let ri1 = 1;
	const src2 = state(0);
	const piped2 = pipeRaw(
		src2,
		(n: number) => n * 2,
		(n: number) => (n > 0 ? n : undefined),
		(n: number | undefined) => (n ?? 0) + 1,
	);
	let ri2 = 1;
	bench("pipe (3 stores)", () => {
		src1.set(ri1++);
		piped1.get();
	});
	bench("pipeRaw (fused)", () => {
		src2.set(ri2++);
		piped2.get();
	});
});

// ─── Fan-out ───────────────────────────────────────────────

describe("fan-out: 10 subscribers", () => {
	const src = state(0);
	for (let i = 0; i < 10; i++) rSubscribe(src, () => {});
	let ri = 0;
	bench("set with 10 subscribers", () => {
		src.set(ri++);
	});
});

describe("fan-out: 100 subscribers", () => {
	const src = state(0);
	for (let i = 0; i < 100; i++) rSubscribe(src, () => {});
	let ri = 0;
	bench("set with 100 subscribers", () => {
		src.set(ri++);
	});
});

// ─── Batching ──────────────────────────────────────────────

describe("batch: 10 sets + effect", () => {
	const items = Array.from({ length: 10 }, (_, i) => state(i));
	rechargeEffect(items, () => {
		for (const s of items) s.get();
		return undefined;
	});
	let k = 0;
	let k2 = 0;
	bench("unbatched (10 sets)", () => {
		for (const s of items) s.set(k++);
	});
	bench("batched (10 sets)", () => {
		batch(() => {
			for (const s of items) s.set(k2++);
		});
	});
});

// ─── Optimizations ─────────────────────────────────────────

describe("equals: diamond with push-phase memoization", () => {
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
	bench("without equals", () => {
		a1.set(k1++);
	});
	bench("with equals (subtree skip)", () => {
		a2.set(k2++);
	});
});

// ─── Inspector overhead ────────────────────────────────────

const _inspectorStoreCreationTimeMs = 200;

describe("inspector: store creation overhead", () => {
	beforeAll(() => {
		Inspector.enabled = true;
	});
	bench(
		"Inspector ON",
		() => {
			state(0);
		},
		{ time: _inspectorStoreCreationTimeMs },
	);
});

describe("inspector: store creation baseline", () => {
	beforeAll(() => {
		Inspector.enabled = false;
	});
	bench(
		"Inspector OFF",
		() => {
			state(0);
		},
		{ time: _inspectorStoreCreationTimeMs },
	);
	afterAll(() => {
		Inspector.enabled = true;
	});
});
