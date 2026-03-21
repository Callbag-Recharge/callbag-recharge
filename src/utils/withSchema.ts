// ---------------------------------------------------------------------------
// withSchema — runtime validation wrapper
// ---------------------------------------------------------------------------
// Wraps a Store<T> with schema validation. Invalid values are rejected and
// reported via an error companion store. Compatible with Zod, Valibot,
// ArkType, or any object with a `parse(v: unknown): T` method.
//
// Usage:
//   const validated = withSchema(myStore, z.number().min(0));
//   subscribe(validated, v => console.log(v));       // only valid values
//   subscribe(validated.error, e => console.log(e)); // validation errors
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store, WritableStore } from "../core/types";

/**
 * Minimal schema interface — any object with a `parse` method.
 * Compatible with Zod, Valibot, ArkType, and custom validators.
 */
export interface Schema<T> {
	parse(value: unknown): T;
}

export interface WithSchemaOptions {
	/** Store name for debugging. */
	name?: string;
}

export interface WithSchemaStore<T> extends Store<T> {
	/** Last validation error. Cleared on next valid value. */
	error: Store<Error | undefined>;
	/** Set a value through validation. Rejects if invalid. */
	set(value: unknown): void;
}

/**
 * Wraps a store with runtime schema validation. Invalid upstream values are
 * rejected (not forwarded) and the error is exposed via an `error` companion store.
 *
 * @param store - The source store to validate.
 * @param schema - Any object with `parse(v: unknown): T`. Throws on invalid input.
 * @param opts - Optional configuration.
 *
 * @returns `WithSchemaStore<T>` — a store that only emits valid values, with `error` companion and `set()` for validated writes.
 *
 * @remarks **Schema interface:** `{ parse(v: unknown): T }` — compatible with Zod (`z.string()`), Valibot (`v.string()`), ArkType, or any custom validator that throws on invalid input.
 * @remarks **Rejection:** Invalid values are silently dropped (not forwarded downstream). The `error` companion store is set with the validation error.
 * @remarks **Writable:** If the input store has `set()`, the returned store's `set()` validates before forwarding. Invalid values are rejected with error set. Throws if upstream is read-only.
 * @remarks **Initial validation:** Throws at construction if the store's initial value fails schema validation. This ensures `get()` always returns a valid `T`.
 *
 * @example
 * ```ts
 * import { state, subscribe } from 'callbag-recharge';
 * import { withSchema } from 'callbag-recharge/utils';
 *
 * const raw = state<unknown>(0);
 * const validated = withSchema(raw, { parse: (v) => { if (typeof v !== 'number') throw new Error('not a number'); return v; } });
 * subscribe(validated.error, e => console.log(e?.message)); // "not a number"
 * raw.set("bad"); // rejected — error companion fires
 * raw.set(42);    // passes — emitted downstream, error cleared
 * ```
 *
 * @category utils
 */
export function withSchema<T>(
	store: Store<unknown>,
	schema: Schema<T>,
	opts?: WithSchemaOptions,
): WithSchemaStore<T> {
	const baseName = opts?.name ?? "withSchema";

	const errorStore = state<Error | undefined>(undefined, {
		name: `${baseName}:error`,
		equals: Object.is,
	});

	// Validate initial value — fail fast if invalid (1A)
	let lastValid: T = schema.parse(store.get());

	// Flag to skip re-validation in subscribe callback when set() triggers upstream
	let skipNext = false;

	const inner = producer<T>(
		({ emit, complete, error }) => {
			// Reset error companion on resubscription (matches withStatus pattern)
			errorStore.set(undefined);

			const unsub = subscribe(
				store,
				(value) => {
					if (skipNext) {
						skipNext = false;
						// Already validated in set() — emit directly
						lastValid = value as T;
						errorStore.set(undefined);
						emit(value as T);
						return;
					}
					try {
						const parsed = schema.parse(value);
						lastValid = parsed;
						errorStore.set(undefined);
						emit(parsed);
					} catch (e) {
						errorStore.set(e instanceof Error ? e : new Error(String(e)));
						// Reject — don't emit
					}
				},
				{
					onEnd: (err) => {
						if (err !== undefined) error(err);
						else complete();
					},
				},
			);

			return () => {
				unsub();
			};
		},
		{ initial: lastValid, resubscribable: true, name: baseName, kind: "withSchema" },
	);

	Inspector.register(inner, { kind: "withSchema" });

	const isWritable = typeof (store as any).set === "function";

	const delegate: WithSchemaStore<T> = {
		get: () => {
			// When connected, use producer's value; when disconnected, validate current
			try {
				return schema.parse(store.get());
			} catch {
				return lastValid;
			}
		},
		source: (type: number, payload?: any) => inner.source(type, payload),
		get _status() {
			return (inner as any)._status;
		},
		error: errorStore,
		set(value: unknown): void {
			if (!isWritable) {
				throw new Error("withSchema: upstream store is read-only");
			}
			try {
				const parsed = schema.parse(value);
				// Set flag to skip re-validation in subscribe callback (D2 fix)
				skipNext = true;
				(store as WritableStore<unknown>).set(parsed);
			} catch (e) {
				errorStore.set(e instanceof Error ? e : new Error(String(e)));
			}
		},
	};

	return delegate;
}
