// ---------------------------------------------------------------------------
// diagram — pipeline-aware Mermaid + D2 serializers (Phase 5b-8)
// ---------------------------------------------------------------------------
// Serialize a pipeline()'s step-level DAG to Mermaid or D2 diagram syntax.
// Unlike Inspector.toMermaid()/toD2() which show the low-level reactive graph,
// these functions show user-declared step names, deps, and step types.
//
// Usage:
//   const steps = {
//     trigger: step(fromTrigger<string>()),
//     fetch:   task(["trigger"], async (signal, [v]) => fetchData(v)),
//     process: task(["fetch"], async (signal, [data]) => transform(data)),
//   };
//   const wf = pipeline(steps);
//   console.log(toMermaid(steps));
//   console.log(toMermaid(steps, { status: wf }));
// ---------------------------------------------------------------------------

import type { PipelineResult, StepDef } from "./pipeline";
import { TASK_STATE } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Detect the step type from a StepDef by checking for known markers. */
function detectStepType(def: StepDef): string {
	const d = def as any;
	if (d._failStore) return "branch";
	if (d._kind) return d._kind as string;
	if (d[TASK_STATE]) return "task";
	if (def.deps.length === 0) return "source";
	return "step";
}

/** Sanitize a name for use as a diagram node ID. */
function sanitizeId(name: string, usedIds: Map<string, number>): string {
	const base = name.replace(/[^a-zA-Z0-9_]/g, "_");
	const count = usedIds.get(base);
	if (count === undefined) {
		usedIds.set(base, 1);
		return base;
	}
	usedIds.set(base, count + 1);
	return `${base}__${count}`;
}

/** Collect all step names including compound steps (e.g., "validate.fail"). */
function collectSteps(
	steps: Record<string, StepDef>,
): Array<{ name: string; type: string; deps: string[] }> {
	const result: Array<{ name: string; type: string; deps: string[] }> = [];

	for (const [name, def] of Object.entries(steps)) {
		const type = detectStepType(def);
		result.push({ name, type, deps: def.deps });

		// Auto-include .fail for branch steps
		if (type === "branch") {
			result.push({
				name: `${name}.fail`,
				type: "branch-fail",
				deps: [name],
			});
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// toMermaid
// ---------------------------------------------------------------------------

export interface MermaidOpts {
	/** Flowchart direction. Default: "TD". */
	direction?: "TD" | "LR" | "BT" | "RL";
	/** Running pipeline instance for runtime status decoration. */
	status?: PipelineResult<any>;
}

/**
 * Serialize a pipeline's step-level DAG to Mermaid flowchart syntax.
 *
 * @param steps - The step definitions record (same object passed to `pipeline()`).
 * @param opts - Optional direction and runtime status source.
 *
 * @returns Mermaid flowchart string.
 *
 * @remarks **Step types:** Detected automatically — source (no deps), task (has taskState),
 * branch (has _failStore), step (generic). Shown in node labels.
 * @remarks **Runtime status:** Pass a running `PipelineResult` via `opts.status` to add
 * status-based CSS classes to nodes (idle, active, completed, errored).
 * @remarks **Branch support:** Branch steps auto-include their `.fail` companion node.
 *
 * @example
 * ```ts
 * import { pipeline, step, task, toMermaid, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * const steps = {
 *   trigger: step(fromTrigger<string>()),
 *   fetch:   task(["trigger"], async (signal, [v]) => fetchData(v)),
 * };
 * const wf = pipeline(steps);
 * console.log(toMermaid(steps));
 * // graph TD
 * //   trigger["trigger (source)"]
 * //   fetch["fetch (task)"]
 * //   trigger --> fetch
 * ```
 *
 * @category orchestrate
 */
export function toMermaid(steps: Record<string, StepDef>, opts?: MermaidOpts): string {
	const direction = opts?.direction ?? "TD";
	const allSteps = collectSteps(steps);
	const lines: string[] = [`graph ${direction}`];

	const usedIds = new Map<string, number>();
	const nameToId = new Map<string, string>();

	// Status CSS class mapping
	const statusClass: Record<string, string> = {
		idle: ":::idle",
		active: ":::active",
		completed: ":::completed",
		errored: ":::errored",
	};

	// Node declarations
	for (const s of allSteps) {
		const id = sanitizeId(s.name, usedIds);
		nameToId.set(s.name, id);

		const label = `${s.name} (${s.type})`;
		let style = "";

		if (opts?.status) {
			const meta = (opts.status.inner.stepMeta as any)[s.name];
			if (meta) {
				const st = meta.get()?.status;
				if (st) style = statusClass[st] ?? "";
			}
		}

		// Use different shapes per type
		let nodeDecl: string;
		switch (s.type) {
			case "source":
				nodeDecl = `${id}([${JSON.stringify(label)}])`;
				break;
			case "branch":
				nodeDecl = `${id}{${JSON.stringify(label)}}`;
				break;
			case "branch-fail":
				nodeDecl = `${id}[${JSON.stringify(label)}]`;
				break;
			default:
				nodeDecl = `${id}[${JSON.stringify(label)}]`;
				break;
		}

		lines.push(`  ${nodeDecl}${style}`);
	}

	// Edge declarations
	for (const s of allSteps) {
		for (const dep of s.deps) {
			const fromId = nameToId.get(dep);
			const toId = nameToId.get(s.name);
			if (fromId && toId) {
				lines.push(`  ${fromId} --> ${toId}`);
			}
		}
	}

	// classDef for status-based styling
	if (opts?.status) {
		lines.push("");
		lines.push("  classDef idle fill:#f5f5f5,stroke:#999");
		lines.push("  classDef active fill:#fff3cd,stroke:#ffc107");
		lines.push("  classDef completed fill:#d4edda,stroke:#28a745");
		lines.push("  classDef errored fill:#f8d7da,stroke:#dc3545");
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// toD2
// ---------------------------------------------------------------------------

export interface D2Opts {
	/** Diagram direction. Default: "down". */
	direction?: "right" | "down" | "left" | "up";
	/** Running pipeline instance for runtime status decoration. */
	status?: PipelineResult<any>;
}

/**
 * Serialize a pipeline's step-level DAG to D2 diagram syntax.
 *
 * @param steps - The step definitions record (same object passed to `pipeline()`).
 * @param opts - Optional direction and runtime status source.
 *
 * @returns D2 diagram string.
 *
 * @remarks **Step types:** Detected automatically — source, task, branch, step.
 * Different shapes per type (oval for source, diamond for branch, rectangle for others).
 * @remarks **Runtime status:** Pass a running `PipelineResult` via `opts.status` to
 * add status annotations to node labels.
 *
 * @example
 * ```ts
 * import { pipeline, step, task, toD2, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * const steps = {
 *   trigger: step(fromTrigger<string>()),
 *   fetch:   task(["trigger"], async (signal, [v]) => fetchData(v)),
 * };
 * console.log(toD2(steps));
 * // direction: down
 * //
 * // trigger: "trigger (source)" { shape: oval }
 * // fetch: "fetch (task)" { shape: rectangle }
 * //
 * // trigger -> fetch
 * ```
 *
 * @category orchestrate
 */
export function toD2(steps: Record<string, StepDef>, opts?: D2Opts): string {
	const direction = opts?.direction ?? "down";
	const allSteps = collectSteps(steps);
	const lines: string[] = [`direction: ${direction}`, ""];

	const kindShape: Record<string, string> = {
		source: "oval",
		task: "rectangle",
		join: "hexagon",
		sensor: "hexagon",
		loop: "hexagon",
		branch: "diamond",
		"branch-fail": "rectangle",
		step: "rectangle",
	};

	const usedIds = new Map<string, number>();
	const nameToId = new Map<string, string>();

	// Node declarations
	for (const s of allSteps) {
		const id = sanitizeId(s.name, usedIds);
		nameToId.set(s.name, id);

		const shape = kindShape[s.type] ?? "rectangle";
		let label = `${s.name} (${s.type})`;

		if (opts?.status) {
			const meta = (opts.status.inner.stepMeta as any)[s.name];
			if (meta) {
				const st = meta.get()?.status;
				if (st) label += ` [${st}]`;
			}
		}

		const escaped = label.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		lines.push(`${id}: "${escaped}" { shape: ${shape} }`);
	}

	// Edge declarations
	const edges: string[] = [];
	for (const s of allSteps) {
		for (const dep of s.deps) {
			const fromId = nameToId.get(dep);
			const toId = nameToId.get(s.name);
			if (fromId && toId) {
				edges.push(`${fromId} -> ${toId}`);
			}
		}
	}

	if (edges.length > 0) {
		lines.push("");
		for (const edge of edges) {
			lines.push(edge);
		}
	}

	return lines.join("\n");
}
