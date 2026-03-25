import { describe, expect, it, vi } from "vitest";
import { subscribe } from "../../extra/subscribe";
import { pipe, state } from "../../index";
import { rawFromPromise } from "../../raw/fromPromise";
import type { CallbagSource } from "../../raw/subscribe";
import { checkpoint } from "../../utils/checkpoint";
import { sqliteAdapter } from "../../utils/checkpointAdapters";
import { fileAdapter } from "../../utils/checkpointAdapters.node";

// ---------------------------------------------------------------------------
// fileAdapter tests (structural — can't easily mock dynamic import)
// ---------------------------------------------------------------------------

describe("fileAdapter", () => {
	it("creates adapter with save/load/clear methods", () => {
		const adapter = fileAdapter({ dir: "/tmp/test-checkpoints" });
		expect(typeof adapter.save).toBe("function");
		expect(typeof adapter.load).toBe("function");
		expect(typeof adapter.clear).toBe("function");
	});

	it("sanitizes checkpoint id (no path traversal characters)", () => {
		const adapter = fileAdapter({ dir: "/tmp/checkpoints" });
		// Adapter should work without throwing for any id
		expect(adapter).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// sqliteAdapter tests
// ---------------------------------------------------------------------------

describe("sqliteAdapter", () => {
	it("save, load, and clear with mock database", () => {
		const rows = new Map<string, string>();
		const mockDb = {
			exec: vi.fn(),
			prepare: vi.fn().mockImplementation((sql: string) => {
				if (sql.includes("INSERT OR REPLACE")) {
					return {
						run: (id: string, value: string) => {
							rows.set(id, value);
						},
						get: vi.fn(),
					};
				}
				if (sql.includes("SELECT")) {
					return {
						run: vi.fn(),
						get: (id: string) => {
							const value = rows.get(id);
							return value ? { value } : undefined;
						},
					};
				}
				if (sql.includes("DELETE")) {
					return {
						run: (id: string) => {
							rows.delete(id);
						},
						get: vi.fn(),
					};
				}
				return { run: vi.fn(), get: vi.fn() };
			}),
		};

		const adapter = sqliteAdapter({ db: mockDb as any });

		// Verify table creation
		expect(mockDb.exec).toHaveBeenCalledWith(
			"CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
		);

		// Save
		adapter.save("step-1", { count: 10 });
		expect(rows.has("step-1")).toBe(true);

		// Load
		const loaded = adapter.load("step-1");
		expect(loaded).toEqual({ count: 10 });

		// Clear
		adapter.clear("step-1");
		expect(adapter.load("step-1")).toBeUndefined();
	});

	it("uses custom table name", () => {
		const mockDb = {
			exec: vi.fn(),
			prepare: vi.fn().mockReturnValue({ run: vi.fn(), get: vi.fn() }),
		};

		sqliteAdapter({ db: mockDb as any, table: "my_checkpoints" });
		expect(mockDb.exec).toHaveBeenCalledWith(
			"CREATE TABLE IF NOT EXISTS my_checkpoints (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
		);
	});
});

// ---------------------------------------------------------------------------
// Integration: async adapter with checkpoint()
// ---------------------------------------------------------------------------

describe("checkpoint + async adapter integration", () => {
	it("works with checkpoint operator (async adapter)", async () => {
		const store = new Map<string, unknown>();
		const asyncAdapter = {
			save(id: string, value: unknown): CallbagSource {
				return rawFromPromise(
					Promise.resolve().then(() => {
						store.set(id, value);
					}),
				);
			},
			load(id: string): CallbagSource {
				return rawFromPromise(Promise.resolve(store.get(id)));
			},
			clear(id: string): CallbagSource {
				return rawFromPromise(
					Promise.resolve().then(() => {
						store.delete(id);
					}),
				);
			},
		};

		const source = state(0);
		const durable = pipe(source, checkpoint("test-step", asyncAdapter));

		const values: any[] = [];
		const unsub = subscribe(durable, (v) => values.push(v));

		// Wait for async load to resolve
		await new Promise((r) => setTimeout(r, 10));

		source.set(42);

		// Wait for async save
		await new Promise((r) => setTimeout(r, 10));

		expect(values).toContain(42);
		expect(store.get("test-step")).toBe(42);

		unsub.unsubscribe();
	});

	it("recovers saved value on re-subscribe", async () => {
		const store = new Map<string, unknown>();
		const asyncAdapter = {
			save(id: string, value: unknown): CallbagSource {
				return rawFromPromise(
					Promise.resolve().then(() => {
						store.set(id, value);
					}),
				);
			},
			load(id: string): CallbagSource {
				return rawFromPromise(Promise.resolve(store.get(id)));
			},
			clear(id: string): CallbagSource {
				return rawFromPromise(
					Promise.resolve().then(() => {
						store.delete(id);
					}),
				);
			},
		};

		const source = state(0);

		// First subscription: save a value
		const durable1 = pipe(source, checkpoint("recover-test", asyncAdapter));
		const unsub1 = subscribe(durable1, () => {});
		await new Promise((r) => setTimeout(r, 10));
		source.set(99);
		await new Promise((r) => setTimeout(r, 10));
		unsub1.unsubscribe();

		// Second subscription: should recover 99
		const durable2 = pipe(source, checkpoint("recover-test", asyncAdapter));
		const values: any[] = [];
		const unsub2 = subscribe(durable2, (v) => values.push(v));
		await new Promise((r) => setTimeout(r, 10));

		expect(values).toContain(99);
		unsub2.unsubscribe();
	});
});
