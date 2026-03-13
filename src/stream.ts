// ---------------------------------------------------------------------------
// stream(producer) — a store backed by an event source
// ---------------------------------------------------------------------------
// Push-based: producer calls emit() on its own schedule
// Pull-based: producer calls request(handler), .pull() invokes the handler
// ---------------------------------------------------------------------------

import { Inspector } from "./inspector";
import { DATA, END, deferStart, pushDirty, START } from "./protocol";
import { registerRead } from "./tracking";
import type { StoreOptions, StreamProducer, StreamStore } from "./types";

export function stream<T>(
	producer: StreamProducer<T>,
	opts?: StoreOptions<T> & { initial?: T },
): StreamStore<T> {
	let currentValue: T | undefined = opts?.initial;
	let started = false;
	let completed = false;
	let cleanup: (() => void) | void;
	let pullHandler: (() => void) | null = null;
	const sinks = new Set<any>();
	const eq = opts?.equals ?? Object.is;

	function emit(value: T): void {
		if (completed) return;
		if (currentValue !== undefined && eq(currentValue as T, value)) return;
		currentValue = value;
		pushDirty(sinks);
	}

	function request(handler: () => void): void {
		pullHandler = handler;
	}

	function complete(): void {
		if (completed) return;
		completed = true;
		// Notify all sinks that this source is done
		for (const sink of sinks) sink(END);
		sinks.clear();
		stopProducer();
	}

	function startProducer(): void {
		if (started) return;
		started = true;
		cleanup = producer(emit, request, complete);
	}

	function stopProducer(): void {
		if (!started) return;
		started = false;
		if (cleanup) cleanup();
	}

	const store: StreamStore<T> = {
		get() {
			registerRead(store);
			return currentValue;
		},

		pull() {
			if (!pullHandler) {
				throw new Error(
					`Store${opts?.name ? ` "${opts.name}"` : ""} is not pullable. ` +
						"The producer must call request(handler) to enable pulling.",
				);
			}
			pullHandler();
		},

		source(type: number, payload?: any) {
			if (type === START) {
				const sink = payload;

				// If already completed, handshake then immediately end
				if (completed) {
					sink(START, (_t: number) => {});
					sink(END);
					return;
				}

				sinks.add(sink);
				sink(START, (t: number) => {
					if (t === DATA) sink(DATA, currentValue);
					if (t === END) {
						sinks.delete(sink);
						if (sinks.size === 0) stopProducer();
					}
				});
				deferStart(startProducer);
			}
		},
	};

	Inspector.register(store, { kind: "stream", ...opts });
	return store;
}
