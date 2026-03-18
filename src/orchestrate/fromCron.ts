// ---------------------------------------------------------------------------
// fromCron — producer that emits on a cron schedule
// ---------------------------------------------------------------------------
// Tier 2 source: each cron tick starts a new DIRTY+value cycle.
// Emits a Date object at each matching minute. Lazy start (callbag protocol),
// auto-cleanup on last subscriber disconnect.
//
// Implementation: checks every `tickMs` (default 60s). Tracks last-fired
// minute to prevent double-fires within the same minute.
// ---------------------------------------------------------------------------

import { producer } from "../core/producer";
import type { Store } from "../core/types";
import { type CronSchedule, matchesCron, parseCron } from "./cron";

export interface FromCronOptions {
	/** User-specified name for Inspector. */
	id?: string;
	/** Check interval in ms. Default: 60_000 (1 minute). Useful for testing. */
	tickMs?: number;
}

export function fromCron(expr: string, opts?: FromCronOptions): Store<Date | undefined> {
	const schedule: CronSchedule = parseCron(expr);
	const tickMs = opts?.tickMs ?? 60_000;

	return producer<Date>(
		({ emit }) => {
			let lastFiredKey = -1;

			const check = () => {
				const now = new Date();
				// Packed decimal: YYYYMMDDHHII — collision-free unique key per minute
				const key =
					now.getFullYear() * 100_000_000 +
					(now.getMonth() + 1) * 1_000_000 +
					now.getDate() * 10_000 +
					now.getHours() * 100 +
					now.getMinutes();
				if (key !== lastFiredKey && matchesCron(schedule, now)) {
					lastFiredKey = key;
					emit(now);
				}
			};

			check();
			const id = setInterval(check, tickMs);
			return () => clearInterval(id);
		},
		{ name: opts?.id ?? `cron:${expr}` },
	);
}
