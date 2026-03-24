// ---------------------------------------------------------------------------
// File-based execution log adapter (Node.js only)
// ---------------------------------------------------------------------------
// Split from executionLogAdapters.ts to prevent Vite browser builds from
// encountering `node:fs/promises` when tree-shaking the barrel.
// ---------------------------------------------------------------------------

import { asyncQueue } from "../utils/asyncQueue";
import type { ExecutionEntry, ExecutionLogPersistAdapter } from "./executionLog";

export interface FileLogAdapterOptions {
	/** Directory to store the log file. Log is written to `<dir>/execution-log.jsonl`. */
	dir: string;
	/** File name. Default: "execution-log.jsonl". */
	filename?: string;
}

/**
 * File-based execution log adapter. Appends entries as newline-delimited JSON (JSONL).
 *
 * @param opts - Configuration with `dir` path and optional `filename`.
 *
 * @returns `ExecutionLogPersistAdapter` — append/load/clear backed by the filesystem.
 *
 * @remarks **Node.js only:** Uses `node:fs` for file operations. Not available in browser builds.
 * @remarks **Async:** All operations return Promises.
 * @remarks **Format:** Each entry is one JSON line. Append-friendly — no read-modify-write.
 *
 * @example
 * ```ts
 * import { executionLog } from 'callbag-recharge/orchestrate';
 * import { fileLogAdapter } from 'callbag-recharge/orchestrate/node';
 *
 * const adapter = fileLogAdapter({ dir: './logs' });
 * const log = executionLog({ persist: adapter });
 * ```
 *
 * @category orchestrate
 */
export function fileLogAdapter(opts: FileLogAdapterOptions): ExecutionLogPersistAdapter {
	const { dir } = opts;
	// Sanitize filename to prevent directory traversal
	const rawFilename = opts.filename ?? "execution-log.jsonl";
	const filename = rawFilename.replace(/[^a-zA-Z0-9_.-]/g, "_");

	function filePath(): string {
		return `${dir}/${filename}`;
	}

	// Serialize writes through asyncQueue (concurrency: 1) to prevent
	// interleaved JSONL lines from concurrent appends.
	const writeQueue = asyncQueue(
		async (entry: ExecutionEntry) => {
			const fs = await import("node:fs/promises");
			await fs.mkdir(dir, { recursive: true });
			await fs.appendFile(filePath(), `${JSON.stringify(entry)}\n`, "utf-8");
		},
		{ concurrency: 1, name: "fileLogAdapter" },
	);

	return {
		append(entry: ExecutionEntry): Promise<void> {
			return writeQueue.enqueue(entry).then(() => {});
		},

		async load(): Promise<ExecutionEntry[]> {
			const fs = await import("node:fs/promises");
			try {
				const data = await fs.readFile(filePath(), "utf-8");
				const lines = data.split("\n").filter((line) => line.length > 0);
				return lines.map((line) => JSON.parse(line) as ExecutionEntry);
			} catch (err: any) {
				if (err?.code === "ENOENT") return [];
				throw err;
			}
		},

		async clear(): Promise<void> {
			const fs = await import("node:fs/promises");
			try {
				await fs.unlink(filePath());
			} catch (err: any) {
				if (err?.code === "ENOENT") return;
				throw err;
			}
		},
	};
}
