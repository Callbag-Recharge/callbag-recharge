// ---------------------------------------------------------------------------
// fromTrigger — manual trigger source
// ---------------------------------------------------------------------------
// A reactive pulse stream backed by producer(). Emits when `.fire(value)` is
// called — no equality guard, so the same value fires every time. Unlike
// state(), this is semantically an event source (pulses in a stream), not
// persistent state.
//
// Usage:
//   const trigger = fromTrigger<string>();
//   subscribe(trigger, v => console.log(v));
//   trigger.fire("go");  // logs "go"
//   trigger.fire("go");  // logs "go" again (no dedup)
// ---------------------------------------------------------------------------

import { producer } from "../core/producer";
import type { Store } from "../core/types";

export interface TriggerStore<T> extends Store<T | undefined> {
	/** Emit a value to all subscribers. */
	fire(value: T): void;
}

/**
 * Creates a manual trigger source. `.fire(value)` emits into the stream without equality dedup.
 *
 * @param opts - Optional configuration.
 *
 * @returns `TriggerStore<T>` — a store with:
 *
 * @returnsTable get() | () => T \| undefined | Last fired value (or initial).
 * fire(value) | (value: T) => void | Emit a value to all subscribers.
 * source | callbag | Underlying callbag source for subscriptions.
 *
 * @option name | string | undefined | Debug name for Inspector.
 * @option initial | T | undefined | Value before first fire().
 *
 * @remarks **No dedup:** Every `fire()` call emits, even if the value is the same as the previous one.
 * @remarks **Pulse semantics:** Backed by producer() — an event source, not persistent state.
 *
 * @example
 * ```ts
 * import { fromTrigger } from 'callbag-recharge/orchestrate';
 * import { subscribe } from 'callbag-recharge';
 *
 * const trigger = fromTrigger<string>();
 * subscribe(trigger, v => console.log(v));
 * trigger.fire("go"); // logs "go"
 * trigger.fire("go"); // logs "go" again
 * ```
 *
 * @seeAlso [producer](../core/producer) — general-purpose source
 *
 * @category orchestrate
 */
export function fromTrigger<T>(opts?: { initial?: T; name?: string }): TriggerStore<T> {
	let _emit: ((value: T | undefined) => void) | null = null;
	let _lastValue: T | undefined = opts?.initial;

	const store = producer<T | undefined>(
		({ emit }) => {
			_emit = emit;
			return () => {
				_emit = null;
			};
		},
		{
			initial: opts?.initial,
			name: opts?.name ?? "trigger",
			kind: "trigger",
			equals: () => false,
			getter: () => _lastValue,
		},
	);

	const self: TriggerStore<T> = {
		get() {
			return _lastValue;
		},
		source: store.source,
		fire(value: T) {
			_lastValue = value;
			if (_emit) {
				_emit(value);
			}
		},
	};

	return self;
}
