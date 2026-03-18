import { bench, describe } from "vitest";
import { filter } from "../extra/filter";
import { map } from "../extra/map";
import { subscribe } from "../extra/subscribe";
import { DATA, derived, effect, operator, pipe, producer, state } from "../index";

describe("core: state", () => {
	const count = state(0);
	bench("state.get()", () => {
		count.get();
	});
	bench("state.set()", () => {
		count.set(Math.random());
	});
});

describe("core: derived", () => {
	const a = state(0);
	const b = state(0);
	const sum = derived([a, b], () => a.get() + b.get());
	bench("derived.get() cached (no dep change)", () => {
		sum.get();
	});
	let di = 0;
	bench("derived.get() after dep change", () => {
		a.set(di++);
		sum.get();
	});
});

describe("core: pipe", () => {
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
});

describe("core: effect", () => {
	const trigger = state(0);
	effect([trigger], () => {
		trigger.get();
		return undefined;
	});
	let ei = 0;
	bench("effect re-run", () => {
		trigger.set(ei++);
	});
});

describe("core: fan-out", () => {
	const fanSrc = state(0);
	for (let i = 0; i < 10; i++) subscribe(fanSrc, () => {});
	let fi = 0;
	bench("fan-out (10 subscribers)", () => {
		fanSrc.set(fi++);
	});
});

describe("core: diamond", () => {
	const dA = state(0);
	const dB = derived([dA], () => dA.get() + 1);
	const dC = derived([dA], () => dA.get() * 2);
	const dD = derived([dB, dC], () => dB.get() + dC.get());
	let ddi = 0;
	bench("diamond (A->B,C->D) set + get", () => {
		dA.set(ddi++);
		dD.get();
	});
});

describe("core: producer", () => {
	const prod = producer<number>(
		({ emit }) => {
			(prod as { _emit?: (n: number) => void })._emit = emit;
			return undefined;
		},
		{ initial: 0 },
	);
	subscribe(prod, () => {});
	let prodI = 0;
	bench("producer emit + get", () => {
		(prod as { _emit?: (n: number) => void })._emit!(prodI++);
		prod.get();
	});
});

describe("core: operator", () => {
	const opSrc = state(0);
	const opStore = operator<number>(
		[opSrc],
		(actions) => {
			return (_depIndex, type, data) => {
				if (type === DATA) actions.emit(data * 2);
				else if (type === STATE) actions.signal(data);
			};
		},
		{ initial: 0 },
	);
	subscribe(opStore, () => {});
	let opI = 0;
	bench("operator (1 dep, transform) set + get", () => {
		opSrc.set(opI++);
		opStore.get();
	});
});
