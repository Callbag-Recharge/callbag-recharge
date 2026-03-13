import { stream } from "../stream";
import type { StreamStore } from "../types";

/**
 * Creates a push-based source that emits incrementing integers (0, 1, 2, ...)
 * every `ms` milliseconds.
 */
export function interval(ms: number): StreamStore<number> {
	return stream<number>((emit) => {
		let i = 0;
		const id = setInterval(() => emit(i++), ms);
		return () => clearInterval(id);
	});
}
