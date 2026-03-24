import { describe, expect, it, vi } from "vitest";
import type { ExecutionEntry } from "../../orchestrate/executionLog";
import { executionLog } from "../../orchestrate/executionLog";
import { sqliteLogAdapter } from "../../orchestrate/executionLogAdapters";
import { fileLogAdapter } from "../../orchestrate/executionLogAdapters.node";

// ---------------------------------------------------------------------------
// fileLogAdapter tests
// ---------------------------------------------------------------------------

describe("fileLogAdapter", () => {
	it("creates adapter with append/load/clear methods", () => {
		const adapter = fileLogAdapter({ dir: "/tmp/test-logs" });
		expect(typeof adapter.append).toBe("function");
		expect(typeof adapter.load).toBe("function");
		expect(typeof adapter.clear).toBe("function");
	});

	it("append + load round-trips entries via filesystem", async () => {
		const dir = `/tmp/test-logs-${Date.now()}`;
		const adapter = fileLogAdapter({ dir });

		const entry1: ExecutionEntry = { step: "a", event: "start", timestamp: 1000 };
		const entry2: ExecutionEntry = { step: "a", event: "value", timestamp: 1001, value: 42 };

		await adapter.append(entry1);
		await adapter.append(entry2);

		const loaded = await adapter.load();
		expect(loaded).toHaveLength(2);
		expect(loaded[0]).toEqual(entry1);
		expect(loaded[1]).toEqual(entry2);

		// Clean up
		await adapter.clear();
		const afterClear = await adapter.load();
		expect(afterClear).toEqual([]);
	});

	it("load returns empty array when file does not exist", async () => {
		const adapter = fileLogAdapter({ dir: `/tmp/nonexistent-${Date.now()}` });
		const loaded = await adapter.load();
		expect(loaded).toEqual([]);
	});

	it("clear is idempotent when file does not exist", async () => {
		const adapter = fileLogAdapter({ dir: `/tmp/nonexistent-${Date.now()}` });
		await expect(adapter.clear()).resolves.toBeUndefined();
	});

	it("custom filename", async () => {
		const dir = `/tmp/test-logs-custom-${Date.now()}`;
		const adapter = fileLogAdapter({ dir, filename: "custom.jsonl" });

		await adapter.append({ step: "x", event: "start", timestamp: 1 });
		const loaded = await adapter.load();
		expect(loaded).toHaveLength(1);

		await adapter.clear();
	});
});

// ---------------------------------------------------------------------------
// sqliteLogAdapter tests
// ---------------------------------------------------------------------------

describe("sqliteLogAdapter", () => {
	it("save, load, and clear with mock database", () => {
		const rows: { entry: string }[] = [];
		const mockDb = {
			exec: vi.fn(),
			prepare: vi.fn().mockImplementation((sql: string) => {
				if (sql.includes("INSERT INTO")) {
					return {
						run: (entryJson: string) => {
							rows.push({ entry: entryJson });
						},
						get: vi.fn(),
						all: vi.fn(),
					};
				}
				if (sql.includes("SELECT")) {
					return {
						run: vi.fn(),
						get: vi.fn(),
						all: () => [...rows],
					};
				}
				if (sql.includes("DELETE")) {
					return {
						run: () => {
							rows.length = 0;
						},
						get: vi.fn(),
						all: vi.fn(),
					};
				}
				return { run: vi.fn(), get: vi.fn(), all: vi.fn() };
			}),
		};

		const adapter = sqliteLogAdapter({ db: mockDb as any });

		// Verify table creation
		expect(mockDb.exec).toHaveBeenCalledWith(
			"CREATE TABLE IF NOT EXISTS execution_log (id INTEGER PRIMARY KEY AUTOINCREMENT, entry TEXT NOT NULL)",
		);

		// Append
		const entry: ExecutionEntry = { step: "a", event: "start", timestamp: 1000 };
		adapter.append(entry);
		expect(rows).toHaveLength(1);

		// Load
		const loaded = adapter.load() as ExecutionEntry[];
		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toEqual(entry);

		// Clear
		adapter.clear();
		expect(rows).toHaveLength(0);
	});

	it("uses custom table name", () => {
		const mockDb = {
			exec: vi.fn(),
			prepare: vi.fn().mockReturnValue({ run: vi.fn(), get: vi.fn(), all: vi.fn() }),
		};

		sqliteLogAdapter({ db: mockDb as any, table: "my_log" });
		expect(mockDb.exec).toHaveBeenCalledWith(
			"CREATE TABLE IF NOT EXISTS my_log (id INTEGER PRIMARY KEY AUTOINCREMENT, entry TEXT NOT NULL)",
		);
	});

	it("rejects invalid table names", () => {
		const mockDb = { exec: vi.fn(), prepare: vi.fn() };
		expect(() => sqliteLogAdapter({ db: mockDb as any, table: "drop; --" })).toThrow(
			/invalid table name/,
		);
	});
});

// ---------------------------------------------------------------------------
// Integration: adapter with executionLog
// ---------------------------------------------------------------------------

describe("executionLog + fileLogAdapter integration", () => {
	it("persists entries through adapter and recovers on load", async () => {
		const dir = `/tmp/test-exec-log-${Date.now()}`;
		const adapter = fileLogAdapter({ dir });
		const log = executionLog({ persist: adapter });

		log.append({ step: "a", event: "start", timestamp: 1000 });
		log.append({ step: "a", event: "value", timestamp: 1001, value: "hello" });

		// Wait for serialized writes (asyncQueue ensures ordering)
		await new Promise((r) => setTimeout(r, 100));

		const loaded = await adapter.load();
		expect(loaded).toHaveLength(2);
		expect(loaded[0].event).toBe("start");
		expect(loaded[1].event).toBe("value");

		log.destroy();
		await adapter.clear();
	});
});
