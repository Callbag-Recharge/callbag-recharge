import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * Creates a source that immediately errors with the given value.
 *
 * Stateful: get() always returns undefined — no values are ever emitted.
 *
 * v3: Tier 2 Producer — sends END with error payload immediately on start.
 * Tests validate error-path teardown with no preceding DATA.
 */
export function throwError<T = never>(err: unknown): ProducerStore<T> {
	return producer<T>(({ error }) => {
		error(err);
		return undefined;
	});
}
