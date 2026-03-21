// ---------------------------------------------------------------------------
// track — pipe-native task tracking
// ---------------------------------------------------------------------------
// Wraps a stream with observable metadata: status, count, duration, error.
// The output store forwards values unchanged while the `.meta` store tracks
// lifecycle events reactively. Tier 2 operator built on producer().
//
// Usage:
//   const tracked = pipe(source, track());
//   effect([tracked.meta], () => {
//     const m = tracked.meta.get();
//     console.log(`${m.status}: ${m.count} values in ${m.duration}ms`);
//   });
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store, StoreOperator } from "../core/types";

export type TrackStatus = "idle" | "active" | "completed" | "errored";

export interface TrackMeta {
	/** Current tracking status. */
	status: TrackStatus;
	/** Number of values received. */
	count: number;
	/** Last error (if errored). */
	error?: unknown;
	/** Timestamp (ms since epoch) of first value. */
	startedAt?: number;
	/** Duration from first value to completion/error (ms). */
	duration?: number;
}

export interface TrackedStore<A> extends Store<A | undefined> {
	/** Observable tracking metadata. */
	meta: Store<TrackMeta>;
}

const IDLE_META: TrackMeta = Object.freeze({
	status: "idle" as TrackStatus,
	count: 0,
});

/**
 * Wraps a stream with observable lifecycle metadata: status, count, duration, error (Tier 2).
 *
 * @param opts - Optional configuration.
 *
 * @returns `StoreOperator<A, A>` — pipe-compatible. The returned store has a `meta` property (`Store<TrackMeta>`).
 *
 * @returnsTable get() | () => A \| undefined | Last forwarded value.
 * meta | Store\<TrackMeta\> | Reactive metadata: status, count, duration, error.
 * source | callbag | Underlying callbag source for subscriptions.
 *
 * @remarks **Tier 2:** Cycle boundary — each forwarded value starts a new DIRTY+value cycle.
 * @remarks **Lifecycle:** idle → active (first value) → completed/errored (upstream END). Resets on reconnect.
 * @remarks **Duration:** Measured from first value to completion/error.
 *
 * @example
 * ```ts
 * import { state, pipe, effect } from 'callbag-recharge';
 * import { track } from 'callbag-recharge/orchestrate';
 *
 * const input = state(0);
 * const tracked = pipe(input, track());
 * effect([tracked.meta], () => {
 *   console.log(tracked.meta.get().status); // "idle" → "active"
 * });
 * input.set(1); // meta: { status: "active", count: 1 }
 * ```
 *
 * @seeAlso [gate](./gate) — human-in-the-loop, [taskState](./taskState) — async function tracking
 *
 * @category orchestrate
 */
export function track<A>(opts?: { name?: string }): StoreOperator<A, A> {
	return (input: Store<A>) => {
		const meta = state<TrackMeta>(
			{ ...IDLE_META },
			{
				name: opts?.name ? `${opts.name}:meta` : "track:meta",
				equals: () => false, // always emit on transition
			},
		);

		const store = producer<A>(
			({ emit, error, complete }) => {
				let count = 0;
				let startedAt: number | undefined;

				// Reset meta on connection
				meta.set({ ...IDLE_META });

				const sub = subscribe(
					input,
					(v) => {
						count++;
						if (count === 1) startedAt = Date.now();
						meta.set({
							status: "active",
							count,
							startedAt,
						});
						emit(v);
					},
					{
						onEnd: (err) => {
							const duration = startedAt !== undefined ? Date.now() - startedAt : undefined;
							if (err !== undefined) {
								meta.set({
									status: "errored",
									count,
									error: err,
									startedAt,
									duration,
								});
								error(err);
							} else {
								meta.set({
									status: "completed",
									count,
									startedAt,
									duration,
								});
								complete();
							}
						},
					},
				);

				return () => {
					sub.unsubscribe();
				};
			},
			{ initial: input.get() },
		);

		Inspector.register(store, { kind: "track" });

		// Attach meta as observable metadata (access via TrackedStore cast)
		(store as any).meta = meta;

		return store;
	};
}
