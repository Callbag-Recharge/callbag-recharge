// ---------------------------------------------------------------------------
// wait — intentional pause pipeline step (Phase 5b-5)
// ---------------------------------------------------------------------------
// Introduces an intentional delay in a pipeline. Two modes:
//   - Duration: wait(dep, ms) — pauses ms milliseconds before forwarding
//   - Signal:   wait(dep, signalStore) — pauses until signal emits truthy
//
// Distinct from timeout() (guard that fails on expiry) and gate() (human
// approval). wait() always forwards — it just delays.
//
// Usage:
//   const wf = pipeline({
//     trigger: step(fromTrigger<string>()),
//     pause:   wait("trigger", 5000),
//     process: task(["pause"], async (v) => { ... }),
//   });
// ---------------------------------------------------------------------------

import { pipe } from "../core/pipe";
import { producer } from "../core/producer";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";
import { switchMap } from "../extra/switchMap";
import type { StepDef } from "./pipeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WaitOpts {
	/** Debug name for Inspector. */
	name?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates an intentional pause step in a pipeline.
 *
 * **Duration mode:** `wait(dep, ms)` — delays forwarding the dep value by `ms` milliseconds.
 *
 * **Signal mode:** `wait(dep, signalStore)` — holds the dep value until `signalStore` emits
 * a truthy value, then forwards immediately.
 *
 * New upstream values cancel any pending wait (switchMap re-trigger cancellation).
 *
 * @param dep - Name of the upstream step.
 * @param durationOrSignal - Milliseconds to wait, or a `Store` whose truthy emission triggers forwarding.
 * @param opts - Optional configuration (name).
 *
 * @returns `StepDef<T>` — step definition for pipeline().
 *
 * @remarks **Distinct from timeout():** timeout() is a guard that fails on expiry. wait() always forwards.
 * @remarks **Distinct from gate():** gate() requires human approval. wait() is automatic.
 * @remarks **Re-trigger:** New dep values cancel any pending wait (switchMap semantics).
 *
 * @example
 * ```ts
 * import { pipeline, step, task, wait, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * // Duration mode: 5 second cooldown
 * const wf = pipeline({
 *   trigger: step(fromTrigger<string>()),
 *   pause:   wait("trigger", 5000),
 *   process: task(["pause"], async (v) => handle(v)),
 * });
 *
 * // Signal mode: wait for external readiness
 * const ready = state(false);
 * const wf2 = pipeline({
 *   trigger: step(fromTrigger<string>()),
 *   pause:   wait("trigger", ready),
 *   process: task(["pause"], async (v) => handle(v)),
 * });
 * ready.set(true); // releases the wait
 * ```
 *
 * @category orchestrate
 */
export function wait<T>(
	dep: string,
	durationOrSignal: number | Store<any>,
	opts?: WaitOpts,
): StepDef<T> {
	const isDuration = typeof durationOrSignal === "number";

	const factory = (depStore: Store<T>): Store<T> => {
		return pipe(
			depStore,
			switchMap((value: T) => {
				if (isDuration) {
					// Duration mode: emit value after delay
					const ms = durationOrSignal as number;
					return producer<T>(({ emit, complete }) => {
						const timer = setTimeout(() => {
							emit(value);
							complete();
						}, ms);
						return () => {
							clearTimeout(timer);
						};
					});
				}

				// Signal mode: emit value when signal store emits truthy
				const signal$ = durationOrSignal as Store<any>;
				return producer<T>(({ emit, complete }) => {
					// Check if signal is already truthy
					if (signal$.get()) {
						emit(value);
						complete();
						return undefined;
					}

					// Subscribe and wait for truthy emission
					// Use released flag to guard against subscribe delivering truthy
					// synchronously (unsub would be undefined at call time) and
					// double-unsub from teardown after callback already unsubscribed.
					let released = false;
					let unsub: (() => void) | undefined;
					unsub = subscribe(signal$, (v) => {
						if (v && !released) {
							released = true;
							unsub?.();
							emit(value);
							complete();
						}
					});
					// If subscribe delivered truthy synchronously, unsub already called
					if (released) return undefined;
					return () => {
						if (!released) {
							released = true;
							unsub?.();
						}
					};
				});
			}),
		) as Store<T>;
	};

	return {
		factory: factory as any,
		deps: [dep],
		name: opts?.name,
	};
}
