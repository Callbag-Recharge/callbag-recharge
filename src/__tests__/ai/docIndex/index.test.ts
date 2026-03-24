import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult, SqliteAPI } from "../../../ai/docIndex";
import { docIndex } from "../../../ai/docIndex";
import { subscribe } from "../../../core/subscribe";

// ---------------------------------------------------------------------------
// Mock SQLite API — injected via _sqlite option (no vi.mock needed)
// ---------------------------------------------------------------------------

let mockExec: ReturnType<typeof vi.fn>;
let mockOpen: ReturnType<typeof vi.fn>;
let mockClose: ReturnType<typeof vi.fn>;
let mockSqlite: SqliteAPI;

function mockFetchOk(): typeof globalThis.fetch {
	return vi.fn().mockResolvedValue(new Response(new ArrayBuffer(0), { status: 200 })) as any;
}

function mockFetchFail(status = 404): typeof globalThis.fetch {
	return vi.fn().mockResolvedValue(new Response(null, { status, statusText: "Not Found" })) as any;
}

let currentDocs: ReturnType<typeof docIndex> | null = null;

beforeEach(() => {
	mockExec = vi.fn();
	mockOpen = vi.fn().mockReturnValue(42);
	mockClose = vi.fn().mockReturnValue(0);
	mockSqlite = {
		open_v2: mockOpen,
		exec: mockExec,
		close: mockClose,
	};
});

afterEach(() => {
	if (currentDocs) {
		currentDocs.destroy();
		currentDocs = null;
	}
});

describe("docIndex", () => {
	it("sets loaded=true after DB fetch", async () => {
		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchOk(), _sqlite: mockSqlite });

		await vi.waitFor(() => expect(currentDocs!.loaded.get()).toBe(true), { timeout: 1000 });
		expect(currentDocs.error.get()).toBeUndefined();
	});

	it("sets error on fetch failure", async () => {
		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchFail(), _sqlite: mockSqlite });

		await vi.waitFor(() => expect(currentDocs!.error.get()).toBeDefined(), { timeout: 1000 });
		expect(currentDocs.loaded.get()).toBe(false);
	});

	it("results starts as empty array", () => {
		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchOk(), _sqlite: mockSqlite });
		expect(currentDocs.results.get()).toEqual([]);
	});

	it("search() updates results store", async () => {
		mockExec.mockImplementation((_db: number, _sql: string, callback?: Function) => {
			if (callback) {
				const columns = ["id", "title", "excerpt", "rank", "source", "tags"];
				callback(
					[
						"doc-1",
						"Pipeline API",
						"Use <mark>pipeline</mark>…",
						-5.2,
						"api-ref",
						"orchestrate,pipeline",
					],
					columns,
				);
				callback(
					["doc-2", "Task API", "Create a <mark>task</mark>…", -3.1, "api-ref", "orchestrate"],
					columns,
				);
			}
			return 0;
		});

		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchOk(), _sqlite: mockSqlite });
		await vi.waitFor(() => expect(currentDocs!.loaded.get()).toBe(true), { timeout: 1000 });

		currentDocs.search("pipeline");

		const results = currentDocs.results.get();
		expect(results).toHaveLength(2);
		expect(results[0]).toMatchObject({
			id: "doc-1",
			title: "Pipeline API",
			score: -5.2,
			source: "api-ref",
			tags: ["orchestrate", "pipeline"],
		});
		expect(results[1].id).toBe("doc-2");
	});

	it("search() with empty query returns empty results", async () => {
		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchOk(), _sqlite: mockSqlite });
		await vi.waitFor(() => expect(currentDocs!.loaded.get()).toBe(true), { timeout: 1000 });

		currentDocs.search("   ");
		expect(currentDocs.results.get()).toEqual([]);
	});

	it("search() before loaded returns empty results", () => {
		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchOk(), _sqlite: mockSqlite });
		expect(currentDocs.loaded.get()).toBe(false);

		currentDocs.search("pipeline");
		expect(currentDocs.results.get()).toEqual([]);
	});

	it("search() sets error on SQL failure", async () => {
		mockExec.mockImplementation(() => {
			throw new Error("FTS5 parse error");
		});

		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchOk(), _sqlite: mockSqlite });
		await vi.waitFor(() => expect(currentDocs!.loaded.get()).toBe(true), { timeout: 1000 });

		currentDocs.search("bad query {{");
		expect(currentDocs.error.get()).toBeInstanceOf(Error);
		expect(currentDocs.results.get()).toEqual([]);
	});

	it("results store is reactive via subscribe", async () => {
		mockExec.mockImplementation((_db: number, _sql: string, callback?: Function) => {
			if (callback) {
				callback(
					["doc-1", "Title", "Excerpt", -1, "src", ""],
					["id", "title", "excerpt", "rank", "source", "tags"],
				);
			}
			return 0;
		});

		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchOk(), _sqlite: mockSqlite });
		await vi.waitFor(() => expect(currentDocs!.loaded.get()).toBe(true), { timeout: 1000 });

		const observed: SearchResult[][] = [];
		const sub = subscribe(currentDocs.results, (v) => observed.push(v));

		currentDocs.search("test");
		expect(observed.length).toBeGreaterThanOrEqual(1);
		expect(observed[observed.length - 1]).toHaveLength(1);

		sub.unsubscribe();
	});

	it("destroy() tears down and resets stores", async () => {
		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchOk(), _sqlite: mockSqlite });
		await vi.waitFor(() => expect(currentDocs!.loaded.get()).toBe(true), { timeout: 1000 });

		currentDocs.destroy();

		expect(currentDocs.loaded.get()).toBe(false);
		expect(currentDocs.results.get()).toEqual([]);
		expect(currentDocs.error.get()).toBeUndefined();
		expect(mockClose).toHaveBeenCalled();
		currentDocs = null;
	});

	it("search() after destroy returns empty", async () => {
		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchOk(), _sqlite: mockSqlite });
		await vi.waitFor(() => expect(currentDocs!.loaded.get()).toBe(true), { timeout: 1000 });

		currentDocs.destroy();
		currentDocs.search("pipeline");
		expect(currentDocs.results.get()).toEqual([]);
		currentDocs = null;
	});

	it("respects custom limit option", async () => {
		mockExec.mockImplementation((_db: number, sql: string, _callback?: Function) => {
			expect(sql).toContain("LIMIT 5");
			return 0;
		});

		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchOk(), _sqlite: mockSqlite, limit: 5 });
		await vi.waitFor(() => expect(currentDocs!.loaded.get()).toBe(true), { timeout: 1000 });

		currentDocs.search("test");
	});

	it("escapes double quotes in query for FTS5 phrase matching", async () => {
		mockExec.mockImplementation((_db: number, sql: string, _callback?: Function) => {
			// Query wrapped in double-quotes for FTS5 phrase matching
			// Internal double-quotes escaped as ""
			expect(sql).toContain('say ""hello""');
			return 0;
		});

		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchOk(), _sqlite: mockSqlite });
		await vi.waitFor(() => expect(currentDocs!.loaded.get()).toBe(true), { timeout: 1000 });

		currentDocs.search('say "hello"');
	});

	it("parses tags from comma-separated string", async () => {
		mockExec.mockImplementation((_db: number, _sql: string, callback?: Function) => {
			if (callback) {
				callback(
					["id", "Title", "Exc", -1, "src", "a, b, c"],
					["id", "title", "excerpt", "rank", "source", "tags"],
				);
			}
			return 0;
		});

		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchOk(), _sqlite: mockSqlite });
		await vi.waitFor(() => expect(currentDocs!.loaded.get()).toBe(true), { timeout: 1000 });

		currentDocs.search("test");
		expect(currentDocs.results.get()[0].tags).toEqual(["a", "b", "c"]);
	});

	it("handles empty tags gracefully", async () => {
		mockExec.mockImplementation((_db: number, _sql: string, callback?: Function) => {
			if (callback) {
				callback(
					["id", "Title", "Exc", -1, "src", ""],
					["id", "title", "excerpt", "rank", "source", "tags"],
				);
			}
			return 0;
		});

		currentDocs = docIndex({ db: "/docs.db", fetch: mockFetchOk(), _sqlite: mockSqlite });
		await vi.waitFor(() => expect(currentDocs!.loaded.get()).toBe(true), { timeout: 1000 });

		currentDocs.search("test");
		expect(currentDocs.results.get()[0].tags).toEqual([]);
	});
});
