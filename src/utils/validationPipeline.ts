// ---------------------------------------------------------------------------
// validationPipeline — composable sync + async validation chain
// ---------------------------------------------------------------------------
// Standalone validation pipeline extracted from formField's baked-in logic.
// Supports multiple sync validators (run immediately) and async validators
// (debounced, auto-cancelling).
//
// Use cases: forms, CLI input, data ingestion, schema validation, editor lint
//
// Built on: state, derived, effect
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { effect } from "../core/effect";
import { state } from "../core/state";
import type { Store } from "../core/types";

export type SyncValidator<T> = (value: T) => string | true | undefined;
export type AsyncValidator<T> = (value: T, signal: AbortSignal) => Promise<string | undefined>;

export interface ValidationPipelineOptions<T> {
	/** Sync validators — run immediately on every change. */
	sync?: SyncValidator<T>[];
	/** Async validators — debounced, auto-cancelling. Skipped if sync errors exist. */
	async?: AsyncValidator<T>[];
	/** Debounce ms for async validation. Default: 300 */
	debounceMs?: number;
	/** Debug name. */
	name?: string;
}

export interface ValidationPipelineResult {
	/** First error (sync priority, then async). Empty string = no error. */
	error: Store<string>;
	/** All current errors. */
	errors: Store<readonly string[]>;
	/** Whether all validators pass. */
	valid: Store<boolean>;
	/** Whether async validation is in progress. */
	validating: Store<boolean>;
	/** Manually trigger re-validation. */
	validate(): void;
	/** Dispose — cleans up effect, timers, abort controllers. */
	dispose(): void;
}

/**
 * Creates a composable validation pipeline for a source store.
 *
 * @param source - The store to validate.
 * @param opts - Validators and configuration.
 *
 * @returns `ValidationPipelineResult` — `error`, `errors`, `valid`, `validating`, `validate`, `dispose`.
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 * import { validationPipeline } from 'callbag-recharge/utils';
 *
 * const email = state('');
 * const validation = validationPipeline(email, {
 *   sync: [
 *     (v) => v.length === 0 ? 'Required' : true,
 *     (v) => !v.includes('@') ? 'Invalid email' : true,
 *   ],
 *   async: [
 *     async (v, signal) => {
 *       const res = await fetch(`/api/check-email?e=${v}`, { signal });
 *       const { taken } = await res.json();
 *       return taken ? 'Email already taken' : undefined;
 *     },
 *   ],
 * });
 *
 * validation.valid.get();  // false ('Required')
 * validation.error.get();  // 'Required'
 * ```
 *
 * @category utils
 */
export function validationPipeline<T>(
	source: Store<T>,
	opts?: ValidationPipelineOptions<T>,
): ValidationPipelineResult {
	const syncValidators = opts?.sync ?? [];
	const asyncValidators = opts?.async ?? [];
	const debounceMs = opts?.debounceMs ?? 300;
	const name = opts?.name ?? "validation";

	const EMPTY: readonly string[] = [];

	const syncErrorsStore = state<readonly string[]>(EMPTY, { name: `${name}.syncErrors` });
	const asyncErrorsStore = state<readonly string[]>(EMPTY, { name: `${name}.asyncErrors` });
	const validatingStore = state<boolean>(false, { name: `${name}.validating` });

	// Combined errors: sync first, then async
	const errorsStore = derived(
		[syncErrorsStore, asyncErrorsStore],
		() => {
			const syncErrs = syncErrorsStore.get();
			const asyncErrs = asyncErrorsStore.get();
			if (syncErrs.length > 0 && asyncErrs.length > 0) {
				return [...syncErrs, ...asyncErrs];
			}
			if (syncErrs.length > 0) return syncErrs;
			if (asyncErrs.length > 0) return asyncErrs;
			return EMPTY;
		},
		{ name: `${name}.errors` },
	);

	const errorStore = derived(
		[errorsStore],
		() => {
			const errs = errorsStore.get();
			return errs.length > 0 ? errs[0] : "";
		},
		{ name: `${name}.error` },
	);

	const validStore = derived(
		[errorsStore, validatingStore],
		() => {
			return errorsStore.get().length === 0 && !validatingStore.get();
		},
		{ name: `${name}.valid` },
	);

	let abortController: AbortController | null = null;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	function cancelAsync(): void {
		if (abortController) {
			abortController.abort();
			abortController = null;
		}
		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		validatingStore.set(false);
	}

	function runSyncValidation(value: T): readonly string[] {
		if (syncValidators.length === 0) return EMPTY;
		const errors: string[] = [];
		for (const validator of syncValidators) {
			const result = validator(value);
			if (result !== true && result !== undefined) {
				errors.push(result);
			}
		}
		return errors.length === 0 ? EMPTY : errors;
	}

	function scheduleAsyncValidation(value: T): void {
		cancelAsync();

		if (asyncValidators.length === 0) {
			validatingStore.set(false);
			asyncErrorsStore.set(EMPTY);
			return;
		}

		// Skip async if sync errors exist
		if (syncErrorsStore.get().length > 0) {
			validatingStore.set(false);
			asyncErrorsStore.set(EMPTY);
			return;
		}

		validatingStore.set(true);

		function runAsync(): void {
			abortController = new AbortController();
			const signal = abortController.signal;

			Promise.all(asyncValidators.map((v) => v(value, signal)))
				.then((results) => {
					if (signal.aborted || disposed) return;
					const errors = results.filter((r): r is string => r !== undefined);
					asyncErrorsStore.set(errors.length === 0 ? EMPTY : errors);
					validatingStore.set(false);
					abortController = null;
				})
				.catch((err) => {
					if (signal.aborted || disposed) return;
					asyncErrorsStore.set([String(err)]);
					validatingStore.set(false);
					abortController = null;
				});
		}

		if (debounceMs === 0) {
			runAsync();
		} else {
			debounceTimer = setTimeout(() => {
				debounceTimer = null;
				runAsync();
			}, debounceMs);
		}
	}

	function runValidation(): void {
		const value = source.get();
		const syncErrors = runSyncValidation(value);
		syncErrorsStore.set(syncErrors);
		scheduleAsyncValidation(value);
	}

	// Watch source changes via effect (effect runs fn immediately on creation,
	// which handles initial validation — no separate runValidation() call needed)
	const disposeEffect = effect([source], () => {
		runValidation();
		return () => cancelAsync();
	});

	function validate(): void {
		runValidation();
	}

	let disposed = false;
	function dispose(): void {
		if (disposed) return;
		disposed = true;
		cancelAsync();
		disposeEffect();
	}

	return {
		error: errorStore,
		errors: errorsStore,
		valid: validStore,
		validating: validatingStore,
		validate,
		dispose,
	};
}
