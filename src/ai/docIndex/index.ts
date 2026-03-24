// ---------------------------------------------------------------------------
// docIndex — FTS5 trigram search over pre-built wa-sqlite DB
// ---------------------------------------------------------------------------
// Read-only full-text search for pre-indexed documentation. The .db file is
// built at VitePress build time (see scripts/build-doc-index.mjs) and loaded
// at runtime via wa-sqlite WASM.
//
// Usage:
//   const docs = docIndex({ db: '/docs-index.db' });
//   subscribe(docs.loaded, ready => { if (ready) docs.search('pipeline') });
//   subscribe(docs.results, hits => console.log(hits));
//
// Peer dependency: @aspect-build/wa-sqlite (dynamic import — not bundled).
// ---------------------------------------------------------------------------

import { batch, teardown } from "../../core/protocol";
import { state } from "../../core/state";
import type { Store } from "../../core/types";

export interface SearchResult {
	/** Chunk ID from the docs table. */
	id: string;
	/** Document title. */
	title: string;
	/** Snippet with <mark> highlights from FTS5. */
	excerpt: string;
	/** FTS5 rank score (lower = more relevant). */
	score: number;
	/** Origin file or section identifier. */
	source: string;
	/** Tags associated with the chunk. */
	tags: string[];
}

/** @internal SQLite API shape — avoids hard dep on wa-sqlite's types. */
export interface SqliteAPI {
	open_v2(filename: string, flags?: number, vfs?: string): number;
	exec(db: number, sql: string, callback?: (row: any[], columns: string[]) => void): number;
	close(db: number): number;
}

export interface DocIndexOptions {
	/** URL or path to the pre-built wa-sqlite .db file. */
	db: string | URL;
	/** Maximum results per search query. Default: 10 */
	limit?: number;
	/** Debug name for Inspector. */
	name?: string;
	/** Custom fetch implementation (for testing or edge runtimes). */
	fetch?: typeof globalThis.fetch;
	/** @internal Injected SQLite API for testing — skips dynamic import of wa-sqlite. */
	_sqlite?: SqliteAPI;
}

export interface DocIndexResult {
	/** Trigger a full-text search. Updates `results` store. */
	search(query: string): void;
	/** Reactive search results (empty array initially). */
	results: Store<SearchResult[]>;
	/** True once WASM + DB are loaded and ready for queries. */
	loaded: Store<boolean>;
	/** Last error from loading or querying, if any. */
	error: Store<unknown | undefined>;
	/** Tear down WASM resources. */
	destroy(): void;
}

/**
 * Create a read-only FTS5 trigram search index over a pre-built wa-sqlite DB.
 *
 * The DB is fetched and loaded into WASM on first call. Subsequent `search()`
 * calls execute FTS5 MATCH queries synchronously against the in-memory DB.
 */
export function docIndex(opts: DocIndexOptions): DocIndexResult {
	const dbUrl = typeof opts.db === "string" ? opts.db : opts.db.href;
	const limit = opts.limit ?? 10;
	const fetchFn = opts.fetch ?? globalThis.fetch;

	// Reactive stores
	const results = state<SearchResult[]>([], {
		name: opts.name ? `${opts.name}.results` : undefined,
	});
	const loaded = state(false, { name: opts.name ? `${opts.name}.loaded` : undefined });
	const error = state<unknown | undefined>(undefined, {
		name: opts.name ? `${opts.name}.error` : undefined,
	});

	// Internal state
	let sqlite3: SqliteAPI | null = null;
	let dbHandle: number | null = null;
	let destroyed = false;

	// If SQLite API is injected (testing), skip WASM — just simulate async lifecycle
	if (opts._sqlite) {
		sqlite3 = opts._sqlite;
		loadTestOnly();
	} else {
		load();
	}

	async function loadTestOnly(): Promise<void> {
		try {
			// Simulate async lifecycle for test consistency (fetch is mocked)
			const res = await fetchFn(dbUrl);
			if (!res.ok) throw new Error(`Failed to fetch DB: ${res.status} ${res.statusText}`);
			if (destroyed) return;
			// _sqlite is test-only: mock handles open_v2, no real DB bytes needed
			dbHandle = sqlite3!.open_v2("docs.db");
			batch(() => {
				loaded.set(true);
				error.set(undefined);
			});
		} catch (e) {
			if (!destroyed) {
				batch(() => {
					loaded.set(false);
					error.set(e);
				});
			}
		}
	}

	async function load(): Promise<void> {
		try {
			// Dynamic import — wa-sqlite is a peer dependency
			const waSqliteMod = await import("@aspect-build/wa-sqlite");

			// Fetch the DB file in parallel with WASM init
			const factory = waSqliteMod.default ?? waSqliteMod;
			const [sqliteModule, dbBytes] = await Promise.all([
				typeof factory === "function" ? factory() : factory,
				fetchFn(dbUrl).then((res) => {
					if (!res.ok) throw new Error(`Failed to fetch DB: ${res.status} ${res.statusText}`);
					return res.arrayBuffer();
				}),
			]);

			if (destroyed) return;

			// Build the SQLite API from the WASM module
			const { SQLiteAPI } = waSqliteMod;
			sqlite3 = SQLiteAPI(sqliteModule) as unknown as SqliteAPI;

			// Write the DB bytes to the WASM virtual filesystem if VFS supports it
			const vfs = sqliteModule.vfs;
			if (vfs && typeof vfs.writeFile === "function") {
				vfs.writeFile("docs.db", new Uint8Array(dbBytes));
			}

			dbHandle = sqlite3.open_v2("docs.db");

			batch(() => {
				loaded.set(true);
				error.set(undefined);
			});
		} catch (e) {
			if (!destroyed) {
				batch(() => {
					loaded.set(false);
					error.set(e);
				});
			}
		}
	}

	function search(query: string): void {
		if (!sqlite3 || dbHandle === null || destroyed) {
			results.set([]);
			return;
		}

		if (!query.trim()) {
			results.set([]);
			return;
		}

		try {
			const rows: SearchResult[] = [];

			// FTS5 MATCH query — wrap in double-quotes for phrase matching to
			// prevent FTS5 operator injection (AND, OR, NOT, NEAR, *, etc.)
			const escaped = query.replace(/"/g, '""');
			const sql = `SELECT id, title, snippet(docs, 1, '<mark>', '</mark>', '…', 32) as excerpt, rank, source, tags FROM docs WHERE docs MATCH '"${escaped}"' ORDER BY rank LIMIT ${limit}`;

			sqlite3.exec(dbHandle, sql, (row: any[], columns: string[]) => {
				const idIdx = columns.indexOf("id");
				const titleIdx = columns.indexOf("title");
				const excerptIdx = columns.indexOf("excerpt");
				const rankIdx = columns.indexOf("rank");
				const sourceIdx = columns.indexOf("source");
				const tagsIdx = columns.indexOf("tags");

				rows.push({
					id: String(row[idIdx] ?? ""),
					title: String(row[titleIdx] ?? ""),
					excerpt: String(row[excerptIdx] ?? ""),
					score: Number(row[rankIdx] ?? 0),
					source: String(row[sourceIdx] ?? ""),
					tags: row[tagsIdx]
						? String(row[tagsIdx])
								.split(",")
								.map((t: string) => t.trim())
								.filter(Boolean)
						: [],
				});
			});

			batch(() => {
				results.set(rows);
				error.set(undefined);
			});
		} catch (e) {
			batch(() => {
				results.set([]);
				error.set(e);
			});
		}
	}

	function destroy(): void {
		destroyed = true;
		if (sqlite3 && dbHandle !== null) {
			try {
				sqlite3.close(dbHandle);
			} catch {
				// ignore close errors during teardown
			}
		}
		sqlite3 = null;
		dbHandle = null;
		batch(() => {
			loaded.set(false);
			results.set([]);
			error.set(undefined);
		});
		teardown(results);
		teardown(loaded);
		teardown(error);
	}

	return {
		search,
		results,
		loaded,
		error,
		destroy,
	};
}
