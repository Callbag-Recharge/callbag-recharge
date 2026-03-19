// ---------------------------------------------------------------------------
// fromTrigger — manual trigger source
// ---------------------------------------------------------------------------
// A reactive source that emits when `.fire(value)` is called. Unlike state(),
// fromTrigger always emits (no equality guard), making it ideal for event-driven
// workflows where the same value may be fired multiple times.
//
// Usage:
//   const trigger = fromTrigger<string>();
//   subscribe(trigger, v => console.log(v));
//   trigger.fire("go");  // logs "go"
//   trigger.fire("go");  // logs "go" again (no dedup)
// ---------------------------------------------------------------------------

import { state } from "../core/state";
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
 * @remarks **Eager:** Unlike producer(), the trigger is always ready — `fire()` works before any subscriber connects (value is stored for `get()`).
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
 * @seeAlso [state](../core/state) — writable store with dedup, [producer](../core/producer) — general-purpose source
 *
 * @category orchestrate
 */
export function fromTrigger<T>(opts?: { initial?: T; name?: string }): TriggerStore<T> {
	const store = state<T | undefined>(opts?.initial, {
		equals: () => false,
		name: opts?.name ?? "trigger",
		kind: "trigger",
	});

	const self: TriggerStore<T> = {
		get() {
			return store.get();
		},
		source: store.source,
		fire(value: T) {
			store.set(value);
		},
	};

	return self;
}
