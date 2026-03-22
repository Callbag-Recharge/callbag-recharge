// ---------------------------------------------------------------------------
// Execution log persistence adapters — Phase 5b-1
// ---------------------------------------------------------------------------
// Pluggable adapters for executionLog() persistence. Each adapter implements
// the ExecutionLogPersistAdapter interface (append/load/clear).
//
// Shipped adapters:
//   - fileLogAdapter(dir)         — JSONL file in a directory (Node.js)
//   - sqliteLogAdapter(db)        — SQLite via better-sqlite3 (peer dep)
//   - indexedDBLogAdapter(db)     — IndexedDB (browser)
// ---------------------------------------------------------------------------

import { firstValueFrom } from "../raw/firstValueFrom";
import { asyncQueue } from "../utils/asyncQueue";
import { fromIDBRequest } from "../utils/fromIDBRequest";
import type { ExecutionEntry, ExecutionLogPersistAdapter } from "./executionLog";

// ---------------------------------------------------------------------------
// File-based adapter (Node.js) — JSONL format
// ---------------------------------------------------------------------------

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
 * import { fileLogAdapter } from 'callbag-recharge/orchestrate';
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

// ---------------------------------------------------------------------------
// SQLite adapter (via better-sqlite3 peer dep)
// ---------------------------------------------------------------------------

/** Minimal better-sqlite3-compatible interface. */
export interface SQLiteDatabase {
	prepare(sql: string): {
		run(...params: any[]): any;
		get(...params: any[]): any;
		all(...params: any[]): any[];
	};
	exec(sql: string): void;
}

export interface SQLiteLogAdapterOptions {
	/** A better-sqlite3 Database instance (peer dependency). */
	db: SQLiteDatabase;
	/** Table name. Default: "execution_log". Must be alphanumeric/underscore only. */
	table?: string;
}

const SAFE_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * SQLite execution log adapter via better-sqlite3 (peer dependency).
 *
 * @param opts - Configuration with `db` instance and optional `table` name.
 *
 * @returns `ExecutionLogPersistAdapter` — append/load/clear backed by SQLite.
 *
 * @remarks **Peer dep:** Requires `better-sqlite3`. Not bundled.
 * @remarks **Sync:** better-sqlite3 is synchronous, so operations are sync (no Promises).
 * @remarks **Auto-creates table:** The table is created if it doesn't exist.
 *
 * @example
 * ```ts
 * import Database from 'better-sqlite3';
 * import { executionLog } from 'callbag-recharge/orchestrate';
 * import { sqliteLogAdapter } from 'callbag-recharge/orchestrate';
 *
 * const db = new Database('./workflow.db');
 * const adapter = sqliteLogAdapter({ db });
 * const log = executionLog({ persist: adapter });
 * ```
 *
 * @category orchestrate
 */
export function sqliteLogAdapter(opts: SQLiteLogAdapterOptions): ExecutionLogPersistAdapter {
	const { db } = opts;
	const table = opts.table ?? "execution_log";

	if (!SAFE_TABLE_NAME.test(table)) {
		throw new Error(
			`sqliteLogAdapter: invalid table name "${table}". Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/.`,
		);
	}

	db.exec(
		`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT, entry TEXT NOT NULL)`,
	);

	const insertStmt = db.prepare(`INSERT INTO ${table} (entry) VALUES (?)`);
	const selectAllStmt = db.prepare(`SELECT entry FROM ${table} ORDER BY id`);
	const deleteAllStmt = db.prepare(`DELETE FROM ${table}`);

	return {
		append(entry: ExecutionEntry): void {
			insertStmt.run(JSON.stringify(entry));
		},

		load(): ExecutionEntry[] {
			const rows = selectAllStmt.all() as { entry: string }[];
			return rows.map((row) => JSON.parse(row.entry) as ExecutionEntry);
		},

		clear(): void {
			deleteAllStmt.run();
		},
	};
}

// ---------------------------------------------------------------------------
// IndexedDB adapter (browser)
// ---------------------------------------------------------------------------

export interface IndexedDBLogAdapterOptions {
	/** Database name. Default: "callbag-execution-log". */
	dbName?: string;
	/** Object store name. Default: "execution_log". */
	storeName?: string;
}

/**
 * IndexedDB execution log adapter for browser environments.
 *
 * @param opts - Optional database and store names.
 *
 * @returns `ExecutionLogPersistAdapter` — append/load/clear backed by IndexedDB.
 *
 * @remarks **Browser only:** Uses the IndexedDB API. Not available in Node.js without polyfills.
 * @remarks **Async:** All operations return Promises.
 * @remarks **Auto-creates:** Database and object store are created on first use.
 *
 * @example
 * ```ts
 * import { executionLog } from 'callbag-recharge/orchestrate';
 * import { indexedDBLogAdapter } from 'callbag-recharge/orchestrate';
 *
 * const adapter = indexedDBLogAdapter();
 * const log = executionLog({ persist: adapter });
 * ```
 *
 * @category orchestrate
 */
export function indexedDBLogAdapter(opts?: IndexedDBLogAdapterOptions): ExecutionLogPersistAdapter {
	const dbName = opts?.dbName ?? "callbag-execution-log";
	const storeName = opts?.storeName ?? "execution_log";

	let _db: IDBDatabase | null = null;
	let _openPromise: Promise<IDBDatabase> | null = null;

	function openDB(): Promise<IDBDatabase> {
		if (_db) return Promise.resolve(_db);
		if (_openPromise) return _openPromise;

		const request = indexedDB.open(dbName, 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(storeName)) {
				db.createObjectStore(storeName, { autoIncrement: true });
			}
		};

		_openPromise = firstValueFrom<IDBDatabase>(fromIDBRequest(request)).then((db) => {
			_db = db;
			_db.onversionchange = () => {
				_db?.close();
				_db = null;
				_openPromise = null;
			};
			return _db;
		});
		_openPromise.catch(() => {
			_openPromise = null;
		});
		return _openPromise;
	}

	function tx(mode: IDBTransactionMode): Promise<{ store: IDBObjectStore; tx: IDBTransaction }> {
		return openDB().then((db) => {
			const transaction = db.transaction(storeName, mode);
			return { store: transaction.objectStore(storeName), tx: transaction };
		});
	}

	// Retry once on stale connection (e.g., after onversionchange closed _db)
	async function withRetry<R>(
		mode: IDBTransactionMode,
		op: (store: IDBObjectStore) => IDBRequest<R>,
	): Promise<R> {
		try {
			const { store } = await tx(mode);
			return await firstValueFrom<R>(fromIDBRequest(op(store)));
		} catch (err: any) {
			if (err?.name === "InvalidStateError" || _db === null) {
				_db = null;
				_openPromise = null;
				const { store } = await tx(mode);
				return firstValueFrom<R>(fromIDBRequest(op(store)));
			}
			throw err;
		}
	}

	return {
		async append(entry: ExecutionEntry): Promise<void> {
			await withRetry("readwrite", (store) => store.add(entry));
		},

		async load(): Promise<ExecutionEntry[]> {
			return withRetry("readonly", (store) => store.getAll()) as Promise<ExecutionEntry[]>;
		},

		async clear(): Promise<void> {
			await withRetry("readwrite", (store) => store.clear());
		},
	};
}
