// ---------------------------------------------------------------------------
// timer — reactive countdown and stopwatch
// ---------------------------------------------------------------------------
// Reactive timers with pause/resume/reset. Built on state + derived.
// interval() exists as a raw callbag source; these are controlled timer
// patterns with reactive state.
//
// Built on: state, derived
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { state } from "../core/state";
import type { Store } from "../core/types";

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

export interface CountdownOptions {
	/** Tick interval in ms. Default: 100 */
	tickMs?: number;
	/** Debug name prefix. */
	name?: string;
}

export interface CountdownResult {
	/** Milliseconds remaining. */
	remaining: Store<number>;
	/** Whether the countdown is actively ticking. */
	active: Store<boolean>;
	/** Whether the countdown has reached zero. */
	expired: Store<boolean>;
	/** Start the countdown. */
	start(): void;
	/** Pause the countdown. */
	pause(): void;
	/** Resume from paused state. */
	resume(): void;
	/** Reset the countdown (stops if running). */
	reset(ms?: number): void;
	/** Dispose — clears timers and prevents further operations. */
	dispose(): void;
}

/**
 * Creates a reactive countdown timer.
 *
 * @param ms - Duration in milliseconds.
 * @param opts - Optional configuration.
 *
 * @returns `CountdownResult` — reactive remaining/active/expired stores + control methods.
 *
 * @remarks **Tick interval:** Defaults to 100ms. Remaining is updated each tick.
 * @remarks **Expired:** Becomes true when remaining reaches 0. Timer auto-stops.
 *
 * @example
 * ```ts
 * import { countdown } from 'callbag-recharge/utils/timer';
 *
 * const timer = countdown(5000); // 5 seconds
 * timer.start();
 * timer.remaining.get(); // ~5000
 * timer.pause();
 * timer.resume();
 * timer.dispose();
 * ```
 *
 * @category utils
 */
export function countdown(ms: number, opts?: CountdownOptions): CountdownResult {
	const tickMs = Math.max(1, opts?.tickMs ?? 100);
	const prefix = opts?.name ?? "countdown";

	const remainingStore = state<number>(ms, { name: `${prefix}.remaining` });
	const activeStore = state<boolean>(false, { name: `${prefix}.active` });

	const expired = derived([remainingStore], () => remainingStore.get() <= 0, {
		name: `${prefix}.expired`,
	});

	let timerId: ReturnType<typeof setInterval> | null = null;
	let lastTick = 0;
	let disposed = false;

	function clearTimer(): void {
		if (timerId != null) {
			clearInterval(timerId);
			timerId = null;
		}
	}

	function tick(): void {
		const now = Date.now();
		const elapsed = now - lastTick;
		lastTick = now;

		const remaining = remainingStore.get() - elapsed;
		if (remaining <= 0) {
			remainingStore.set(0);
			activeStore.set(false);
			clearTimer();
		} else {
			remainingStore.set(remaining);
		}
	}

	function start(): void {
		if (disposed) return;
		clearTimer();
		remainingStore.set(ms);
		lastTick = Date.now();
		activeStore.set(true);
		timerId = setInterval(tick, tickMs);
	}

	function pause(): void {
		if (disposed) return;
		if (!activeStore.get()) return;
		// Account for partial tick
		const now = Date.now();
		const elapsed = now - lastTick;
		remainingStore.set(Math.max(0, remainingStore.get() - elapsed));
		activeStore.set(false);
		clearTimer();
	}

	function resume(): void {
		if (disposed) return;
		if (activeStore.get()) return;
		if (remainingStore.get() <= 0) return;
		lastTick = Date.now();
		activeStore.set(true);
		timerId = setInterval(tick, tickMs);
	}

	function reset(newMs?: number): void {
		if (disposed) return;
		clearTimer();
		activeStore.set(false);
		remainingStore.set(newMs ?? ms);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		clearTimer();
		activeStore.set(false);
	}

	return {
		remaining: remainingStore,
		active: activeStore,
		expired,
		start,
		pause,
		resume,
		reset,
		dispose,
	};
}

// ---------------------------------------------------------------------------
// Stopwatch
// ---------------------------------------------------------------------------

export interface StopwatchOptions {
	/** Tick interval in ms. Default: 100 */
	tickMs?: number;
	/** Debug name prefix. */
	name?: string;
}

export interface StopwatchResult {
	/** Milliseconds elapsed. */
	elapsed: Store<number>;
	/** Whether the stopwatch is actively ticking. */
	active: Store<boolean>;
	/** Recorded lap times. */
	laps: Store<readonly number[]>;
	/** Start the stopwatch. */
	start(): void;
	/** Pause the stopwatch. */
	pause(): void;
	/** Resume from paused state. */
	resume(): void;
	/** Record a lap (current elapsed added to laps). */
	lap(): void;
	/** Reset elapsed to 0, clear laps, stop if running. */
	reset(): void;
	/** Dispose — clears timers and prevents further operations. */
	dispose(): void;
}

/**
 * Creates a reactive stopwatch.
 *
 * @param opts - Optional configuration.
 *
 * @returns `StopwatchResult` — reactive elapsed/active/laps stores + control methods.
 *
 * @remarks **Tick interval:** Defaults to 100ms. Elapsed is updated each tick.
 * @remarks **Laps:** `lap()` records the current elapsed time without stopping.
 *
 * @example
 * ```ts
 * import { stopwatch } from 'callbag-recharge/utils/timer';
 *
 * const sw = stopwatch();
 * sw.start();
 * // ... time passes ...
 * sw.lap();
 * sw.laps.get(); // [elapsed_at_lap]
 * sw.pause();
 * sw.elapsed.get(); // total elapsed ms
 * sw.dispose();
 * ```
 *
 * @category utils
 */
export function stopwatch(opts?: StopwatchOptions): StopwatchResult {
	const tickMs = Math.max(1, opts?.tickMs ?? 100);
	const prefix = opts?.name ?? "stopwatch";

	const elapsedStore = state<number>(0, { name: `${prefix}.elapsed` });
	const activeStore = state<boolean>(false, { name: `${prefix}.active` });
	const lapsStore = state<readonly number[]>([], { name: `${prefix}.laps` });

	let timerId: ReturnType<typeof setInterval> | null = null;
	let lastTick = 0;
	let disposed = false;

	function clearTimer(): void {
		if (timerId != null) {
			clearInterval(timerId);
			timerId = null;
		}
	}

	function tick(): void {
		const now = Date.now();
		const delta = now - lastTick;
		lastTick = now;
		elapsedStore.update((e) => e + delta);
	}

	function start(): void {
		if (disposed) return;
		clearTimer();
		elapsedStore.set(0);
		lapsStore.set([]);
		lastTick = Date.now();
		activeStore.set(true);
		timerId = setInterval(tick, tickMs);
	}

	function pause(): void {
		if (disposed) return;
		if (!activeStore.get()) return;
		// Account for partial tick
		const now = Date.now();
		const delta = now - lastTick;
		elapsedStore.update((e) => e + delta);
		activeStore.set(false);
		clearTimer();
	}

	function resume(): void {
		if (disposed) return;
		if (activeStore.get()) return;
		lastTick = Date.now();
		activeStore.set(true);
		timerId = setInterval(tick, tickMs);
	}

	function lap(): void {
		if (disposed) return;
		if (!activeStore.get()) return;
		// Account for partial tick
		const now = Date.now();
		const delta = now - lastTick;
		lastTick = now;
		const current = elapsedStore.get() + delta;
		elapsedStore.set(current);
		lapsStore.update((l) => [...l, current]);
	}

	function reset(): void {
		if (disposed) return;
		clearTimer();
		activeStore.set(false);
		elapsedStore.set(0);
		lapsStore.set([]);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		clearTimer();
		activeStore.set(false);
	}

	return {
		elapsed: elapsedStore,
		active: activeStore,
		laps: lapsStore,
		start,
		pause,
		resume,
		lap,
		reset,
		dispose,
	};
}
