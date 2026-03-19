// ---------------------------------------------------------------------------
// formField — form field with sync + async validation
// ---------------------------------------------------------------------------
// Reactive form field primitive:
// - Sync validation (immediate)
// - Async validation (debounced, auto-cancelling)
// - dirty/touched/valid/validating reactive stores
// - Reset to initial state
// - dispose() for cleanup
//
// Built on: state, derived, effect
// ---------------------------------------------------------------------------

import { derived } from "../../core/derived";
import { effect } from "../../core/effect";
import { state } from "../../core/state";
import type { Store } from "../../core/types";

export interface FormFieldOptions<T> {
	/** Sync validation — return error string or true/undefined for valid. */
	validate?: (value: T) => string | true | undefined;
	/** Async validation — return error string or undefined. */
	asyncValidate?: (value: T, signal: AbortSignal) => Promise<string | undefined>;
	/** Debounce ms for async validation. Default: 300 */
	debounceMs?: number;
	/** Debug name. */
	name?: string;
}

export interface FormFieldResult<T> {
	/** Current field value. */
	value: Store<T>;
	/** Set the field value. */
	set: (value: T) => void;
	/** Current validation error (sync or async). Empty string = no error. */
	error: Store<string>;
	/**
	 * Whether the field has been modified from its construction-time initial value.
	 * The initial value is fixed at construction — `reset()` restores to it but
	 * does not change what counts as "initial" for dirty comparison.
	 */
	dirty: Store<boolean>;
	/** Whether the field has been focused then blurred. */
	touched: Store<boolean>;
	/** Whether the field is valid (no sync or async errors). */
	valid: Store<boolean>;
	/** Whether async validation is in progress. */
	validating: Store<boolean>;
	/** Mark as touched (call on blur). */
	touch: () => void;
	/** Reset to initial value and clear all state. */
	reset: () => void;
	/** Dispose the field — cleans up effect subscription, timers, and abort controllers. */
	dispose: () => void;
}

/**
 * Creates a reactive form field with sync and async validation.
 *
 * @param initial - The initial field value (fixed at construction; used by `dirty` and `reset()`).
 * @param opts - Optional configuration including validators.
 *
 * @returns `FormFieldResult<T>` — `value`, `set`, `error`, `dirty`, `touched`, `valid`, `validating`, `touch`, `reset`, `dispose`.
 *
 * @remarks **Sync validation:** Runs immediately on every value change.
 * @remarks **Async validation:** Debounced and auto-cancelling (previous async validation aborted on new value).
 * @remarks **Dirty:** Compares against the construction-time `initial` value using `Object.is`.
 *
 * @category patterns
 */
export function formField<T>(initial: T, opts?: FormFieldOptions<T>): FormFieldResult<T> {
	const name = opts?.name ?? "formField";
	const debounceMs = opts?.debounceMs ?? 300;

	const valueStore = state<T>(initial, { name: `${name}.value` });
	const touchedStore = state<boolean>(false, { name: `${name}.touched` });
	const syncErrorStore = state<string>("", { name: `${name}.syncError` });
	const asyncErrorStore = state<string>("", { name: `${name}.asyncError` });
	const validatingStore = state<boolean>(false, { name: `${name}.validating` });

	// Combined error: sync takes priority
	const errorStore = derived(
		[syncErrorStore, asyncErrorStore],
		() => {
			const syncErr = syncErrorStore.get();
			if (syncErr) return syncErr;
			return asyncErrorStore.get();
		},
		{ name: `${name}.error` },
	);

	const dirty = derived([valueStore], () => !Object.is(valueStore.get(), initial), {
		name: `${name}.dirty`,
	});

	const valid = derived([errorStore], () => errorStore.get() === "", { name: `${name}.valid` });

	let abortController: AbortController | null = null;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let resetting = false; // suppress effect during reset

	function cancelAsync(): void {
		if (abortController) {
			abortController.abort();
			abortController = null;
		}
		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
	}

	function runSyncValidation(value: T): void {
		if (!opts?.validate) {
			syncErrorStore.set("");
			return;
		}
		const result = opts.validate(value);
		if (result === true || result === undefined) {
			syncErrorStore.set("");
		} else {
			syncErrorStore.set(result);
		}
	}

	function scheduleAsyncValidation(value: T): void {
		cancelAsync();

		if (!opts?.asyncValidate) {
			validatingStore.set(false);
			asyncErrorStore.set("");
			return;
		}

		// If there's a sync error, skip async validation
		if (syncErrorStore.get() !== "") {
			validatingStore.set(false);
			asyncErrorStore.set("");
			return;
		}

		validatingStore.set(true);

		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			abortController = new AbortController();
			const signal = abortController.signal;

			opts.asyncValidate!(value, signal)
				.then((result) => {
					if (signal.aborted) return;
					asyncErrorStore.set(result ?? "");
					validatingStore.set(false);
					abortController = null;
				})
				.catch((err) => {
					if (signal.aborted) return;
					asyncErrorStore.set(String(err));
					validatingStore.set(false);
					abortController = null;
				});
		}, debounceMs);
	}

	// Run initial sync validation
	runSyncValidation(initial);

	// Watch value changes via effect
	const disposeEffect = effect([valueStore], () => {
		if (resetting) return;
		const value = valueStore.get();
		runSyncValidation(value);
		scheduleAsyncValidation(value);
		return () => cancelAsync();
	});

	function setValue(value: T): void {
		valueStore.set(value);
	}

	function touch(): void {
		touchedStore.set(true);
	}

	function reset(): void {
		// Set resetting flag to suppress effect during valueStore.set()
		resetting = true;
		valueStore.set(initial);
		resetting = false;

		// Now clean up async state (after set, so effect didn't recreate timers)
		cancelAsync();
		touchedStore.set(false);
		syncErrorStore.set("");
		asyncErrorStore.set("");
		validatingStore.set(false);

		// Re-run sync validation for initial value
		runSyncValidation(initial);
	}

	function dispose(): void {
		cancelAsync();
		disposeEffect();
	}

	return {
		value: valueStore,
		set: setValue,
		error: errorStore,
		dirty,
		touched: touchedStore,
		valid,
		validating: validatingStore,
		touch,
		reset,
		dispose,
	};
}
