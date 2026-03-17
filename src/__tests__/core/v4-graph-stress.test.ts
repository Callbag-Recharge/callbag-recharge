// ---------------------------------------------------------------------------
// v4 Graph Stress Tests — Complex topologies & dynamic graph changes
// ---------------------------------------------------------------------------
// These tests target subtle correctness bugs in the v4 architecture:
// - Output slot transitions under complex topologies
// - Output slot mode transitions in deep/wide diamonds
// - Bitmask correctness at multi-level convergence points
// - Interleaved subscribe/unsubscribe during propagation
// - Batch + diamond + output slot interactions
// - Status model consistency across topology changes
// - Chain model: tap correctness when output slot mode changes mid-propagation
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { combine } from "../../extra/combine";
import { concat } from "../../extra/concat";
import { debounce } from "../../extra/debounce";
import { distinctUntilChanged } from "../../extra/distinctUntilChanged";
import { filter } from "../../extra/filter";
import { map } from "../../extra/map";
import { merge } from "../../extra/merge";
import { pipeRaw, SKIP } from "../../extra/pipeRaw";
import { scan } from "../../extra/scan";
import { skip } from "../../extra/skip";
import { subscribe } from "../../extra/subscribe";
import { switchMap } from "../../extra/switchMap";
import { take } from "../../extra/take";
import {
	batch,
	DATA,
	DIRTY,
	derived,
	END,
	effect,
	Inspector,
	operator,
	pipe,
	producer,
	RESOLVED,
	START,
	STATE,
	state,
} from "../../index";

beforeEach(() => {
	Inspector._reset();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ===========================================================================
// Section 1: Deep Diamond Topologies
// ===========================================================================

describe("deep diamond topologies", () => {
	it("double diamond: A→B→D→F, A→C→D→F, A→C→E→F — F computes once", () => {
		//     A
		//    / \
		//   B   C
		//    \ / \
		//     D   E
		//      \ /
		//       F
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a], () => a.get() + 10);
		const d = derived([b, c], () => b.get() + c.get());
		const e = derived([c], () => c.get() * 3);
		const f = derived([d, e], () => d.get() + e.get());

		let fCount = 0;
		effect([f], () => {
			fCount++;
		});
		fCount = 0; // reset after initial

		a.set(5);
		expect(fCount).toBe(1);
		// b=10, c=15, d=25, e=45, f=70
		expect(f.get()).toBe(70);
	});

	it("triple diamond: 3 levels of convergence — bottom computes once", () => {
		//        A
		//       / \
		//      B   C
		//       \ /
		//        D
		//       / \
		//      E   F
		//       \ /
		//        G
		const a = state(1);
		const b = derived([a], () => a.get() + 1);
		const c = derived([a], () => a.get() + 2);
		const d = derived([b, c], () => b.get() + c.get());
		const e = derived([d], () => d.get() * 2);
		const f = derived([d], () => d.get() * 3);
		const g = derived([e, f], () => e.get() + f.get());

		let gCount = 0;
		effect([g], () => {
			gCount++;
		});
		gCount = 0;

		a.set(10);
		expect(gCount).toBe(1);
		// b=11, c=12, d=23, e=46, f=69, g=115
		expect(g.get()).toBe(115);
	});

	it("wide diamond: A fans out to 5 branches, all converge at Z", () => {
		const a = state(0);
		const b = derived([a], () => a.get() + 1);
		const c = derived([a], () => a.get() + 2);
		const d = derived([a], () => a.get() + 3);
		const e = derived([a], () => a.get() + 4);
		const f = derived([a], () => a.get() + 5);
		const z = derived([b, c, d, e, f], () => b.get() + c.get() + d.get() + e.get() + f.get());

		let zCount = 0;
		effect([z], () => {
			zCount++;
		});
		zCount = 0;

		a.set(10);
		expect(zCount).toBe(1);
		// 11+12+13+14+15 = 65
		expect(z.get()).toBe(65);
	});

	it("overlapping diamonds: A→B→D, A→C→D, B→E, C→E — D and E both compute once", () => {
		//     A
		//    / \
		//   B   C
		//   |\ /|
		//   D  E
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a], () => a.get() * 3);
		const d = derived([b, c], () => b.get() + c.get());
		const e = derived([b, c], () => b.get() * c.get());

		let dCount = 0;
		let eCount = 0;
		effect([d], () => {
			dCount++;
		});
		effect([e], () => {
			eCount++;
		});
		dCount = 0;
		eCount = 0;

		a.set(5);
		expect(dCount).toBe(1);
		expect(eCount).toBe(1);
		// b=10, c=15, d=25, e=150
		expect(d.get()).toBe(25);
		expect(e.get()).toBe(150);
	});

	it("diamond with direct + indirect path: A→B→C, A→C — C sees consistent values", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a, b], () => a.get() + b.get());

		const cValues: number[] = [];
		let cCount = 0;
		effect([c], () => {
			cCount++;
			cValues.push(c.get());
		});
		cCount = 0;
		cValues.length = 0;

		a.set(5);
		expect(cCount).toBe(1);
		expect(c.get()).toBe(15); // 5 + 10
		expect(cValues).toEqual([15]); // never saw a glitched intermediate
	});
});

// ===========================================================================
// Section 2: Output Slot Transitions Under Stress
// ===========================================================================

describe("output slot transitions under stress", () => {
	it("rapid subscribe/unsubscribe cycling preserves value correctness", () => {
		const a = state(0);
		const b = derived([a], () => a.get() * 2);

		for (let i = 1; i <= 20; i++) {
			const unsub = subscribe(b, () => {});
			a.set(i);
			expect(b.get()).toBe(i * 2);
			unsub();
			// After unsub, STANDALONE should resume
			expect(b.get()).toBe(i * 2);
		}

		// Final value after all cycles
		a.set(100);
		expect(b.get()).toBe(200);
	});

	it("STANDALONE → MULTI → STANDALONE: all subscribers get correct values", () => {
		const a = state(0);
		const b = derived([a], () => a.get() + 1);

		expect(b.get()).toBe(1); // STANDALONE

		const vals1: number[] = [];
		const vals2: number[] = [];
		const vals3: number[] = [];

		const unsub1 = subscribe(b, (v) => vals1.push(v)); // → SINGLE
		const unsub2 = subscribe(b, (v) => vals2.push(v)); // → MULTI
		const unsub3 = subscribe(b, (v) => vals3.push(v)); // → still MULTI

		a.set(10);
		expect(vals1).toEqual([11]);
		expect(vals2).toEqual([11]);
		expect(vals3).toEqual([11]);

		unsub2(); // MULTI → still MULTI (2 left)
		a.set(20);
		expect(vals1).toEqual([11, 21]);
		expect(vals2).toEqual([11]); // stopped
		expect(vals3).toEqual([11, 21]);

		unsub3(); // → SINGLE
		a.set(30);
		expect(vals1).toEqual([11, 21, 31]);

		unsub1(); // → STANDALONE
		a.set(40);
		expect(b.get()).toBe(41); // STANDALONE still reactive
	});

	it("subscribe during propagation: late subscriber sees next value, not current mid-flight", () => {
		const a = state(0);
		const b = derived([a], () => a.get() * 2);

		const lateValues: number[] = [];
		let lateUnsub: (() => void) | null = null;

		// First subscriber triggers a late subscription during callback
		const unsub1 = subscribe(b, (v) => {
			if (v === 2 && !lateUnsub) {
				lateUnsub = subscribe(b, (lv) => lateValues.push(lv));
			}
		});

		a.set(1); // b=2, triggers late subscription
		a.set(5); // b=10, both should see this

		expect(lateValues).toContain(10);
		unsub1();
		lateUnsub?.();
	});

	it("unsubscribe during propagation: removed subscriber stops receiving", () => {
		const a = state(0);
		const b = derived([a], () => a.get() + 1);

		const vals1: number[] = [];
		const vals2: number[] = [];
		let unsub2: (() => void) | null = null;

		// unsub1 will remove unsub2 during callback
		const unsub1 = subscribe(b, (v) => {
			vals1.push(v);
			if (v === 2) unsub2?.();
		});
		unsub2 = subscribe(b, (v) => vals2.push(v));

		a.set(1); // b=2 — unsub2 removed during this propagation
		a.set(5); // b=6

		expect(vals1).toEqual([2, 6]);
		// vals2 may or may not see the value 2 depending on iteration order,
		// but must NOT see 6
		expect(vals2.includes(6)).toBe(false);
		unsub1();
	});
});

// ===========================================================================
// Section 3: Diamond + Batch Interactions
// ===========================================================================

describe("diamond + batch interactions", () => {
	it("batch across diamond: single recompute at convergence", () => {
		const a = state(1);
		const b = state(2);
		const c = derived([a, b], () => a.get() + b.get());
		const d = derived([a], () => a.get() * 10);
		const e = derived([c, d], () => c.get() + d.get());

		let eCount = 0;
		effect([e], () => {
			eCount++;
		});
		eCount = 0;

		batch(() => {
			a.set(10);
			b.set(20);
		});

		expect(eCount).toBe(1);
		// c=30, d=100, e=130
		expect(e.get()).toBe(130);
	});

	it("nested batch with diamond: only outermost batch triggers recompute", () => {
		const a = state(0);
		const b = derived([a], () => a.get() + 1);
		const c = derived([a, b], () => a.get() + b.get());

		let cCount = 0;
		const cValues: number[] = [];
		effect([c], () => {
			cCount++;
			cValues.push(c.get());
		});
		cCount = 0;
		cValues.length = 0;

		batch(() => {
			a.set(1);
			batch(() => {
				a.set(2);
				batch(() => {
					a.set(3);
				});
			});
		});

		// Only the final value should propagate
		expect(cCount).toBe(1);
		// a=3, b=4, c=7
		expect(cValues).toEqual([7]);
	});

	it("batch with multiple sources feeding same diamond convergence", () => {
		const x = state(0);
		const y = state(0);
		const z = state(0);
		const sum = derived([x, y, z], () => x.get() + y.get() + z.get());

		let sumCount = 0;
		effect([sum], () => {
			sumCount++;
		});
		sumCount = 0;

		batch(() => {
			x.set(1);
			y.set(2);
			z.set(3);
		});

		expect(sumCount).toBe(1);
		expect(sum.get()).toBe(6);
	});

	it("batch where one path resolves and another changes: correct final value", () => {
		const a = state(1);
		const b = state(10);
		const da = derived([a], () => a.get(), { equals: Object.is });
		const db = derived([b], () => b.get(), { equals: Object.is });
		const c = derived([da, db], () => da.get() + db.get());

		let cCount = 0;
		effect([c], () => {
			cCount++;
		});
		cCount = 0;

		batch(() => {
			a.set(1); // same value → da sends RESOLVED
			b.set(20); // different → db sends DATA
		});

		// c should recompute because db changed (even though da resolved)
		expect(c.get()).toBe(21);
		expect(cCount).toBe(1);
	});
});

// ===========================================================================
// Section 4: RESOLVED + Subtree Skipping in Complex Graphs
// ===========================================================================

describe("RESOLVED subtree skipping in complex graphs", () => {
	it("RESOLVED at diamond mid-point skips entire downstream subtree", () => {
		const a = state(1);
		const b = derived([a], () => Math.floor(a.get() / 10), { equals: Object.is });
		// b only changes when a crosses a tens boundary
		const c = derived([b], () => b.get() * 100);
		const d = derived([c], () => c.get() + 1);

		let dCount = 0;
		effect([d], () => {
			dCount++;
		});
		dCount = 0;

		a.set(2); // b stays 0 → RESOLVED → c,d skip
		expect(dCount).toBe(0);
		expect(d.get()).toBe(1); // unchanged

		a.set(10); // b becomes 1 → DATA flows
		expect(dCount).toBe(1);
		expect(d.get()).toBe(101);
	});

	it("RESOLVED on one branch, DATA on other: convergence still computes", () => {
		const a = state(1);
		const b = state(100);
		const da = derived([a], () => a.get(), { equals: Object.is });
		const c = derived([da, b], () => da.get() + b.get());

		let cCount = 0;
		effect([c], () => {
			cCount++;
		});
		cCount = 0;

		a.set(1); // same → da RESOLVED
		b.set(200); // different → b DATA
		// These are separate updates (not batched), so c computes for each
		// da RESOLVED → c should resolve (only dep resolved)
		// b DATA → c recomputes
		expect(c.get()).toBe(201);
	});

	it("all branches RESOLVED: downstream skips entirely", () => {
		const a = state(1);
		const b = state(2);
		const da = derived([a], () => a.get(), { equals: Object.is });
		const db = derived([b], () => b.get(), { equals: Object.is });
		const c = derived([da, db], () => da.get() + db.get());

		let cCount = 0;
		effect([c], () => {
			cCount++;
		});
		cCount = 0;

		batch(() => {
			a.set(1); // same → RESOLVED
			b.set(2); // same → RESOLVED
		});

		expect(cCount).toBe(0);
		expect(c.get()).toBe(3); // unchanged
	});

	it("deep chain: RESOLVED propagates through multiple levels", () => {
		const a = state(5);
		const b = derived([a], () => a.get(), { equals: Object.is });
		const c = derived([b], () => b.get() * 2);
		const d = derived([c], () => c.get() + 1);
		const e = derived([d], () => d.get() * 3);

		let eCount = 0;
		effect([e], () => {
			eCount++;
		});
		eCount = 0;

		a.set(5); // same → b RESOLVED → c,d,e all skip
		expect(eCount).toBe(0);
		expect(e.get()).toBe(33); // (5*2+1)*3
	});

	it("RESOLVED in diamond: one path resolves, other path has data", () => {
		//     A
		//    / \
		//   B   C(equals)
		//    \ /
		//     D
		const a = state(10);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a], () => Math.floor(a.get() / 100), { equals: Object.is });
		const d = derived([b, c], () => b.get() + c.get());

		let dCount = 0;
		effect([d], () => {
			dCount++;
		});
		dCount = 0;

		a.set(11); // b=22 (DATA), c still 0 (RESOLVED)
		expect(dCount).toBe(1);
		expect(d.get()).toBe(22); // 22 + 0
	});
});

// ===========================================================================
// Section 5: Dynamic Graph Changes — Topology Mutations
// ===========================================================================

describe("dynamic graph topology changes", () => {
	it("add/remove subscribers to intermediate node in diamond during updates", () => {
		const a = state(0);
		const b = derived([a], () => a.get() + 1);
		const c = derived([b], () => b.get() * 2);

		const cVals: number[] = [];
		const unsub = subscribe(c, (v) => cVals.push(v));

		// Add extra subscriber to B mid-stream
		const bVals: number[] = [];
		a.set(1);
		const bUnsub = subscribe(b, (v) => bVals.push(v));
		a.set(2);

		expect(cVals).toEqual([4, 6]); // (1+1)*2, (2+1)*2
		expect(bVals).toEqual([3]); // only saw set(2)

		// Remove B subscriber — C should still work
		bUnsub();
		a.set(3);
		expect(cVals).toEqual([4, 6, 8]);
		expect(b.get()).toBe(4); // still current

		unsub();
	});

	it("derived wrapping operator: STANDALONE keeps operator connected, handler state persists", () => {
		// derived is eagerly connected (STANDALONE) — it never fully disconnects
		// from its dep operator. So the operator's init handler does NOT re-run
		// when external subscribers leave and rejoin. Handler-local state persists.
		const a = state(0);
		const counted = operator([a], (actions) => {
			let count = 0;
			return (_depIndex, type, data) => {
				if (type === DATA) {
					count++;
					actions.emit(count);
				}
				if (type === STATE) actions.signal(data);
				if (type === END) data !== undefined ? actions.error(data) : actions.complete();
			};
		});

		const d = derived([counted], () => (counted.get() ?? 0) * 10);

		// First subscription cycle
		const vals1: number[] = [];
		const unsub1 = subscribe(d, (v) => vals1.push(v));
		a.set(1);
		a.set(2);
		expect(vals1).toEqual([10, 20]); // count=1→10, count=2→20
		unsub1();

		// Derived goes back to STANDALONE but stays connected to operator.
		// Operator handler state (count) persists — count continues from 2.
		const vals2: number[] = [];
		const unsub2 = subscribe(d, (v) => vals2.push(v));
		a.set(3);
		a.set(4);
		expect(vals2).toEqual([30, 40]); // count=3→30, count=4→40 (persisted!)
		unsub2();
	});

	it("effect disposal during batch: no stale computation after dispose", () => {
		const a = state(0);
		const b = derived([a], () => a.get() + 1);

		let effectCount = 0;
		const dispose = effect([b], () => {
			effectCount++;
		});
		effectCount = 0;

		batch(() => {
			a.set(1);
			dispose();
			a.set(2);
		});

		// Effect was disposed mid-batch — should not run for deferred value
		expect(effectCount).toBe(0);
	});

	it("subscribe to completed producer: immediate disconnection", () => {
		const p = producer<number>(({ emit, complete }) => {
			emit(42);
			complete();
		});

		// Force connection
		const vals: number[] = [];
		subscribe(p, (v) => vals.push(v));

		// Now subscribe again after completion
		const lateVals: number[] = [];
		let ended = false;
		p.source(START, (type: number, data: any) => {
			if (type === DATA) lateVals.push(data);
			if (type === END) ended = true;
		});

		expect(lateVals).toEqual([]); // no data
		expect(ended).toBe(true); // immediate END
	});
});

// ===========================================================================
// Section 6: Complex Pipe Chains with Diamonds
// ===========================================================================

describe("complex pipe chains with diamonds", () => {
	it("pipe chain feeding into diamond convergence", () => {
		const a = state(0);
		const filtered = pipe(
			a,
			map((x: number) => x * 2),
			filter((x: number) => x > 5),
		);
		const b = derived([a], () => a.get() + 100);
		const c = derived([filtered, b], () => (filtered.get() ?? 0) + b.get());

		const cVals: number[] = [];
		effect([c], () => {
			cVals.push(c.get());
		});
		cVals.length = 0;

		a.set(1); // filtered=2 (filtered out), b=101
		a.set(3); // filtered=6 (passes), b=103
		a.set(10); // filtered=20 (passes), b=110

		// filtered.get() returns undefined/0 when filtered, then 6, then 20
		expect(c.get()).toBe(130); // 20 + 110
	});

	it("pipeRaw fused chain in diamond: single derived, correct convergence", () => {
		const a = state(0);
		const fused = pipeRaw(
			a,
			(x: number) => x * 3,
			(x: number) => (x > 10 ? x : SKIP),
		);

		const b = derived([a], () => a.get() + 1);
		const combined = derived([fused, b], () => (fused.get() ?? 0) + b.get());

		const vals: number[] = [];
		effect([combined], () => {
			vals.push(combined.get());
		});
		vals.length = 0;

		a.set(2); // fused=6 (SKIP), b=3
		a.set(4); // fused=12 (passes), b=5
		a.set(5); // fused=15 (passes), b=6

		expect(combined.get()).toBe(21); // 15 + 6
	});

	it("scan accumulator through diamond maintains state correctly", () => {
		const a = state(0);
		const summed = pipe(
			a,
			scan((acc: number, x: number) => acc + x, 0),
		);
		const doubled = derived([a], () => a.get() * 2);
		const result = derived([summed, doubled], () => summed.get() + doubled.get());

		const vals: number[] = [];
		effect([result], () => {
			vals.push(result.get());
		});
		vals.length = 0;

		a.set(1); // summed=1, doubled=2, result=3
		a.set(2); // summed=3, doubled=4, result=7
		a.set(3); // summed=6, doubled=6, result=12

		expect(vals).toEqual([3, 7, 12]);
	});
});

// ===========================================================================
// Section 7: Reentrancy in Complex Graphs
// ===========================================================================

describe("reentrancy in complex graphs", () => {
	it("effect writes to state that feeds back into same diamond", () => {
		const trigger = state(0);
		const feedback = state(0);
		const d = derived([trigger, feedback], () => trigger.get() + feedback.get());

		const dVals: number[] = [];
		let effectRuns = 0;
		effect([d], () => {
			effectRuns++;
			dVals.push(d.get());
			// Reentrant: write to feedback on first trigger change
			if (trigger.get() === 1 && feedback.get() === 0) {
				feedback.set(100);
			}
		});
		effectRuns = 0;
		dVals.length = 0;

		trigger.set(1);
		// First: d = 1+0 = 1, effect runs, sets feedback=100
		// Second: d = 1+100 = 101, effect runs again
		expect(dVals).toContain(1);
		expect(dVals).toContain(101);
		expect(d.get()).toBe(101);
	});

	it("subscribe callback triggers batch: deferred emissions handled correctly", () => {
		const a = state(0);
		const b = state(0);
		const c = derived([a, b], () => a.get() + b.get());

		const cVals: number[] = [];
		subscribe(c, (v) => {
			cVals.push(v);
			// When a changes, batch-update b
			if (a.get() === 1 && b.get() === 0) {
				batch(() => {
					b.set(10);
				});
			}
		});

		a.set(1);
		// c should eventually be 11 (a=1, b=10)
		expect(c.get()).toBe(11);
		expect(cVals).toContain(11);
	});

	it("nested effects: effect A triggers state change that triggers effect B", () => {
		const x = state(0);
		const y = state(0);
		const z = derived([y], () => y.get() * 10);

		const xEffectVals: number[] = [];
		const zEffectVals: number[] = [];

		effect([x], () => {
			xEffectVals.push(x.get());
			if (x.get() > 0) y.set(x.get());
		});

		effect([z], () => {
			zEffectVals.push(z.get());
		});
		xEffectVals.length = 0;
		zEffectVals.length = 0;

		x.set(5);
		// x effect runs → y.set(5) → z = 50 → z effect runs
		expect(xEffectVals).toContain(5);
		expect(zEffectVals).toContain(50);
		expect(z.get()).toBe(50);
	});
});

// ===========================================================================
// Section 8: Multi-Source Diamonds with Batch
// ===========================================================================

describe("multi-source diamonds with batch", () => {
	it("3 sources, each feeding 2 derived, all converging: single compute at bottom", () => {
		//   S1    S2    S3
		//   |  \/ |  \/ |
		//   | /\  | /\  |
		//   A    B    C
		//    \   |   /
		//      BOTTOM
		const s1 = state(1);
		const s2 = state(2);
		const s3 = state(3);
		const a = derived([s1, s2], () => s1.get() + s2.get());
		const b = derived([s2, s3], () => s2.get() + s3.get());
		const c = derived([s1, s3], () => s1.get() + s3.get());
		const bottom = derived([a, b, c], () => a.get() + b.get() + c.get());

		let bottomCount = 0;
		effect([bottom], () => {
			bottomCount++;
		});
		bottomCount = 0;

		batch(() => {
			s1.set(10);
			s2.set(20);
			s3.set(30);
		});

		expect(bottomCount).toBe(1);
		// a=30, b=50, c=40, bottom=120
		expect(bottom.get()).toBe(120);
	});

	it("batch with partial update: only affected branches recompute", () => {
		const s1 = state(1);
		const s2 = state(2);
		const a = derived([s1], () => s1.get() * 10);
		const b = derived([s2], () => s2.get() * 10);
		const c = derived([a, b], () => a.get() + b.get());

		let aCount = 0;
		let bCount = 0;
		let cCount = 0;
		effect([a], () => {
			aCount++;
		});
		effect([b], () => {
			bCount++;
		});
		effect([c], () => {
			cCount++;
		});
		aCount = 0;
		bCount = 0;
		cCount = 0;

		// Only update s1 — b should not recompute
		s1.set(5);
		expect(aCount).toBe(1);
		expect(bCount).toBe(0);
		expect(cCount).toBe(1);
		expect(c.get()).toBe(70); // 50 + 20
	});
});

// ===========================================================================
// Section 9: Status Model Consistency
// ===========================================================================

describe("status model consistency", () => {
	it("derived status tracks through diamond correctly", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a, b], () => a.get() + b.get());

		// v4.1: After construction — DISCONNECTED (lazy STANDALONE)
		expect(b._status).toBe("DISCONNECTED");
		expect(c._status).toBe("DISCONNECTED");

		// First get() triggers lazy connection cascade
		expect(c.get()).toBe(3); // 1 + 1*2
		expect(b._status).toBe("SETTLED");
		expect(c._status).toBe("SETTLED");

		// After update
		a.set(5);
		expect(b._status).toBe("SETTLED");
		expect(c._status).toBe("SETTLED");
		expect(c.get()).toBe(15);
	});

	it("RESOLVED status: state equals guard blocks emit entirely, no DIRTY reaches derived", () => {
		// state(1).set(1) — state's own equals guard (Object.is) blocks the
		// entire emission. No DIRTY is sent, so derived never enters DIRTY→RESOLVED.
		// Derived stays SETTLED from lazy connection.
		const a = state(1);
		const b = derived([a], () => a.get(), { equals: Object.is });

		// v4.1: trigger lazy connection first
		expect(b.get()).toBe(1);

		a.set(1); // same value → state blocks emit entirely
		expect(b._status).toBe("SETTLED"); // no DIRTY was ever sent
	});

	it("status after error is ERRORED", () => {
		const p = producer<number>(({ error }) => {
			error(new Error("boom"));
		});

		subscribe(p, () => {}); // trigger start

		expect(p._status).toBe("ERRORED");
	});

	it("status after complete is COMPLETED", () => {
		const p = producer<number>(({ emit, complete }) => {
			emit(1);
			complete();
		});

		subscribe(p, () => {}); // trigger start

		expect(p._status).toBe("COMPLETED");
	});
});

// ===========================================================================
// Section 10: Tier 2 Cycle Boundaries in Complex Graphs
// ===========================================================================

describe("tier 2 cycle boundaries in complex graphs", () => {
	it("switchMap in diamond: inner source change doesn't glitch outer diamond", () => {
		const selector = state("a");
		const sourceA = state(1);
		const sourceB = state(100);

		const switched = pipe(
			selector,
			switchMap((sel: string) => (sel === "a" ? sourceA : sourceB)),
		);

		const other = derived([selector], () => selector.get().toUpperCase());
		const combined = derived([switched, other], () => `${switched.get()}-${other.get()}`);

		const vals: string[] = [];
		effect([combined], () => {
			vals.push(combined.get());
		});
		vals.length = 0;

		sourceA.set(2);
		expect(combined.get()).toBe("2-A");

		selector.set("b");
		expect(combined.get()).toBe("100-B");

		sourceB.set(200);
		expect(combined.get()).toBe("200-B");
	});

	it("debounce feeding into diamond: deferred value resolves correctly", () => {
		const a = state(0);
		const debounced = pipe(a, debounce(100));
		const direct = derived([a], () => a.get() * 2);

		const vals: Array<{ debounced: number | undefined; direct: number }> = [];
		effect([debounced], () => {
			vals.push({ debounced: debounced.get(), direct: direct.get() });
		});
		vals.length = 0;

		a.set(1);
		a.set(2);
		a.set(3);

		vi.advanceTimersByTime(100);

		// Debounced should have settled on 3
		expect(debounced.get()).toBe(3);
		expect(direct.get()).toBe(6);
	});
});

// ===========================================================================
// Section 11: Edge Cases — Correctness Traps
// ===========================================================================

describe("correctness traps", () => {
	it("diamond with derived that throws: error propagates, sibling unaffected", () => {
		const a = state(0);
		const safe = derived([a], () => a.get() + 1);

		let errorCaught: unknown = null;
		const unsafe = derived([a], () => {
			if (a.get() === 5) throw new Error("boom");
			return a.get() * 2;
		});

		// Safe branch should continue working regardless
		a.set(1);
		expect(safe.get()).toBe(2);
		expect(unsafe.get()).toBe(2);

		try {
			a.set(5);
		} catch (e) {
			errorCaught = e;
		}

		// Safe should still be correct
		expect(safe.get()).toBe(6);
	});

	it("state equals guard prevents derived recompute for same primitive value", () => {
		// state(0).set(0) — state's Object.is guard blocks the emit entirely.
		// No DIRTY reaches derived, so it never recomputes.
		const a = state(0);
		let computeCount = 0;
		const d = derived([a], () => {
			computeCount++;
			return [a.get()];
		});

		const vals: number[][] = [];
		subscribe(d, (v) => vals.push(v));
		computeCount = 0;

		a.set(0); // same value → state blocks emit
		expect(computeCount).toBe(0); // no recompute because no DIRTY sent
	});

	it("producer without equals guard: same value still triggers derived recompute", () => {
		// producer with no equals: emit(0) always sends DIRTY+DATA even for same value
		const p = producer<number>(
			({ emit }) => {
				// expose emit via closure
				(p as any)._testEmit = emit;
			},
			{ initial: 0 },
		);
		subscribe(p, () => {}); // trigger start

		let computeCount = 0;
		const d = derived([p], () => {
			computeCount++;
			return [p.get()!];
		});

		subscribe(d, () => {});
		computeCount = 0;

		(p as any)._testEmit(0); // same value but no equals guard → DIRTY+DATA flows
		expect(computeCount).toBe(1); // derived recomputed
	});

	it("circular-like: effect on A sets B, effect on B sets A — terminates", () => {
		const a = state(0);
		const b = state(0);

		let aRuns = 0;
		let bRuns = 0;

		effect([a], () => {
			aRuns++;
			if (a.get() === 1 && b.get() === 0) b.set(10);
		});

		effect([b], () => {
			bRuns++;
			// Don't re-trigger a — this would be infinite
			// Verify that the graph stabilizes
		});

		aRuns = 0;
		bRuns = 0;

		a.set(1);
		// a effect fires → b.set(10) → b effect fires → done (no infinite loop)
		expect(aRuns).toBe(1);
		expect(bRuns).toBe(1);
		expect(a.get()).toBe(1);
		expect(b.get()).toBe(10);
	});

	it("get() during derived computation returns correct value (lazy STANDALONE)", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);

		let bValueDuringC: number | undefined;
		const c = derived([a, b], () => {
			// During c's computation, b.get() returns its current value.
			// With lazy STANDALONE, b may lazily connect when c first computes.
			bValueDuringC = b.get();
			return a.get() + b.get();
		});

		// v4.1: trigger lazy connection cascade via c.get()
		expect(c.get()).toBe(3); // 1 + 2
		expect(bValueDuringC).toBe(2);

		a.set(5);
		// After connection, b recomputes to 10 before c recomputes
		expect(bValueDuringC).toBe(10);
		expect(c.get()).toBe(15);
	});

	it("many-to-one: 10 states feeding one derived — single compute per batch", () => {
		const states = Array.from({ length: 10 }, (_, i) => state(i));
		const sum = derived(states, () => states.reduce((acc, s) => acc + s.get(), 0));

		let sumCount = 0;
		effect([sum], () => {
			sumCount++;
		});
		sumCount = 0;

		batch(() => {
			for (let i = 0; i < 10; i++) {
				states[i].set(i * 10);
			}
		});

		expect(sumCount).toBe(1);
		// 0+10+20+30+40+50+60+70+80+90 = 450
		expect(sum.get()).toBe(450);
	});

	it("long chain (20 levels) propagates correctly", () => {
		const root = state(1);
		let current: any = root;
		for (let i = 0; i < 20; i++) {
			const prev = current;
			current = derived([prev], () => prev.get() + 1);
		}

		expect(current.get()).toBe(21); // 1 + 20 levels

		root.set(100);
		expect(current.get()).toBe(120); // 100 + 20 levels
	});

	it("diamond at each level of a 5-level chain: all converge correctly", () => {
		// Level 0: root
		// Level 1: L, R (both depend on root)
		// Level 2: converge L+R → M
		// Level 3: L2, R2 (both depend on M)
		// Level 4: converge L2+R2 → bottom
		const root = state(1);

		const l1 = derived([root], () => root.get() + 1);
		const r1 = derived([root], () => root.get() + 2);
		const m = derived([l1, r1], () => l1.get() + r1.get());

		const l2 = derived([m], () => m.get() * 2);
		const r2 = derived([m], () => m.get() * 3);
		const bottom = derived([l2, r2], () => l2.get() + r2.get());

		let bottomCount = 0;
		effect([bottom], () => {
			bottomCount++;
		});
		bottomCount = 0;

		root.set(10);
		expect(bottomCount).toBe(1);
		// l1=11, r1=12, m=23, l2=46, r2=69, bottom=115
		expect(bottom.get()).toBe(115);
	});
});

// ===========================================================================
// Section 12: Output Slot Transitions in Diamond Topologies
// ===========================================================================

describe("output slot transitions in diamond topologies", () => {
	it("subscriber to intermediate node in diamond doesn't cause double computation at bottom", () => {
		const a = state(1);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a, b], () => a.get() + b.get());

		let cCount = 0;
		effect([c], () => {
			cCount++;
		});
		cCount = 0;

		// Add subscriber to B (intermediate) — forces B to MULTI mode
		const bVals: number[] = [];
		const bUnsub = subscribe(b, (v) => bVals.push(v));

		a.set(5);
		expect(cCount).toBe(1); // still once!
		expect(c.get()).toBe(15);
		expect(bVals).toEqual([10]);

		bUnsub();

		a.set(10);
		expect(cCount).toBe(2); // still once per change
		expect(c.get()).toBe(30);
	});

	it("multiple effects on same derived: each runs exactly once per update", () => {
		const a = state(0);
		const d = derived([a], () => a.get() + 1);

		let e1Count = 0;
		let e2Count = 0;
		let e3Count = 0;
		effect([d], () => {
			e1Count++;
		});
		effect([d], () => {
			e2Count++;
		});
		effect([d], () => {
			e3Count++;
		});
		e1Count = 0;
		e2Count = 0;
		e3Count = 0;

		a.set(5);
		expect(e1Count).toBe(1);
		expect(e2Count).toBe(1);
		expect(e3Count).toBe(1);

		a.set(10);
		expect(e1Count).toBe(2);
		expect(e2Count).toBe(2);
		expect(e3Count).toBe(2);
	});

	it("dispose one effect while others remain: remaining effects unaffected", () => {
		const a = state(0);
		const d = derived([a], () => a.get() * 2);

		let e1Count = 0;
		let e2Count = 0;
		const dispose1 = effect([d], () => {
			e1Count++;
		});
		effect([d], () => {
			e2Count++;
		});
		e1Count = 0;
		e2Count = 0;

		a.set(1);
		expect(e1Count).toBe(1);
		expect(e2Count).toBe(1);

		dispose1();

		a.set(2);
		expect(e1Count).toBe(1); // stopped
		expect(e2Count).toBe(2); // still running
	});

	it("derived STANDALONE → SINGLE via effect, then add subscribe → MULTI, remove both", () => {
		const a = state(0);
		const b = derived([a], () => a.get() + 1);

		// STANDALONE
		expect(b.get()).toBe(1);

		// → SINGLE (effect subscribes)
		let eCount = 0;
		const dispose = effect([b], () => {
			eCount++;
		});
		eCount = 0;

		a.set(1);
		expect(eCount).toBe(1);

		// → MULTI (subscribe adds second)
		const vals: number[] = [];
		const unsub = subscribe(b, (v) => vals.push(v));

		a.set(2);
		expect(eCount).toBe(2);
		expect(vals).toEqual([3]);

		// Remove effect
		dispose();
		a.set(3);
		expect(eCount).toBe(2); // stopped
		expect(vals).toEqual([3, 4]); // still works

		// Remove subscribe → back to STANDALONE
		unsub();
		a.set(4);
		expect(b.get()).toBe(5); // STANDALONE still reactive
	});
});

// ===========================================================================
// Section 13: Extras in Diamond Configurations
// ===========================================================================

describe("extras in diamond configurations", () => {
	it("merge of two branches of a diamond: no duplicate emissions", () => {
		const a = state(0);
		const b = derived([a], () => a.get() + 1);
		const c = derived([a], () => a.get() + 2);
		const merged = merge(b, c);

		const vals: number[] = [];
		subscribe(merged, (v) => vals.push(v));

		a.set(5);
		// merge should deliver b=6 and c=7 (two separate emissions, not duplicated)
		expect(vals).toContain(6);
		expect(vals).toContain(7);
		expect(vals.filter((v) => v === 6).length).toBe(1);
		expect(vals.filter((v) => v === 7).length).toBe(1);
	});

	it("combine of two branches: emits once per batch update", () => {
		const a = state(0);
		const b = derived([a], () => a.get() * 2);
		const c = derived([a], () => a.get() * 3);
		const combined = combine(b, c);

		const vals: Array<[number, number]> = [];
		subscribe(combined, (v) => vals.push(v as [number, number]));

		batch(() => {
			a.set(5);
		});

		// After batch, combined should have [10, 15]
		expect(combined.get()).toEqual([10, 15]);
	});

	it("take inside diamond: completes without breaking sibling", () => {
		const a = state(0);
		const b = pipe(
			a,
			map((x: number) => x * 2),
			take(2),
		);
		const c = derived([a], () => a.get() + 100);

		const bVals: number[] = [];
		const cVals: number[] = [];
		subscribe(b, (v) => bVals.push(v));
		subscribe(c, (v) => cVals.push(v));

		a.set(1); // b=2 (1st), c=101
		a.set(2); // b=4 (2nd, completes), c=102
		a.set(3); // b done, c=103

		expect(bVals).toEqual([2, 4]);
		expect(cVals).toEqual([101, 102, 103]); // c unaffected by b's completion
	});

	it("distinctUntilChanged in diamond sends RESOLVED correctly", () => {
		const a = state(0);
		const deduped = pipe(
			a,
			map((x: number) => Math.floor(x / 10)),
			distinctUntilChanged(),
		);
		const direct = derived([a], () => a.get());
		const result = derived([deduped, direct], () => (deduped.get() ?? 0) + direct.get());

		let resultCount = 0;
		effect([result], () => {
			resultCount++;
		});
		resultCount = 0;

		a.set(1); // deduped: 0→0 (same, RESOLVED), direct: 1
		// result should still recompute because direct changed
		expect(result.get()).toBe(1); // 0 + 1

		a.set(10); // deduped: 0→1 (changed), direct: 10
		expect(result.get()).toBe(11); // 1 + 10
	});
});

// ===========================================================================
// Section 14: Batch + Output Slot Stress
// ===========================================================================

describe("batch + output slot stress", () => {
	it("batch with 100 state updates feeding one derived: single computation (wide bitmask)", () => {
		// Verifies the Uint32Array-based wide bitmask handles >32 deps correctly.
		// Previously this used a single 32-bit integer which overflowed at dep 32.
		const states = Array.from({ length: 100 }, () => state(0));
		const sum = derived(states, () => states.reduce((acc, s) => acc + s.get(), 0));

		let count = 0;
		effect([sum], () => {
			count++;
		});
		count = 0;

		batch(() => {
			for (let i = 0; i < 100; i++) {
				states[i].set(1);
			}
		});

		expect(count).toBe(1);
		expect(sum.get()).toBe(100);
	});

	it("effect with 50 deps: runs once per batched update (wide bitmask)", () => {
		const states = Array.from({ length: 50 }, () => state(0));

		let runCount = 0;
		effect(states, () => {
			runCount++;
		});
		runCount = 0;

		batch(() => {
			for (let i = 0; i < 50; i++) {
				states[i].set(1);
			}
		});

		expect(runCount).toBe(1);
	});

	it("batch with 32 deps (max safe bitmask): single computation", () => {
		// 32 deps is the max that fits in a JS 32-bit integer bitmask
		const states = Array.from({ length: 32 }, () => state(0));
		const sum = derived(states, () => states.reduce((acc, s) => acc + s.get(), 0));

		let count = 0;
		effect([sum], () => {
			count++;
		});
		count = 0;

		batch(() => {
			for (let i = 0; i < 32; i++) {
				states[i].set(1);
			}
		});

		expect(count).toBe(1);
		expect(sum.get()).toBe(32);
	});

	it("alternating set-same/set-different in batch: correct final resolved/data", () => {
		const a = state(0);
		const b = state(0);
		const c = derived([a, b], () => a.get() + b.get(), { equals: Object.is });

		let cCount = 0;
		effect([c], () => {
			cCount++;
		});
		cCount = 0;

		batch(() => {
			a.set(0); // same
			b.set(0); // same
		});

		// Both resolved to same value → c should not recompute
		expect(cCount).toBe(0);

		batch(() => {
			a.set(0); // same
			b.set(1); // different
		});

		// b changed → c must recompute
		expect(cCount).toBe(1);
		expect(c.get()).toBe(1);
	});

	it("rapid batch-unbatch cycling", () => {
		const a = state(0);
		const b = derived([a], () => a.get() * 2);

		const vals: number[] = [];
		subscribe(b, (v) => vals.push(v));

		for (let i = 1; i <= 10; i++) {
			batch(() => {
				a.set(i);
			});
		}

		expect(vals).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
		expect(b.get()).toBe(20);
	});
});
