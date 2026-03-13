import { stream } from "../stream";
import type { StreamStore } from "../types";

/**
 * Creates a source from DOM events on the given target.
 */
export function fromEvent<T extends Event = Event>(
	target: EventTarget,
	eventName: string,
): StreamStore<T> {
	return stream<T>((emit) => {
		const handler = (e: Event) => emit(e as T);
		target.addEventListener(eventName, handler);
		return () => target.removeEventListener(eventName, handler);
	});
}
