// ---------------------------------------------------------------------------
// Checkpoint persistence adapters — Phase 3a
// ---------------------------------------------------------------------------
// Pluggable adapters for checkpoint() persistence. Each adapter implements
// the CheckpointAdapter interface (save/load/clear).
//
// Shipped adapters:
//   - sqliteAdapter(db)     — SQLite via better-sqlite3 (peer dep)
//   - indexedDBAdapter(db)  — IndexedDB (browser)
// Note: fileAdapter lives in checkpointAdapters.node.ts (uses node:fs)
// ---------------------------------------------------------------------------

import { firstValueFrom } from "../raw/firstValueFrom";
import type { CheckpointAdapter } from "./checkpoint";
import { fromIDBRequest } from "./fromIDBRequest";

// ---------------------------------------------------------------------------
// SQLite adapter (via better-sqlite3 peer dep)
// ---------------------------------------------------------------------------

/** Minimal better-sqlite3-compatible interface. */
export interface SQLiteDatabase {
	prepare(sql: string): {
		run(...params: any[]): any;
		get(...params: any[]): any;
	};
	exec(sql: string): void;
}

export interface SQLiteAdapterOptions {
	/** A better-sqlite3 Database instance (peer dependency). */
	db: SQLiteDatabase;
	/** Table name. Default: "checkpoints". Must be alphanumeric/underscore only. */
	table?: string;
}

const SAFE_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * SQLite checkpoint adapter via better-sqlite3 (peer dependency).
 *
 * @param opts - Configuration with `db` instance and optional `table` name.
 *
 * @returns `CheckpointAdapter` — save/load/clear backed by SQLite.
 *
 * @remarks **Peer dep:** Requires `better-sqlite3`. Not bundled.
 * @remarks **Sync:** better-sqlite3 is synchronous, so operations are sync (no Promises).
 * @remarks **Auto-creates table:** The table is created if it doesn't exist.
 *
 * @example
 * ```ts
 * import Database from 'better-sqlite3';
 * import { checkpoint } from 'callbag-recharge/orchestrate';
 * import { sqliteAdapter } from 'callbag-recharge/orchestrate';
 *
 * const db = new Database('./workflow.db');
 * const adapter = sqliteAdapter({ db });
 * const durable = pipe(source, checkpoint("step-1", adapter));
 * ```
 *
 * @seeAlso [checkpoint](./checkpoint) — durable step boundary
 *
 * @category orchestrate
 */
export function sqliteAdapter(opts: SQLiteAdapterOptions): CheckpointAdapter {
	const { db } = opts;
	const table = opts.table ?? "checkpoints";

	if (!SAFE_TABLE_NAME.test(table)) {
		throw new Error(
			`sqliteAdapter: invalid table name "${table}". Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/.`,
		);
	}

	db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`);

	const insertStmt = db.prepare(`INSERT OR REPLACE INTO ${table} (id, value) VALUES (?, ?)`);
	const selectStmt = db.prepare(`SELECT value FROM ${table} WHERE id = ?`);
	const deleteStmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`);

	return {
		save(id: string, value: unknown): void {
			insertStmt.run(id, JSON.stringify(value));
		},

		load(id: string): unknown | undefined {
			const row = selectStmt.get(id) as { value: string } | undefined;
			return row ? JSON.parse(row.value) : undefined;
		},

		clear(id: string): void {
			deleteStmt.run(id);
		},
	};
}

// ---------------------------------------------------------------------------
// IndexedDB adapter (browser)
// ---------------------------------------------------------------------------

export interface IndexedDBAdapterOptions {
	/** Database name. Default: "callbag-checkpoints". */
	dbName?: string;
	/** Object store name. Default: "checkpoints". */
	storeName?: string;
}

/**
 * IndexedDB checkpoint adapter for browser environments.
 *
 * @param opts - Optional database and store names.
 *
 * @returns `CheckpointAdapter` — save/load/clear backed by IndexedDB.
 *
 * @remarks **Browser only:** Uses the IndexedDB API. Not available in Node.js without polyfills.
 * @remarks **Async:** All operations return Promises.
 * @remarks **Auto-creates:** Database and object store are created on first use.
 *
 * @example
 * ```ts
 * import { checkpoint } from 'callbag-recharge/orchestrate';
 * import { indexedDBAdapter } from 'callbag-recharge/orchestrate';
 *
 * const adapter = indexedDBAdapter();
 * const durable = pipe(source, checkpoint("step-1", adapter));
 * ```
 *
 * @seeAlso [checkpoint](./checkpoint) — durable step boundary
 *
 * @category orchestrate
 */
export function indexedDBAdapter(opts?: IndexedDBAdapterOptions): CheckpointAdapter {
	const dbName = opts?.dbName ?? "callbag-checkpoints";
	const storeName = opts?.storeName ?? "checkpoints";

	let _db: IDBDatabase | null = null;
	let _openPromise: Promise<IDBDatabase> | null = null;

	function openDB(): Promise<IDBDatabase> {
		if (_db) return Promise.resolve(_db);
		if (_openPromise) return _openPromise;

		const request = indexedDB.open(dbName, 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(storeName)) {
				db.createObjectStore(storeName);
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
		async save(id: string, value: unknown): Promise<void> {
			await withRetry("readwrite", (store) => store.put(value, id));
		},

		async load(id: string): Promise<unknown | undefined> {
			const result = await withRetry("readonly", (store) => store.get(id));
			return result ?? undefined;
		},

		async clear(id: string): Promise<void> {
			await withRetry("readwrite", (store) => store.delete(id));
		},
	};
}
