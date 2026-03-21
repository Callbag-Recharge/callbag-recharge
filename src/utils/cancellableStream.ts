// ---------------------------------------------------------------------------
// cancellableStream — async stream with AbortSignal + auto-cancellation
// ---------------------------------------------------------------------------
// Generic utility for wrapping any async data source (fetch, SSE, WebSocket,
// ReadableStream, AsyncIterable) into a reactive Store with:
// - AbortSignal-based cancellation on unsubscribe
// - Auto-cancel-previous semantics (unsubscribe inner → fromAbortable abort)
// - Retry integration via resubscribable producer
//
// This is the reusable core extracted from chatStream. Benefits:
// - SSE event sources
// - Streaming API responses (LLM, media)
// - WebSocket message streams
// - Any fetch-based data pipeline
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Subscription } from "../core/protocol";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";

export type StreamFactory<T> = (signal: AbortSignal) => AsyncIterable<T>;

export interface CancellableStreamOptions<T> {
	/** Debug name for Inspector. */
	name?: string;
	/** Initial value before first emission. */
	initial?: T;
	/** Called when stream completes normally. */
	onComplete?: () => void;
	/** Called when stream errors. */
	onError?: (error: unknown) => void;
}

export interface CancellableStreamResult<T> {
	/** Reactive store of stream values. */
	store: Store<T | undefined>;
	/** Start a new stream, cancelling any in-progress one. */
	start: (factory: StreamFactory<T>) => void;
	/** Cancel the current stream. */
	cancel: () => void;
	/** Whether a stream is currently active. */
	active: Store<boolean>;
}

/**
 * Creates a cancellable async stream that auto-cancels on new start or unsubscribe.
 *
 * @param opts - Optional configuration.
 *
 * @returns `CancellableStreamResult<T>` — `store`, `start`, `cancel`, `active`.
 *
 * @remarks **AbortSignal:** Each `start()` creates a new AbortController. The signal is passed to the factory. On `cancel()` or next `start()`, the previous controller is aborted.
 * @remarks **Auto-cleanup:** When all subscribers leave the store, the active stream is cancelled.
 *
 * @example
 * ```ts
 * import { cancellableStream } from 'callbag-recharge/utils';
 *
 * const stream = cancellableStream<string>();
 *
 * stream.start(async function* (signal) {
 *   const res = await fetch('/api/stream', { signal });
 *   const reader = res.body!.getReader();
 *   const decoder = new TextDecoder();
 *   while (true) {
 *     const { done, value } = await reader.read();
 *     if (done) break;
 *     yield decoder.decode(value);
 *   }
 * });
 *
 * // Cancel on demand
 * stream.cancel();
 * ```
 *
 * @category utils
 */
export function cancellableStream<T>(
	opts?: CancellableStreamOptions<T>,
): CancellableStreamResult<T> {
	const name = opts?.name ?? "cancellableStream";

	const output = producer<T>(undefined, {
		initial: opts?.initial,
		name,
		resubscribable: true,
	});

	const activeStore = producer<boolean>(undefined, {
		initial: false,
		name: `${name}.active`,
		_skipInspect: true,
	});

	let innerSub: Subscription | null = null;
	let cancelled = false;

	function cancel(): void {
		cancelled = true;
		if (innerSub) {
			innerSub.unsubscribe();
			innerSub = null;
		}
		activeStore.emit(false);
	}

	function start(factory: StreamFactory<T>): void {
		cancel();
		cancelled = false;
		activeStore.emit(true);
		// fromAbortable handles AbortController + async iteration + error handling.
		// Unsubscribing (via cancel or next start) triggers fromAbortable's cleanup → abort.
		const inner = fromAbortable(factory, { name, initial: opts?.initial });
		innerSub = subscribe(inner, (v) => output.emit(v as T), {
			onEnd: (err) => {
				innerSub = null;
				// Distinguish user-initiated cancel from natural completion/error.
				// On cancel, fromAbortable swallows the abort and sends clean END.
				if (cancelled) return;
				activeStore.emit(false);
				if (err !== undefined) {
					try {
						opts?.onError?.(err);
					} catch {
						// Don't let callback exceptions block error propagation
					}
					output.error(err);
				} else {
					opts?.onComplete?.();
				}
			},
		});
	}

	Inspector.register(output as any, { kind: "cancellableStream" });

	return {
		store: output as Store<T | undefined>,
		start,
		cancel,
		active: activeStore as Store<boolean>,
	};
}

// ---------------------------------------------------------------------------
// fromAbortable — one-shot convenience for a single async iterable
// ---------------------------------------------------------------------------

export interface FromAbortableOptions<T> {
	/** Debug name for Inspector. */
	name?: string;
	/** Initial value before first emission. */
	initial?: T;
	/** Called when stream completes normally. */
	onComplete?: () => void;
	/** Called when stream errors. */
	onError?: (error: unknown) => void;
}

/**
 * Creates a Store from an async iterable factory that receives an AbortSignal.
 * Auto-cancels on unsubscribe. Completes when the iterable ends.
 *
 * @param factory - Function receiving AbortSignal, returning AsyncIterable.
 * @param opts - Optional configuration.
 *
 * @returns `Store<T | undefined>` — emits each yielded value; completes on end.
 *
 * @example
 * ```ts
 * import { fromAbortable } from 'callbag-recharge/utils';
 *
 * const events = fromAbortable(async function* (signal) {
 *   const source = new EventSource('/sse', { signal } as any);
 *   // ... yield events
 * });
 * ```
 *
 * @category utils
 */
export function fromAbortable<T>(
	factory: StreamFactory<T>,
	opts?: FromAbortableOptions<T>,
): Store<T | undefined> {
	const store = producer<T>(
		({ emit, complete, error }) => {
			const ac = new AbortController();
			let done = false;

			(async () => {
				try {
					for await (const chunk of factory(ac.signal)) {
						if (ac.signal.aborted) return;
						emit(chunk);
					}
					if (!ac.signal.aborted) {
						done = true;
						try {
							opts?.onComplete?.();
						} catch {
							// Don't let callback exceptions block completion
						}
						complete();
					}
				} catch (err) {
					if (!ac.signal.aborted) {
						done = true;
						try {
							opts?.onError?.(err);
						} catch {
							// Don't let callback exceptions block error propagation
						}
						error(err);
					}
				}
			})();

			return () => {
				if (!done) ac.abort();
			};
		},
		{
			initial: opts?.initial,
			name: opts?.name ?? "fromAbortable",
			resubscribable: true,
		},
	);

	Inspector.register(store as any, { kind: "fromAbortable" });
	return store as Store<T | undefined>;
}
