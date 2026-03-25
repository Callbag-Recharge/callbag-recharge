import { describe, expect, it, vi } from "vitest";

const mockExec = vi.fn();
const mockOpen = vi.fn().mockReturnValue(42);
const mockClose = vi.fn().mockReturnValue(0);

vi.mock("@aspect-build/wa-sqlite", () => {
	const sqliteApi = {
		open_v2: (...args: any[]) => mockOpen(...args),
		exec: (...args: any[]) => mockExec(...args),
		close: (...args: any[]) => mockClose(...args),
	};
	return {
		default: () => Promise.resolve({ vfs: null }),
		SQLiteAPI: () => sqliteApi,
		createTag: vi.fn(),
	};
});

import { docIndex } from "../../../ai/docIndex";

function okFetch(): any {
	return vi.fn().mockResolvedValue(new Response(new ArrayBuffer(0), { status: 200 }));
}

describe("debug ordering", () => {
	it("test 1: loads ok", async () => {
		const d = docIndex({ db: "/docs.db", fetch: okFetch() });
		await vi.waitFor(() => expect(d.loaded.get()).toBe(true), { timeout: 1000 });
		d.destroy();
	});

	it("test 2: never-resolve fetch", () => {
		const d = docIndex({ db: "/docs.db", fetch: vi.fn().mockReturnValue(new Promise(() => {})) });
		expect(d.results.get()).toEqual([]);
		d.destroy();
	});

	it("test 3: loads ok after never-resolve", async () => {
		const d = docIndex({ db: "/docs.db", fetch: okFetch() });
		await vi.waitFor(
			() => {
				const err = d.error.get();
				const loaded = d.loaded.get();
				if (err) throw new Error(`Load error: ${String(err)}`);
				expect(loaded).toBe(true);
			},
			{ timeout: 2000 },
		);
		d.destroy();
	});

	it("test 4: fetch error then reload", async () => {
		const d1 = docIndex({
			db: "/docs.db",
			fetch: vi
				.fn()
				.mockResolvedValue(new Response(null, { status: 404, statusText: "Not Found" })),
		});
		await vi.waitFor(() => expect(d1.error.get()).toBeDefined(), { timeout: 1000 });
		d1.destroy();

		const d2 = docIndex({ db: "/docs.db", fetch: okFetch() });
		await vi.waitFor(
			() => {
				const err = d2.error.get();
				const loaded = d2.loaded.get();
				if (err) throw new Error(`Load error: ${String(err)}`);
				expect(loaded).toBe(true);
			},
			{ timeout: 2000 },
		);
		d2.destroy();
	});
});
