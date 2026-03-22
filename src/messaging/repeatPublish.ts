// ---------------------------------------------------------------------------
// repeatPublish — scheduled message production
// ---------------------------------------------------------------------------
// Publishes messages to a topic on a recurring schedule. Supports interval-
// based (every N ms) and cron-based scheduling. Dedup by repeat key prevents
// duplicates within the same schedule.
// ---------------------------------------------------------------------------

import { teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";
import type { CronSchedule } from "../extra/cron";
import { matchesCron, parseCron } from "../extra/cron";
import type { PublishOptions, RepeatHandle, RepeatPublishOptions, Topic } from "./types";

let repeatCounter = 0;

/**
 * Publish messages to a topic on a recurring schedule.
 *
 * @param topicRef - The topic to publish to.
 * @param valueOrFactory - A fixed value or factory function that returns a new value each time.
 * @param opts - Scheduling configuration.
 *
 * @returns `RepeatHandle` — `cancel()` to stop, `count` store for reactive tracking.
 *
 * @remarks **Interval mode:** Set `every` to publish at fixed intervals (ms).
 * @remarks **Cron mode:** Set `cron` to publish on a cron schedule. Uses the library's built-in
 * cron parser (`parseCron`/`matchesCron`). Checks every 60s by default.
 * @remarks **Limit:** Set `limit` to stop after N publications. 0 = unlimited.
 * @remarks **Dedup:** Set `dedupKey` to prevent duplicate publications within the topic's dedup window.
 *
 * @example
 * ```ts
 * // Publish every 5 seconds
 * const handle = repeatPublish(myTopic, () => ({ type: 'heartbeat', ts: Date.now() }), {
 *   every: 5000,
 *   limit: 100,
 * });
 *
 * // Publish on cron schedule
 * const handle = repeatPublish(myTopic, { type: 'daily-report' }, {
 *   cron: '0 9 * * *', // 9am daily
 * });
 *
 * // Cancel
 * handle.cancel();
 * ```
 *
 * @category messaging
 */
export function repeatPublish<T>(
	topicRef: Topic<T>,
	valueOrFactory: T | (() => T),
	opts: RepeatPublishOptions,
): RepeatHandle {
	const id = `repeat-${++repeatCounter}`;
	const limit = opts.limit ?? 0;
	let _active = true;
	let _timer: ReturnType<typeof setInterval> | undefined;
	const _countStore = state<number>(0, { name: `${id}:count` });

	const publishOpts: PublishOptions = {
		key: opts.key,
		headers: opts.headers,
		dedupKey: opts.dedupKey,
	};

	function getValue(): T {
		return typeof valueOrFactory === "function" ? (valueOrFactory as () => T)() : valueOrFactory;
	}

	function doPublish(): void {
		if (!_active) return;

		// Check limit
		if (limit > 0 && _countStore.get() >= limit) {
			cancel();
			return;
		}

		// Generate dedup key with count suffix if base key provided
		const currentOpts = { ...publishOpts };
		if (opts.dedupKey) {
			currentOpts.dedupKey = `${opts.dedupKey}:${_countStore.get()}`;
		}

		topicRef.publish(getValue(), currentOpts);
		// Always increment — even on dedup rejection — to avoid permanent stall
		// where the same dedup key suffix is regenerated every tick
		_countStore.update((v) => v + 1);

		// Re-check limit after publish
		if (limit > 0 && _countStore.get() >= limit) {
			cancel();
		}
	}

	function cancel(): void {
		if (!_active) return;
		_active = false;
		if (_timer !== undefined) {
			clearInterval(_timer);
			_timer = undefined;
		}
		teardown(_countStore);
	}

	// --- Start scheduling ---
	if (opts.every && opts.every > 0) {
		// Interval mode
		_timer = setInterval(doPublish, opts.every);
		if (_timer && typeof _timer === "object" && "unref" in _timer) {
			_timer.unref();
		}
	} else if (opts.cron) {
		// Cron mode — check every 60s
		const schedule: CronSchedule = parseCron(opts.cron);
		let lastFiredKey = 0; // YYYYMMDDHHII packed decimal

		function checkCron(): void {
			if (!_active) return;
			const now = new Date();
			const key =
				now.getFullYear() * 100_000_000 +
				(now.getMonth() + 1) * 1_000_000 +
				now.getDate() * 10_000 +
				now.getHours() * 100 +
				now.getMinutes();
			if (key !== lastFiredKey && matchesCron(schedule, now)) {
				lastFiredKey = key;
				doPublish();
			}
		}

		_timer = setInterval(checkCron, 60_000);
		if (_timer && typeof _timer === "object" && "unref" in _timer) {
			_timer.unref();
		}
		// Immediate check
		checkCron();
	}

	return {
		cancel,
		get count() {
			return _countStore as Store<number>;
		},
		get active() {
			return _active;
		},
	};
}
