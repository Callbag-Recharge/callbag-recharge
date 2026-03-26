// ---------------------------------------------------------------------------
// jobFlow — multi-queue workflow wiring (Phase 5e-8)
// ---------------------------------------------------------------------------
// Chains job queues into a pipeline. Output of queue A publishes to queue B's
// topic via completion event listeners. Exports to Mermaid/D2 for visualization.
//
// Usage:
//   const emailQ = jobQueue<string, void>("email", async (s, d) => sendEmail(d));
//   const logQ = jobQueue<string, void>("log", async (s, d) => logSent(d));
//   const flow = jobFlow(
//     { email: emailQ, log: logQ },
//     [{ from: "email", to: "log" }],
//   );
//   flow.queues.email.add("user@example.com");
// ---------------------------------------------------------------------------

import type { JobFlow, JobFlowEdge, JobFlowOptions, JobQueue } from "./types";

/**
 * Chain multiple job queues into a workflow. When a job completes in a source
 * queue, its result is published to the destination queue (optionally transformed).
 *
 * @param queues - Named record of job queues.
 * @param edges - Wiring edges describing which queue outputs feed into which queue inputs.
 * @param opts - Optional configuration (name).
 *
 * @returns `JobFlow` — a multi-queue workflow with diagram export and lifecycle.
 *
 * @category messaging
 */
export function jobFlow(
	queues: Record<string, JobQueue<any, any>>,
	edges: JobFlowEdge[],
	opts?: JobFlowOptions,
): JobFlow {
	const flowName = opts?.name ?? "jobFlow";
	const _unsubscribes: (() => void)[] = [];

	// Validate edges
	for (const edge of edges) {
		if (!queues[edge.from]) {
			throw new Error(`jobFlow: source queue "${edge.from}" not found`);
		}
		if (!queues[edge.to]) {
			throw new Error(`jobFlow: destination queue "${edge.to}" not found`);
		}
	}

	// Wire edges: on completion of source queue, publish to destination queue
	for (const edge of edges) {
		const sourceQ = queues[edge.from];
		const destQ = queues[edge.to];

		const unsub = sourceQ.on("completed", (job) => {
			try {
				const data = edge.transform ? edge.transform(job.result) : job.result;
				if (edge.fanOut) {
					if (!Array.isArray(data)) {
						throw new Error(
							`jobFlow: edge "${edge.from}" -> "${edge.to}" requires array output when fanOut=true`,
						);
					}
					for (const item of data) {
						destQ.add(item);
					}
				} else {
					destQ.add(data);
				}
			} catch (err) {
				throw new Error(
					`jobFlow: edge "${edge.from}" -> "${edge.to}" failed: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		});
		_unsubscribes.push(unsub);
	}

	// --- Diagram export ---

	function toMermaid(): string {
		const lines: string[] = [];
		lines.push("graph LR");

		const queueNames = Object.keys(queues);
		for (const qName of queueNames) {
			lines.push(`    ${_sanitizeId(qName)}["${qName}"]`);
		}

		for (const edge of edges) {
			const label = edge.fanOut ? "fan-out" : edge.transform ? "transform" : "";
			const fromId = _sanitizeId(edge.from);
			const toId = _sanitizeId(edge.to);
			if (label) {
				lines.push(`    ${fromId} -->|${label}| ${toId}`);
			} else {
				lines.push(`    ${fromId} --> ${toId}`);
			}
		}

		return lines.join("\n");
	}

	function toD2(): string {
		const lines: string[] = [];

		const queueNames = Object.keys(queues);
		for (const qName of queueNames) {
			lines.push(`${_sanitizeId(qName)}: ${qName}`);
		}

		for (const edge of edges) {
			const fromId = _sanitizeId(edge.from);
			const toId = _sanitizeId(edge.to);
			const label = edge.fanOut ? ": fan-out" : edge.transform ? ": transform" : "";
			lines.push(`${fromId} -> ${toId}${label}`);
		}

		return lines.join("\n");
	}

	function _sanitizeId(name: string): string {
		return name.replace(/[^a-zA-Z0-9_]/g, "_");
	}

	return {
		get name() {
			return flowName;
		},
		queues,
		toMermaid,
		toD2,
		destroy(): void {
			for (const unsub of _unsubscribes) {
				unsub();
			}
			_unsubscribes.length = 0;
			// Flow only owns the wiring (edge subscriptions), not the queues.
			// Callers manage queue lifecycle independently.
		},
	};
}
