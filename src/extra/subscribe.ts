/**
 * Listens to value changes with previous-value tracking.
 * Returns an unsubscribe function.
 *
 * Re-exports core/subscribe — the implementation lives in core so it can
 * be used internally by derived (STANDALONE terminator), effect, and the
 * ADOPT protocol.
 */

export { subscribe } from "../core/subscribe";
