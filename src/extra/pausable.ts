import { operator } from "../core/operator";
import { DATA, DIRTY, END, PAUSE, RESOLVED, RESUME, STATE } from "../core/protocol";
import { state } from "../core/state";
import type { Store, StoreOptions } from "../core/types";

let lockCounter = 0;

/**
 * A store that can be paused and resumed.
 * When paused, DATA from upstream is captured but not forwarded.
 * When resumed, the latest upstream value is re-emitted.
 */
export interface PausableStore<A> extends Store<A> {
	/** Pause DATA forwarding. Dispatches PAUSE signal downstream. Returns a lock ID.
	 * If called before any subscriber connects, DATA gating is active but no signal is sent (no subscribers to receive it). */
	pause(): string;
	/** Resume DATA forwarding. Requires the lock ID from pause(). No-op if lock doesn't match. */
	resume(lockId: string): void;
	/** Reactive pause state — observable in the callbag graph. */
	readonly paused: Store<boolean>;
}

/**
 * Gates DATA flow through a pause/resume mechanism, with PAUSE/RESUME propagating as TYPE 3 STATE signals.
 *
 * @param opts - Optional `name` and `equals` for the output store.
 *
 * @returns A function that wraps an input store and returns a `PausableStore<A>`.
 *
 * @remarks **Lock-based pause:** Each `pause()` returns a unique lock ID. Only `resume(lockId)` with the
 * matching ID can unpause. This prevents upstream RESUME signals from overriding an imperative pause.
 * @remarks **PAUSE/RESUME signals flow downstream:** When paused (imperatively or via upstream signal),
 * PAUSE propagates to all subscribers. On resume, RESUME propagates followed by the latest DATA.
 * @remarks **DIRTY/RESOLVED pass through:** Graph coordination signals are never blocked, even while paused.
 * This preserves diamond resolution correctness.
 * @remarks **`get()` while paused** returns the last emitted value (before pause), consistent with
 * RxJS/callbag semantics where paused means the value is held back entirely.
 *
 * @example
 * ```ts
 * import { state, pipe, subscribe } from 'callbag-recharge';
 * import { pausable } from 'callbag-recharge/extra';
 *
 * const source = state(0);
 * const gated = pipe(source, pausable());
 * const lockId = gated.pause();
 * source.set(1); // DATA not forwarded
 * source.set(2);
 * gated.resume(lockId); // emits 2 (latest)
 * ```
 *
 * @category extra
 */
export function pausable<A>(opts?: StoreOptions): (input: Store<A>) => PausableStore<A> {
	return (input: Store<A>): PausableStore<A> => {
		const _pausedStore = state<boolean>(false, {
			name: `${opts?.name ?? "pausable"}:paused`,
		});
		let lastValue: A = input.get();
		let isPaused = false;
		let _lockId: string | null = null;

		// Captured from init closure — null before first subscriber connects
		let _signal: ((s: any) => void) | null = null;
		let _emit: ((v: A) => void) | null = null;

		const out = operator<A>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error }) => {
				_signal = signal;
				_emit = emit;
				return (_dep, type, data) => {
					if (type === STATE) {
						if (data === PAUSE) {
							// Upstream PAUSE — only pause if not already locked by imperative pause
							if (!isPaused) {
								isPaused = true;
								// No lock ID for upstream-initiated pause (can be resumed by upstream RESUME)
								_pausedStore.set(true);
							}
						} else if (data === RESUME) {
							// Upstream RESUME — only resume if no imperative lock is held
							if (isPaused && _lockId === null) {
								isPaused = false;
								_pausedStore.set(false);
								signal(DIRTY);
								emit(lastValue);
							}
						}
						signal(data);
						return;
					}
					if (type === DATA) {
						lastValue = data as A;
						if (!isPaused) {
							emit(data as A);
						} else {
							// ECH-2: Must send RESOLVED when suppressing DATA to prevent diamond deadlock
							signal(RESOLVED);
						}
						return;
					}
					if (type === END) {
						if (data !== undefined) error(data);
						else complete();
					}
				};
			},
			{
				kind: "pausable",
				name: opts?.name ?? "pausable",
				initial: input.get(),
				equals: opts?.equals as any,
				getter: () => input.get(),
			},
		);

		const pausableOut = out as unknown as PausableStore<A>;

		(pausableOut as any).pause = (): string => {
			if (isPaused && _lockId !== null) return _lockId;
			isPaused = true;
			_lockId = `pause-${++lockCounter}`;
			_pausedStore.set(true);
			_signal?.(PAUSE);
			return _lockId;
		};

		(pausableOut as any).resume = (lockId: string): void => {
			if (!isPaused || _lockId !== lockId) return;
			isPaused = false;
			_lockId = null;
			_pausedStore.set(false);
			_signal?.(RESUME);
			// ECH-5: DIRTY before emit for proper two-phase push bracketing
			if (_signal) _signal(DIRTY);
			_emit?.(lastValue);
		};

		Object.defineProperty(pausableOut, "paused", {
			get: () => _pausedStore as Store<boolean>,
			enumerable: true,
		});

		return pausableOut;
	};
}
