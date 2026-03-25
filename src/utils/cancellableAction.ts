// ---------------------------------------------------------------------------
// cancellableAction — async action with auto-cancellation + state tracking
// ---------------------------------------------------------------------------
// Manages async operations with:
// - Auto-cancel-previous (only latest action runs)
// - Reactive loading/error/data state
// - AbortSignal for fetch/stream cancellation
// - Optional rate limiting via RateLimiter util
//
// Use cases: form submissions, search-as-you-type, API calls, file uploads
// ---------------------------------------------------------------------------

import { state } from "../core/state";
import type { Store } from "../core/types";
import { firstValueFrom } from "../raw/firstValueFrom";
import type { RateLimiter } from "./rateLimiter";

export type ActionFn<TInput, TResult> = (input: TInput, signal: AbortSignal) => Promise<TResult>;

export interface CancellableActionOptions<TResult> {
	/** Debug name for Inspector. */
	name?: string;
	/** Initial data value before first execution. */
	initial?: TResult;
	/** Rate limiter — action waits for a token before executing. */
	rateLimiter?: RateLimiter;
	/** Keep previous data while loading. Default: false (clears to undefined). */
	keepPreviousData?: boolean;
}

export interface CancellableActionResult<TInput, TResult> {
	/** Execute the action. Cancels any in-progress execution. */
	execute: (input: TInput) => Promise<TResult | undefined>;
	/** Cancel the current execution. */
	cancel: () => void;
	/** Reactive store of the latest result data. */
	data: Store<TResult | undefined>;
	/** Reactive loading state. */
	loading: Store<boolean>;
	/** Reactive error state. */
	error: Store<unknown | undefined>;
	/** Number of times the action has completed successfully. */
	runCount: Store<number>;
}

/**
 * Creates an async action that auto-cancels previous executions.
 *
 * @param fn - Async function receiving input and AbortSignal.
 * @param opts - Optional configuration.
 *
 * @returns `CancellableActionResult<TInput, TResult>` — `execute`, `cancel`, `data`, `loading`, `error`, `runCount`.
 *
 * @remarks **Auto-cancel:** Each `execute()` aborts the previous in-flight call via AbortSignal.
 * @remarks **Race-condition safe:** Only the latest execution's result is stored; stale results are discarded.
 *
 * @example
 * ```ts
 * import { cancellableAction } from 'callbag-recharge/utils';
 *
 * const search = cancellableAction(async (query: string, signal) => {
 *   const res = await fetch(`/api/search?q=${query}`, { signal });
 *   return res.json();
 * });
 *
 * search.execute('hello'); // starts search
 * search.execute('hello world'); // cancels previous, starts new
 *
 * // Reactive state
 * search.loading.get(); // true while in-flight
 * search.data.get();    // latest result
 * search.error.get();   // latest error or undefined
 * ```
 *
 * @category utils
 */
export function cancellableAction<TInput, TResult>(
	fn: ActionFn<TInput, TResult>,
	opts?: CancellableActionOptions<TResult>,
): CancellableActionResult<TInput, TResult> {
	const name = opts?.name ?? "cancellableAction";
	const keepPrev = opts?.keepPreviousData ?? false;

	const dataStore = state<TResult | undefined>(opts?.initial, {
		name: `${name}.data`,
	});
	const loadingStore = state<boolean>(false, {
		name: `${name}.loading`,
	});
	const errorStore = state<unknown | undefined>(undefined, {
		name: `${name}.error`,
	});
	const runCountStore = state<number>(0, {
		name: `${name}.runCount`,
	});

	let abortController: AbortController | null = null;
	let executionId = 0;

	function cancel(): void {
		if (abortController) {
			abortController.abort();
			abortController = null;
			loadingStore.set(false);
		}
	}

	async function execute(input: TInput): Promise<TResult | undefined> {
		cancel();

		const currentId = ++executionId;
		abortController = new AbortController();
		const signal = abortController.signal;

		loadingStore.set(true);
		errorStore.set(undefined);
		if (!keepPrev) dataStore.set(undefined);

		try {
			// Rate limiting
			if (opts?.rateLimiter) {
				await firstValueFrom(opts.rateLimiter.acquire(signal));
				if (signal.aborted || currentId !== executionId) return undefined;
			}

			const result = await fn(input, signal);

			// Stale check — only update if this is still the latest execution
			if (currentId !== executionId) return undefined;

			dataStore.set(result);
			loadingStore.set(false);
			runCountStore.update((n) => n + 1);
			abortController = null;
			return result;
		} catch (err) {
			if (currentId !== executionId) return undefined;
			if (signal.aborted) {
				// Cancelled — don't set error state
				loadingStore.set(false);
				return undefined;
			}
			errorStore.set(err);
			loadingStore.set(false);
			abortController = null;
			return undefined;
		}
	}

	return {
		execute,
		cancel,
		data: dataStore,
		loading: loadingStore,
		error: errorStore,
		runCount: runCountStore,
	};
}
