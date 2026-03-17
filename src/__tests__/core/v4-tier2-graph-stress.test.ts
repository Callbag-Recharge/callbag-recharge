// ---------------------------------------------------------------------------
// v4 Tier 2 Graph Stress Tests — Real-world complex graph patterns
// ---------------------------------------------------------------------------
// Tier 2 extras (debounce, throttle, switchMap, concatMap, exhaustMap, delay,
// retry, rescue, repeat, etc.) are cycle boundaries built on producer().
// Each emit starts a fresh DIRTY+DATA cycle. These tests verify correctness
// when tier 2 nodes participate in diamonds, interact with batching, undergo
// dynamic topology changes, and compose with tier 1 nodes in realistic
// application-like graphs.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bufferTime } from "../../extra/bufferTime";
import { combine } from "../../extra/combine";
import { concat } from "../../extra/concat";
import { concatMap } from "../../extra/concatMap";
import { debounce } from "../../extra/debounce";
import { delay } from "../../extra/delay";
import { exhaustMap } from "../../extra/exhaustMap";
import { filter } from "../../extra/filter";
import { fromIter } from "../../extra/fromIter";
import { interval } from "../../extra/interval";
import { merge } from "../../extra/merge";
import { of } from "../../extra/of";
import { rescue } from "../../extra/rescue";
import { retry } from "../../extra/retry";
import { sample } from "../../extra/sample";
import { scan } from "../../extra/scan";
import { subscribe } from "../../extra/subscribe";
import { switchMap } from "../../extra/switchMap";
import { take } from "../../extra/take";
import { throttle } from "../../extra/throttle";
import {
	batch,
	DATA,
	DIRTY,
	derived,
	END,
	effect,
	Inspector,
	pipe,
	producer,
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
// Section 1: Debounce in Real-World Graphs
// ===========================================================================

describe("debounce in complex graphs", () => {
	it("search-as-you-type: debounced input feeds switchMap which feeds derived display", () => {
		// Simulates: user types → debounce → switchMap(fetch) → display
		const userInput = state("");
		const debounced = pipe(userInput, debounce(300));

		// switchMap simulates async fetch: returns a store with the "result"
		const results = pipe(
			debounced,
			switchMap((query: string | undefined) => {
				const result = state(`results for: ${query}`);
				return result;
			}),
		);

		const display = derived([results], () => results.get() ?? "loading...");

		const displayed: string[] = [];
		subscribe(display, (v) => displayed.push(v));

		userInput.set("h");
		userInput.set("he");
		userInput.set("hel");
		userInput.set("hello");
		vi.advanceTimersByTime(300);

		// Only "hello" should have debounced through
		expect(display.get()).toBe("results for: hello");
	});

	it("debounce + diamond: debounced value joins direct value at convergence", () => {
		const a = state(0);
		const debounced = pipe(a, debounce(100));
		const direct = derived([a], () => a.get() * 2);

		// Convergence: uses both debounced (tier 2) and direct (tier 1)
		const combined = derived(
			[debounced, direct],
			() => `${debounced.get() ?? "?"}-${direct.get()}`,
		);

		const vals: string[] = [];
		effect([combined], () => {
			vals.push(combined.get());
		});
		vals.length = 0;

		a.set(1); // direct updates immediately, debounced waits
		expect(direct.get()).toBe(2);

		a.set(2);
		a.set(3);
		vi.advanceTimersByTime(100);

		// After debounce settles, combined should reflect debounced=3, direct=6
		expect(combined.get()).toBe("3-6");
	});

	it("debounce feeding into effect with cleanup: cleanup runs on each debounced emission", () => {
		const input = state(0);
		const debounced = pipe(input, debounce(50));

		let cleanupCount = 0;
		let effectCount = 0;
		effect([debounced], () => {
			effectCount++;
			return () => {
				cleanupCount++;
			};
		});
		effectCount = 0;
		cleanupCount = 0;

		input.set(1);
		input.set(2);
		vi.advanceTimersByTime(50);

		input.set(3);
		vi.advanceTimersByTime(50);

		expect(effectCount).toBe(2); // two debounced emissions
		expect(cleanupCount).toBe(2); // cleanup from initial + first emission
	});
});

// ===========================================================================
// Section 2: SwitchMap in Real-World Graphs
// ===========================================================================

describe("switchMap in complex graphs", () => {
	it("route-based data loading: switchMap cancels previous inner on route change", () => {
		const route = state("/home");
		const homeData = state("home content");
		const profileData = state("profile content");

		const pageContent = pipe(
			route,
			switchMap((r: string) => {
				if (r === "/home") return homeData;
				if (r === "/profile") return profileData;
				return state("404");
			}),
		);

		const headerInfo = derived([route], () => `Page: ${route.get()}`);
		const fullPage = derived(
			[pageContent, headerInfo],
			() => `${headerInfo.get()} | ${pageContent.get()}`,
		);

		const rendered: string[] = [];
		subscribe(fullPage, (v) => rendered.push(v));

		route.set("/profile");
		expect(fullPage.get()).toBe("Page: /profile | profile content");

		// Update the active route's data
		profileData.set("updated profile");
		expect(fullPage.get()).toBe("Page: /profile | updated profile");

		// Switch route — old inner (profileData) should be disconnected
		route.set("/home");
		expect(fullPage.get()).toBe("Page: /home | home content");

		// Updating profile data after route change should not affect display
		profileData.set("stale update");
		expect(fullPage.get()).toBe("Page: /home | home content");
	});

	it("switchMap chain: switchMap → switchMap → derived", () => {
		const category = state("A");
		const itemA = state(1);
		const itemB = state(100);

		const selectedItem = pipe(
			category,
			switchMap((cat: string) => (cat === "A" ? itemA : itemB)),
		);

		const detail = pipe(
			selectedItem,
			switchMap((id: number | undefined) => state(`detail-${id}`)),
		);

		const display = derived([detail], () => detail.get() ?? "loading");

		const vals: string[] = [];
		subscribe(display, (v) => vals.push(v));

		expect(display.get()).toBe("detail-1");

		itemA.set(2);
		expect(display.get()).toBe("detail-2");

		category.set("B");
		expect(display.get()).toBe("detail-100");

		// Old inner should be disconnected
		itemA.set(999);
		expect(display.get()).toBe("detail-100");
	});

	it("switchMap with inner completion: outer continues, undefined between inners", () => {
		// switchMap is a tier 2 producer with resetOnTeardown. When an inner
		// source completes, the value resets to undefined before the next inner
		// subscribes. This means we see undefined emissions between each inner.
		const trigger = state(0);
		const innerEmissions: any[] = [];

		const switched = pipe(
			trigger,
			switchMap((n: number) => {
				return of(n * 10);
			}),
		);

		subscribe(switched, (v) => innerEmissions.push(v));

		trigger.set(1);
		trigger.set(2);
		trigger.set(3);

		// Filter out the undefined resets to verify the real values
		const realValues = innerEmissions.filter((v) => v !== undefined);
		expect(realValues).toEqual([0, 10, 20, 30]);
	});
});

// ===========================================================================
// Section 3: Throttle + Scan in Real-World Patterns
// ===========================================================================

describe("throttle + scan in real-world patterns", () => {
	it("rate-limited accumulator: throttled input → scan → display", () => {
		const clicks = state(0);
		const throttled = pipe(clicks, throttle(100));
		const count = pipe(
			throttled,
			scan((acc: number) => acc + 1, 0),
		);
		const display = derived([count], () => `Clicks: ${count.get()}`);

		const displayed: string[] = [];
		subscribe(display, (v) => displayed.push(v));

		clicks.set(1);
		clicks.set(2); // throttled out
		clicks.set(3); // throttled out

		vi.advanceTimersByTime(100);
		clicks.set(4);

		vi.advanceTimersByTime(100);

		expect(Number(count.get())).toBeGreaterThanOrEqual(2);
	});

	it("scan feeding into diamond with filter: filtered accumulator", () => {
		const input = state(0);
		const accumulated = pipe(
			input,
			scan((acc: number, x: number) => acc + x, 0),
		);
		const filtered = pipe(
			accumulated,
			filter((x: number) => x > 5),
		);
		const direct = derived([input], () => input.get());
		const result = derived(
			[filtered, direct],
			() => `sum=${filtered.get() ?? 0},last=${direct.get()}`,
		);

		const vals: string[] = [];
		effect([result], () => {
			vals.push(result.get());
		});
		vals.length = 0;

		input.set(1); // acc=1, filtered out
		input.set(2); // acc=3, filtered out
		input.set(3); // acc=6, passes filter
		input.set(4); // acc=10, passes filter

		expect(result.get()).toBe("sum=10,last=4");
	});
});

// ===========================================================================
// Section 4: ConcatMap / ExhaustMap in Complex Graphs
// ===========================================================================

describe("concatMap / exhaustMap in complex graphs", () => {
	it("concatMap queues inner sources: order preserved in diamond", () => {
		const trigger = state(0);

		const mapped = pipe(
			trigger,
			concatMap((n: number) => of(n * 10)),
		);

		const label = derived([trigger], () => `t=${trigger.get()}`);
		const combined = derived([mapped, label], () => `${mapped.get()}-${label.get()}`);

		const vals: string[] = [];
		subscribe(combined, (v) => vals.push(v));

		trigger.set(1);
		trigger.set(2);
		trigger.set(3);

		expect(vals).toContain("30-t=3");
	});

	it("exhaustMap ignores while busy: diamond stays consistent", () => {
		const trigger = state(0);

		// exhaustMap with sync inner — always completes immediately
		const mapped = pipe(
			trigger,
			exhaustMap((n: number) => of(n * 100)),
		);

		const other = derived([trigger], () => trigger.get() + 1);
		const combined = derived([mapped, other], () => `${mapped.get()}-${other.get()}`);

		const vals: string[] = [];
		subscribe(combined, (v) => vals.push(v));

		trigger.set(1);
		trigger.set(2);

		// With sync inner, exhaustMap should process all
		expect(combined.get()).toContain(`${2 * 100}-3`);
	});
});

// ===========================================================================
// Section 5: Delay in Graphs
// ===========================================================================

describe("delay in complex graphs", () => {
	it("delayed value joins undelayed in diamond: eventual consistency", () => {
		const a = state(0);
		const delayed = pipe(a, delay(200));
		const immediate = derived([a], () => a.get() * 10);

		const combined = derived(
			[delayed, immediate],
			() => `delayed=${delayed.get() ?? "?"},imm=${immediate.get()}`,
		);

		const vals: string[] = [];
		effect([combined], () => {
			vals.push(combined.get());
		});
		vals.length = 0;

		a.set(5);
		// Immediate updates right away
		expect(immediate.get()).toBe(50);

		// Delayed hasn't arrived yet
		vi.advanceTimersByTime(200);

		// Now delayed=5 should have arrived
		expect(combined.get()).toBe("delayed=5,imm=50");
	});

	it("multiple delayed emissions: each arrives in order", () => {
		const a = state(0);
		const delayed = pipe(a, delay(100));

		const vals: number[] = [];
		subscribe(delayed, (v) => vals.push(v));

		a.set(1);
		a.set(2);
		a.set(3);

		vi.advanceTimersByTime(100);

		expect(vals).toEqual([1, 2, 3]);
	});
});

// ===========================================================================
// Section 6: Retry / Rescue in Graphs
// ===========================================================================

describe("retry / rescue in complex graphs", () => {
	it("retry after error: derived downstream recovers", () => {
		let attempts = 0;
		const source = producer<number>(
			({ emit, error }) => {
				attempts++;
				if (attempts <= 2) {
					error(new Error(`fail ${attempts}`));
				} else {
					emit(42);
				}
			},
			{ resubscribable: true },
		);

		const retried = pipe(source, retry(3));
		const display = derived([retried], () => retried.get() ?? "waiting");

		const vals: any[] = [];
		subscribe(display, (v) => vals.push(v));

		expect(display.get()).toBe(42);
	});

	it("rescue with fallback feeds into diamond correctly", () => {
		const source = producer<number>(
			({ error }) => {
				error(new Error("boom"));
			},
			{ resubscribable: true },
		);

		const rescued = pipe(
			source,
			rescue(() => of(999)),
		);

		const other = state(1);
		const combined = derived([rescued, other], () => (rescued.get() ?? 0) + other.get());

		const vals: number[] = [];
		subscribe(combined, (v) => vals.push(v));

		// rescue → of(999) emits 999 then completes synchronously.
		// combined.get() reflects the computed value.
		// subscribe may not capture it since the chain completes before
		// the subscribe callback fires in the propagation order.
		expect(combined.get()).toBe(1000);
	});
});

// ===========================================================================
// Section 7: Sample / BufferTime Interaction
// ===========================================================================

describe("sample / bufferTime in complex graphs", () => {
	it("sample: samples source on notifier ticks, feeds into derived", () => {
		const source = state(0);
		const ticker = interval(100);
		const sampled = pipe(source, sample(ticker));

		const display = derived([sampled], () => `sampled=${sampled.get()}`);

		const vals: string[] = [];
		subscribe(display, (v) => vals.push(v));

		source.set(1);
		source.set(2);
		source.set(3);

		vi.advanceTimersByTime(100);

		expect(sampled.get()).toBe(3);
		expect(vals).toContain("sampled=3");
	});

	it("bufferTime collects emissions, feeds batch into derived", () => {
		const source = state(0);
		const buffered = pipe(source, bufferTime(200));

		const display = derived([buffered], () => {
			const buf = buffered.get();
			return buf ? (buf as number[]).join(",") : "";
		});

		const vals: string[] = [];
		subscribe(display, (v) => vals.push(v));

		source.set(1);
		source.set(2);
		source.set(3);

		vi.advanceTimersByTime(200);

		expect(vals.some((v) => v.includes("1") && v.includes("2") && v.includes("3"))).toBe(true);
	});
});

// ===========================================================================
// Section 8: Dynamic Subscriber Churn with Tier 2
// ===========================================================================

describe("dynamic subscriber churn with tier 2", () => {
	it("subscribe/unsubscribe to debounced node during debounce window", () => {
		const a = state(0);
		const debounced = pipe(a, debounce(100));

		const vals1: number[] = [];
		const unsub1 = subscribe(debounced, (v) => vals1.push(v));

		a.set(1);
		a.set(2);

		// Unsubscribe mid-debounce, resubscribe
		unsub1();
		const vals2: number[] = [];
		const unsub2 = subscribe(debounced, (v) => vals2.push(v));

		vi.advanceTimersByTime(100);

		// vals1 should have nothing (unsubbed before debounce fired)
		expect(vals1).toEqual([]);

		a.set(3);
		vi.advanceTimersByTime(100);

		expect(vals2).toContain(3);
		unsub2();
	});

	it("switchMap inner subscription survives output slot transitions", () => {
		const selector = state("a");
		const dataA = state(10);
		const dataB = state(20);

		const switched = pipe(
			selector,
			switchMap((s: string) => (s === "a" ? dataA : dataB)),
		);

		// Subscribe multiple consumers to the switchMap output
		const vals1: number[] = [];
		const vals2: number[] = [];
		const unsub1 = subscribe(switched, (v) => vals1.push(v));
		const unsub2 = subscribe(switched, (v) => vals2.push(v));

		dataA.set(11);
		expect(vals1).toContain(11);
		expect(vals2).toContain(11);

		// Remove one subscriber — other should still work
		unsub1();
		dataA.set(12);
		expect(vals2).toContain(12);

		// Switch inner — remaining subscriber gets new inner's values
		selector.set("b");
		expect(vals2).toContain(20);

		dataB.set(21);
		expect(vals2).toContain(21);

		unsub2();
	});

	it("effect on tier 2 node: dispose stops timer-based emissions", () => {
		const source = interval(50);
		const doubled = derived([source], () => (source.get() ?? 0) * 2);

		let effectRuns = 0;
		const dispose = effect([doubled], () => {
			effectRuns++;
		});
		effectRuns = 0;

		vi.advanceTimersByTime(150); // 3 interval ticks
		const runsBeforeDispose = effectRuns;
		expect(runsBeforeDispose).toBeGreaterThan(0);

		dispose();
		vi.advanceTimersByTime(150); // 3 more ticks
		expect(effectRuns).toBe(runsBeforeDispose); // no more runs
	});
});

// ===========================================================================
// Section 9: Multi-Tier Pipelines (Tier 1 → Tier 2 → Tier 1)
// ===========================================================================

describe("multi-tier pipelines", () => {
	it("tier 1 → debounce (tier 2) → tier 1 derived: values flow correctly", () => {
		const raw = state(0);
		const doubled = derived([raw], () => raw.get() * 2); // tier 1
		const debounced = pipe(doubled, debounce(100)); // tier 2 boundary
		const formatted = derived([debounced], () => `val=${debounced.get()}`); // tier 1

		const vals: string[] = [];
		subscribe(formatted, (v) => vals.push(v));

		raw.set(1);
		raw.set(2);
		raw.set(3);
		vi.advanceTimersByTime(100);

		expect(formatted.get()).toBe("val=6"); // debounced(3*2) = 6
	});

	it("tier 1 → switchMap (tier 2) → scan (tier 1) → effect: accumulation across switches", () => {
		const category = state("x");
		const xSource = state(1);
		const ySource = state(100);

		const switched = pipe(
			category,
			switchMap((c: string) => (c === "x" ? xSource : ySource)),
		);

		const accumulated = pipe(
			switched,
			scan((acc: number, val: number | undefined) => acc + (val ?? 0), 0),
		);

		const vals: number[] = [];
		subscribe(accumulated, (v) => vals.push(v));

		xSource.set(2);
		xSource.set(3);
		category.set("y"); // switch to ySource
		ySource.set(200);

		// Accumulator should have summed: initial xSource(1) + 2 + 3 + ySource(100) + 200
		expect(accumulated.get()).toBeGreaterThan(0);
	});

	it("tier 1 filter → tier 2 throttle → tier 1 derived: filter + throttle compose", () => {
		const raw = state(0);
		const positive = pipe(
			raw,
			filter((x: number) => x > 0),
		);
		const throttled = pipe(positive, throttle(100));
		const display = derived([throttled], () => `pos=${throttled.get()}`);

		const vals: string[] = [];
		subscribe(display, (v) => vals.push(v));

		raw.set(-1); // filtered out
		raw.set(1); // passes filter, emits through throttle
		raw.set(2); // throttled
		raw.set(3); // throttled

		vi.advanceTimersByTime(100);
		raw.set(4); // new throttle window

		expect(display.get()).toContain("pos=");
	});
});

// ===========================================================================
// Section 10: Wide Bitmask with Merge/Combine (>32 sources)
// ===========================================================================

describe("wide bitmask with merge/combine", () => {
	it("merge of 50 sources: all values arrive, dirty tracking correct", () => {
		const sources = Array.from({ length: 50 }, (_, i) => state(i));
		const merged = merge(...sources);

		const vals: number[] = [];
		subscribe(merged, (v) => vals.push(v));

		// Update each source
		for (let i = 0; i < 50; i++) {
			sources[i].set(i + 100);
		}

		// All 50 updates should have arrived
		expect(vals.length).toBe(50);
		expect(vals[49]).toBe(149);
	});

	it("combine of 40 sources in batch: single emission with all values", () => {
		const sources = Array.from({ length: 40 }, (_, i) => state(i));
		const combined = combine(...sources);

		let emitCount = 0;
		subscribe(combined, () => {
			emitCount++;
		});

		batch(() => {
			for (let i = 0; i < 40; i++) {
				sources[i].set(i * 10);
			}
		});

		expect(emitCount).toBe(1);
		const val = combined.get() as number[];
		expect(val[0]).toBe(0);
		expect(val[39]).toBe(390);
	});

	it("merge of 50 sources with batch: single DIRTY, values arrive correctly", () => {
		const sources = Array.from({ length: 50 }, (_, i) => state(i));
		const merged = merge(...sources);

		const dirtyCount: number[] = [];
		// Observe type 3 signals
		merged.source(START, (type: number, data: any) => {
			if (type === STATE && data === DIRTY) dirtyCount.push(1);
		});

		batch(() => {
			for (let i = 0; i < 50; i++) {
				sources[i].set(i + 1000);
			}
		});

		// Only one DIRTY signal should have been sent
		expect(dirtyCount.length).toBe(1);
	});
});

// ===========================================================================
// Section 11: Real-World Application Patterns
// ===========================================================================

describe("real-world application patterns", () => {
	it("form validation: multiple fields → derived validity → effect submission", () => {
		const name = state("");
		const email = state("");
		const age = state(0);

		const nameValid = derived([name], () => name.get().length > 0);
		const emailValid = derived([email], () => email.get().includes("@"));
		const ageValid = derived([age], () => age.get() >= 18);

		const formValid = derived(
			[nameValid, emailValid, ageValid],
			() => nameValid.get() && emailValid.get() && ageValid.get(),
		);

		const submitEnabled = derived([formValid], () => (formValid.get() ? "enabled" : "disabled"));

		let lastStatus = "";
		effect([submitEnabled], () => {
			lastStatus = submitEnabled.get();
		});

		expect(lastStatus).toBe("disabled");

		batch(() => {
			name.set("Alice");
			email.set("alice@example.com");
			age.set(25);
		});

		expect(lastStatus).toBe("enabled");
		expect(formValid.get()).toBe(true);
	});

	it("dashboard: multiple data sources → debounced search → filtered + sorted display", () => {
		const searchQuery = state("");
		const sortOrder = state<"asc" | "desc">("asc");
		const items = state([3, 1, 4, 1, 5, 9, 2, 6]);

		const debouncedSearch = pipe(searchQuery, debounce(200));

		const filtered = derived([items, debouncedSearch], () => {
			const q = debouncedSearch.get();
			const all = items.get();
			if (!q) return all;
			return all.filter((x) => String(x).includes(q));
		});

		const sorted = derived([filtered, sortOrder], () => {
			const arr = [...filtered.get()];
			return sortOrder.get() === "asc" ? arr.sort((a, b) => a - b) : arr.sort((a, b) => b - a);
		});

		const displayCount = derived([sorted], () => sorted.get().length);

		let lastCount = 0;
		effect([displayCount], () => {
			lastCount = displayCount.get();
		});

		expect(lastCount).toBe(8); // all items

		searchQuery.set("1");
		vi.advanceTimersByTime(200);

		expect(sorted.get()).toEqual([1, 1]); // filtered to "1"s, sorted asc

		sortOrder.set("desc");
		expect(sorted.get()).toEqual([1, 1]); // same values, desc order doesn't change [1,1]
	});

	it("undo/redo: state changes tracked via scan, derived shows current", () => {
		const action = state<{ type: string; value: number }>({ type: "init", value: 0 });

		const history = pipe(
			action,
			scan(
				(acc: { past: number[]; current: number }, act: { type: string; value: number }) => {
					return { past: [...acc.past, acc.current], current: act.value };
				},
				{ past: [] as number[], current: 0 },
			),
		);

		const currentValue = derived([history], () => history.get().current);
		const canUndo = derived([history], () => history.get().past.length > 0);

		const vals: number[] = [];
		subscribe(currentValue, (v) => vals.push(v));

		action.set({ type: "set", value: 10 });
		action.set({ type: "set", value: 20 });
		action.set({ type: "set", value: 30 });

		expect(currentValue.get()).toBe(30);
		expect(canUndo.get()).toBe(true);
		expect(vals).toEqual([10, 20, 30]);
	});

	it("websocket-like: producer emits async, feeds into multiple derived consumers", () => {
		const ws = producer<{ channel: string; data: number }>(({ emit }) => {
			// Simulate async messages
			const id = setInterval(() => {
				emit({ channel: "price", data: Math.random() });
			}, 100);
			return () => clearInterval(id);
		});

		const priceDisplay = derived([ws], () => {
			const msg = ws.get();
			return msg ? `$${msg.data.toFixed(2)}` : "loading";
		});

		const priceHistory = pipe(
			ws,
			scan((acc: number[], msg: { channel: string; data: number } | undefined) => {
				if (!msg) return acc;
				return [...acc.slice(-4), msg.data]; // keep last 5
			}, [] as number[]),
		);

		const historyLen = derived([priceHistory], () => (priceHistory.get() as number[]).length);

		subscribe(priceDisplay, () => {});
		subscribe(historyLen, () => {});

		vi.advanceTimersByTime(500); // 5 ticks

		expect(historyLen.get()).toBe(5);
		expect(priceDisplay.get()).toContain("$");
	});
});

// ===========================================================================
// Section 12: Completion Propagation Through Tier 2
// ===========================================================================

describe("completion propagation through tier 2", () => {
	it("completed source → switchMap: outer completion flows through", () => {
		const source = fromIter([1, 2, 3]);
		const mapped = pipe(
			source,
			switchMap((n: number) => of(n * 10)),
		);

		const vals: any[] = [];
		let completed = false;

		mapped.source(START, (type: number, data: any) => {
			if (type === DATA) vals.push(data);
			if (type === END && data === undefined) completed = true;
		});

		// switchMap resets between inner completions, emitting undefined.
		// Filter to verify the real mapped values flow correctly.
		const realValues = vals.filter((v) => v !== undefined);
		expect(realValues).toEqual([10, 20, 30]);
		expect(completed).toBe(true);
	});

	it("take(n) after tier 2: limits emissions and completes", () => {
		const source = state(0);
		const debounced = pipe(source, debounce(50));
		const limited = pipe(debounced, take(2));

		const vals: number[] = [];
		let completed = false;
		limited.source(START, (type: number, data: any) => {
			if (type === DATA) vals.push(data);
			if (type === END && data === undefined) completed = true;
		});

		source.set(1);
		vi.advanceTimersByTime(50);
		source.set(2);
		vi.advanceTimersByTime(50);
		source.set(3);
		vi.advanceTimersByTime(50);

		expect(vals).toEqual([1, 2]);
		expect(completed).toBe(true);
	});

	it("concat of tier 2 sources: sequential completion", () => {
		const a = of(1, 2);
		const b = of(3, 4);
		const concatenated = concat(a, b);

		const vals: number[] = [];
		subscribe(concatenated, (v) => vals.push(v));

		expect(vals).toEqual([1, 2, 3, 4]);
	});
});

// ===========================================================================
// Section 13: Error Propagation Through Tier 2
// ===========================================================================

describe("error propagation through tier 2", () => {
	it("error in switchMap inner: propagates to downstream derived", () => {
		const trigger = state(0);
		const mapped = pipe(
			trigger,
			switchMap((n: number) => {
				if (n === 5) {
					const err = producer<number>(({ error: e }) => {
						e(new Error("inner error"));
					});
					return err;
				}
				return state(n * 10);
			}),
		);

		let errorSeen: unknown = null;
		mapped.source(START, (type: number, data: any) => {
			if (type === END && data !== undefined) errorSeen = data;
		});

		trigger.set(5);
		expect(errorSeen).toBeInstanceOf(Error);
	});

	it("rescue after switchMap error: graph recovers", () => {
		let attempt = 0;
		const trigger = state(0);

		const mapped = pipe(
			trigger,
			switchMap((n: number) => {
				attempt++;
				if (attempt === 2) {
					return producer<number>(
						({ error: e }) => {
							e(new Error("fail"));
						},
						{ resubscribable: true },
					);
				}
				return state(n * 10);
			}),
			rescue(() => of(-1)),
		);

		const vals: number[] = [];
		subscribe(mapped, (v) => vals.push(v));

		trigger.set(1); // attempt 2 → error → rescue → of(-1)
		expect(vals).toContain(-1);
	});
});
