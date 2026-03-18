import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * DOM event source: each matching event becomes a DATA emission (Tier 2).
 *
 * @param target - `EventTarget` to listen on.
 * @param eventName - Event type string.
 *
 * @returns `ProducerStore<T>`
 *
 * @category extra
 */
export function fromEvent<T extends Event = Event>(
	target: EventTarget,
	eventName: string,
): ProducerStore<T> {
	return producer<T>(({ emit }) => {
		const handler = (e: Event) => emit(e as T);
		target.addEventListener(eventName, handler);
		return () => target.removeEventListener(eventName, handler);
	});
}
