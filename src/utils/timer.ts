// ---------------------------------------------------------------------------
// timer — reactive countdown and stopwatch (signal-based lifecycle)
// ---------------------------------------------------------------------------
// Reactive timers controlled entirely via lifecycle signals.
// No imperative methods — auto-starts on first subscription,
// controlled via sub.signal(PAUSE/RESUME/RESET) from subscribers.
//
// PAUSE  — stop ticking, preserve current state
// RESUME — resume ticking (or start from reset state)
// RESET  — stop ticking, restore to initial values
// TEARDOWN — handled by producer cleanup (dispose ticker)
//
// Built on: producer, derived
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { producer } from "../core/producer";
import { PAUSE, RESET, RESUME } from "../core/protocol";
import type { Store } from "../core/types";

// ---------------------------------------------------------------------------
// Shared ticker — internal helper (unchanged)
// ---------------------------------------------------------------------------

interface Ticker {
	start(): void;
	pause(): number;
	resume(): void;
	stop(): void;
	readonly active: boolean;
	readonly disposed: boolean;
	dispose(): void;
}

function createTicker(tickMs: number, onTick: (delta: number) => void): Ticker {
	let timerId: ReturnType<typeof setInterval> | null = null;
	let lastTick = 0;
	let disposed = false;
	let active = false;

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
		onTick(delta);
	}

	return {
		start() {
			if (disposed) return;
			clearTimer();
			lastTick = Date.now();
			active = true;
			timerId = setInterval(tick, tickMs);
		},
		pause(): number {
			if (disposed || !active) return 0;
			const now = Date.now();
			const delta = now - lastTick;
			active = false;
			clearTimer();
			return delta;
		},
		resume() {
			if (disposed || active) return;
			lastTick = Date.now();
			active = true;
			timerId = setInterval(tick, tickMs);
		},
		stop() {
			if (disposed) return;
			active = false;
			clearTimer();
		},
		get active() {
			return active;
		},
		get disposed() {
			return disposed;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			active = false;
			clearTimer();
		},
	};
}

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

export interface CountdownOptions {
	/** Tick interval in ms. Default: 100 */
	tickMs?: number;
	/** Debug name prefix. */
	name?: string;
}

interface CountdownState {
	remaining: number;
	active: boolean;
	expired: boolean;
}

export interface CountdownResult {
	/** Milliseconds remaining. */
	remaining: Store<number>;
	/** Whether the countdown is actively ticking. */
	active: Store<boolean>;
	/** Whether the countdown has reached zero. */
	expired: Store<boolean>;
}

/**
 * Creates a reactive countdown timer controlled via lifecycle signals.
 *
 * Auto-starts on first subscription. Control via `sub.signal(PAUSE/RESUME/RESET)`.
 * RESET stops and restores to initial duration. RESUME starts/resumes ticking.
 *
 * @param ms - Duration in milliseconds.
 * @param opts - Optional configuration.
 *
 * @returns `CountdownResult` — reactive remaining/active/expired stores.
 *
 * @example
 * ```ts
 * import { countdown } from 'callbag-recharge/utils/timer';
 * import { subscribe, PAUSE, RESUME, RESET } from 'callbag-recharge';
 *
 * const timer = countdown(5000);
 * const sub = subscribe(timer.remaining, (v) => console.log(v));
 * // Timer auto-starts, counting down from 5000
 * sub.signal(PAUSE);   // pause
 * sub.signal(RESUME);  // resume
 * sub.signal(RESET);   // stop + reset to 5000
 * sub.signal(RESUME);  // start again
 * sub.unsubscribe();   // disconnect (timer stops if no other subscribers)
 * ```
 *
 * @category utils
 */
export function countdown(ms: number, opts?: CountdownOptions): CountdownResult {
	const tickMs = Math.max(1, opts?.tickMs ?? 100);
	const prefix = opts?.name ?? "countdown";

	const initial: CountdownState = { remaining: ms, active: false, expired: false };

	const internal = producer<CountdownState>(
		({ emit, onSignal }) => {
			let remaining = ms;
			let active = true;

			const ticker = createTicker(tickMs, (delta) => {
				remaining -= delta;
				if (remaining <= 0) {
					remaining = 0;
					active = false;
					ticker.stop();
				}
				emit({ remaining, active, expired: remaining <= 0 });
			});

			function emitState(): void {
				emit({ remaining, active, expired: remaining <= 0 });
			}

			onSignal((s) => {
				if (s === PAUSE) {
					if (!ticker.active) return;
					const delta = ticker.pause();
					if (delta > 0) remaining = Math.max(0, remaining - delta);
					active = false;
					emitState();
				} else if (s === RESUME) {
					if (ticker.active || remaining <= 0) return;
					ticker.resume();
					active = true;
					emitState();
				} else if (s === RESET) {
					ticker.stop();
					remaining = ms;
					active = false;
					emitState();
				}
			});

			// Auto-start
			emitState();
			ticker.start();

			return () => ticker.dispose();
		},
		{ initial, name: prefix, kind: "countdown" },
	);

	return {
		remaining: derived([internal], () => internal.get()?.remaining ?? ms, {
			name: `${prefix}.remaining`,
		}),
		active: derived([internal], () => internal.get()?.active ?? false, {
			name: `${prefix}.active`,
			equals: Object.is,
		}),
		expired: derived([internal], () => internal.get()?.expired ?? false, {
			name: `${prefix}.expired`,
			equals: Object.is,
		}),
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

interface StopwatchState {
	elapsed: number;
	active: boolean;
	laps: readonly number[];
}

export interface StopwatchResult {
	/** Milliseconds elapsed. */
	elapsed: Store<number>;
	/** Whether the stopwatch is actively ticking. */
	active: Store<boolean>;
	/** Recorded lap times. */
	laps: Store<readonly number[]>;
}

/**
 * Creates a reactive stopwatch controlled via lifecycle signals.
 *
 * Auto-starts on first subscription. Control via `sub.signal(PAUSE/RESUME/RESET)`.
 * RESET stops and clears elapsed/laps. RESUME starts/resumes ticking.
 *
 * @param opts - Optional configuration.
 *
 * @returns `StopwatchResult` — reactive elapsed/active/laps stores.
 *
 * @example
 * ```ts
 * import { stopwatch } from 'callbag-recharge/utils/timer';
 * import { subscribe, PAUSE, RESUME, RESET } from 'callbag-recharge';
 *
 * const sw = stopwatch();
 * const sub = subscribe(sw.elapsed, (v) => console.log(v));
 * // Stopwatch auto-starts
 * sub.signal(PAUSE);   // pause
 * sub.signal(RESUME);  // resume
 * sub.signal(RESET);   // stop + clear to 0
 * sub.unsubscribe();   // disconnect
 * ```
 *
 * @category utils
 */
export function stopwatch(opts?: StopwatchOptions): StopwatchResult {
	const tickMs = Math.max(1, opts?.tickMs ?? 100);
	const prefix = opts?.name ?? "stopwatch";

	const initial: StopwatchState = { elapsed: 0, active: false, laps: [] };

	const internal = producer<StopwatchState>(
		({ emit, onSignal }) => {
			let elapsed = 0;
			let active = true;
			let laps: number[] = [];

			const ticker = createTicker(tickMs, (delta) => {
				elapsed += delta;
				emit({ elapsed, active, laps });
			});

			function emitState(): void {
				emit({ elapsed, active, laps });
			}

			onSignal((s) => {
				if (s === PAUSE) {
					if (!ticker.active) return;
					const delta = ticker.pause();
					if (delta > 0) elapsed += delta;
					active = false;
					emitState();
				} else if (s === RESUME) {
					if (ticker.active) return;
					ticker.resume();
					active = true;
					emitState();
				} else if (s === RESET) {
					ticker.stop();
					elapsed = 0;
					active = false;
					laps = [];
					emitState();
				}
			});

			// Auto-start
			emitState();
			ticker.start();

			return () => ticker.dispose();
		},
		{ initial, name: prefix, kind: "stopwatch" },
	);

	return {
		elapsed: derived([internal], () => internal.get()?.elapsed ?? 0, {
			name: `${prefix}.elapsed`,
		}),
		active: derived([internal], () => internal.get()?.active ?? false, {
			name: `${prefix}.active`,
			equals: Object.is,
		}),
		laps: derived([internal], () => internal.get()?.laps ?? [], {
			name: `${prefix}.laps`,
		}),
	};
}
