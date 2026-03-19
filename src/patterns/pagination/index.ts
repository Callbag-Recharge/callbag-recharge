// ---------------------------------------------------------------------------
// pagination — paginated data fetching with reactive state
// ---------------------------------------------------------------------------
// Provides page-based data fetching with:
// - Reactive data/page/loading/error stores
// - hasNext/hasPrev derived stores
// - Auto-cancellation of in-flight fetches
// - next/prev/goTo/refresh navigation
// - Initial fetch on construction
//
// Note on hasNext: Derived from whether the last fetch returned exactly
// `pageSize` items. When total items are exactly divisible by pageSize,
// hasNext will briefly be true until the next empty-page fetch. This is
// standard offset-based pagination behavior without a total count.
//
// Built on: state, derived, cancellableAction
// ---------------------------------------------------------------------------

import { derived } from "../../core/derived";
import { state } from "../../core/state";
import type { Store } from "../../core/types";
import { cancellableAction } from "../../utils/cancellableAction";

export interface PaginationOptions<T> {
	/** Fetch function: receives page number (1-based) and AbortSignal. */
	fetch: (page: number, signal: AbortSignal) => Promise<T[]>;
	/** Items per page. */
	pageSize: number;
	/** Initial page. Default: 1 */
	initialPage?: number;
	/** Debug name. */
	name?: string;
}

export interface PaginationResult<T> {
	/** Current page data. */
	data: Store<T[]>;
	/** Current page number (1-based). Updated only after successful fetch. */
	page: Store<number>;
	/**
	 * Whether there are more pages. Derived from whether the last fetch
	 * returned exactly `pageSize` items. May produce a false positive when
	 * total items are exactly divisible by pageSize (next fetch returns empty).
	 */
	hasNext: Store<boolean>;
	/** Whether there's a previous page. */
	hasPrev: Store<boolean>;
	/** Loading state. */
	loading: Store<boolean>;
	/** Error state. */
	error: Store<unknown | undefined>;
	/** Go to next page (guarded by hasNext). */
	next: () => void;
	/** Go to previous page. */
	prev: () => void;
	/** Go to specific page. */
	goTo: (page: number) => void;
	/** Refresh current page. */
	refresh: () => void;
}

/**
 * Creates a paginated data fetcher with reactive state.
 *
 * @param opts - Pagination configuration including fetch function and page size.
 *
 * @returns `PaginationResult<T>` — `data`, `page`, `hasNext`, `hasPrev`, `loading`, `error`, `next`, `prev`, `goTo`, `refresh`.
 *
 * @remarks **Auto-cancel:** Navigating to a new page cancels any in-flight fetch.
 * @remarks **hasNext:** Derived from whether the last fetch returned exactly `pageSize` items. May false-positive on exact-divisible totals.
 * @remarks **Initial fetch:** Automatically fetches the initial page on construction.
 *
 * @category patterns
 */
export function pagination<T>(opts: PaginationOptions<T>): PaginationResult<T> {
	const name = opts.name ?? "pagination";
	const initialPage = opts.initialPage ?? 1;

	const pageStore = state<number>(initialPage, { name: `${name}.page` });
	const dataStore = state<T[]>([], { name: `${name}.data` });
	const hasNextStore = state<boolean>(false, { name: `${name}.hasNext` });

	const action = cancellableAction(
		async (page: number, signal: AbortSignal) => {
			return opts.fetch(page, signal);
		},
		{ name: `${name}.fetch` },
	);

	const hasPrev = derived([pageStore], () => pageStore.get() > 1, { name: `${name}.hasPrev` });

	// Track the previous page so we can restore on error
	let previousPage = initialPage;

	function fetchPage(page: number): void {
		previousPage = pageStore.get();
		// Don't update page optimistically — wait for success
		action
			.execute(page)
			.then((result) => {
				if (result !== undefined) {
					pageStore.set(page);
					dataStore.set(result);
					hasNextStore.set(result.length >= opts.pageSize);
				}
				// result === undefined means cancelled — don't update anything
			})
			.catch(() => {
				// Error handled by action.error store — restore page
				pageStore.set(previousPage);
			});
	}

	function goTo(page: number): void {
		if (!Number.isFinite(page) || page < 1) return;
		fetchPage(page);
	}

	function next(): void {
		if (!hasNextStore.get()) return;
		const currentPage = pageStore.get();
		fetchPage(currentPage + 1);
	}

	function prev(): void {
		const currentPage = pageStore.get();
		if (currentPage <= 1) return;
		fetchPage(currentPage - 1);
	}

	function refresh(): void {
		const currentPage = pageStore.get();
		fetchPage(currentPage);
	}

	// Fetch initial page on construction
	fetchPage(initialPage);

	return {
		data: dataStore,
		page: pageStore,
		hasNext: hasNextStore,
		hasPrev,
		loading: action.loading,
		error: action.error,
		next,
		prev,
		goTo,
		refresh,
	};
}
