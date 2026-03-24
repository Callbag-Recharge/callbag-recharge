// ---------------------------------------------------------------------------
// File-based checkpoint adapter (Node.js only)
// ---------------------------------------------------------------------------
// Split from checkpointAdapters.ts to prevent Vite browser builds from
// encountering `node:fs/promises` when tree-shaking the barrel.
// ---------------------------------------------------------------------------

import type { CheckpointAdapter } from "./checkpoint";

export interface FileAdapterOptions {
	/** Directory to store checkpoint files. Each checkpoint becomes `<dir>/<id>.json`. */
	dir: string;
}

/**
 * File-based checkpoint adapter. Stores each checkpoint as a JSON file in the given directory.
 *
 * @param opts - Configuration with `dir` path.
 *
 * @returns `CheckpointAdapter` — save/load/clear backed by the filesystem.
 *
 * @remarks **Node.js only:** Uses `node:fs` for file operations. Not available in browser builds.
 * @remarks **Async:** All operations return Promises.
 * @remarks **Format:** Values are JSON-serialized. Non-serializable values will throw on save.
 *
 * @example
 * ```ts
 * import { pipe } from 'callbag-recharge';
 * import { checkpoint } from 'callbag-recharge/utils';
 * import { fileAdapter } from 'callbag-recharge/utils/node';
 *
 * const adapter = fileAdapter({ dir: './checkpoints' });
 * const durable = pipe(source, checkpoint("step-1", adapter));
 * ```
 *
 * @seeAlso [checkpoint](./checkpoint) — durable step boundary, [memoryAdapter](./checkpoint) — in-memory adapter
 *
 * @category utils
 */
export function fileAdapter(opts: FileAdapterOptions): CheckpointAdapter {
	const { dir } = opts;

	function filePath(id: string): string {
		// Sanitize id to prevent directory traversal
		const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
		return `${dir}/${safe}.json`;
	}

	return {
		async save(id: string, value: unknown): Promise<void> {
			const fs = await import("node:fs/promises");
			await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(filePath(id), JSON.stringify(value), "utf-8");
		},

		async load(id: string): Promise<unknown | undefined> {
			const fs = await import("node:fs/promises");
			try {
				const data = await fs.readFile(filePath(id), "utf-8");
				return JSON.parse(data);
			} catch (err: any) {
				if (err?.code === "ENOENT") return undefined;
				throw err;
			}
		},

		async clear(id: string): Promise<void> {
			const fs = await import("node:fs/promises");
			try {
				await fs.unlink(filePath(id));
			} catch (err: any) {
				if (err?.code === "ENOENT") return; // Already gone
				throw err;
			}
		},
	};
}
