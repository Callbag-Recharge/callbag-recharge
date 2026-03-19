import { describe, expect, it, vi } from "vitest";
import { pagination } from "../../../patterns/pagination";

// Helper: mock fetch that returns items for a given page
function mockFetch(totalItems: number, pageSize: number) {
	return async (page: number, _signal: AbortSignal): Promise<number[]> => {
		const start = (page - 1) * pageSize;
		const end = Math.min(start + pageSize, totalItems);
		const items: number[] = [];
		for (let i = start; i < end; i++) {
			items.push(i);
		}
		return items;
	};
}

// Helper: delayed mock fetch
function delayedFetch(totalItems: number, pageSize: number, delayMs: number) {
	return async (page: number, signal: AbortSignal): Promise<number[]> => {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(resolve, delayMs);
			signal.addEventListener("abort", () => {
				clearTimeout(timer);
				reject(new DOMException("Aborted", "AbortError"));
			});
		});
		const start = (page - 1) * pageSize;
		const end = Math.min(start + pageSize, totalItems);
		const items: number[] = [];
		for (let i = start; i < end; i++) {
			items.push(i);
		}
		return items;
	};
}

describe("pagination", () => {
	// -----------------------------------------------------------------------
	// Initial fetch (fires automatically on construction)
	// -----------------------------------------------------------------------

	it("auto-fetches initial page on construction", async () => {
		const p = pagination({
			fetch: mockFetch(20, 5),
			pageSize: 5,
		});

		await vi.waitFor(() => {
			expect(p.data.get()).toEqual([0, 1, 2, 3, 4]);
		});
		expect(p.page.get()).toBe(1);
	});

	// -----------------------------------------------------------------------
	// Navigation
	// -----------------------------------------------------------------------

	it("next navigates to the next page", async () => {
		const p = pagination({
			fetch: mockFetch(20, 5),
			pageSize: 5,
		});

		await vi.waitFor(() => {
			expect(p.data.get()).toHaveLength(5);
		});

		p.next();
		await vi.waitFor(() => {
			expect(p.data.get()).toEqual([5, 6, 7, 8, 9]);
		});
		expect(p.page.get()).toBe(2);
	});

	it("prev navigates to the previous page", async () => {
		const p = pagination({
			fetch: mockFetch(20, 5),
			pageSize: 5,
			initialPage: 2,
		});

		await vi.waitFor(() => {
			expect(p.data.get()).toEqual([5, 6, 7, 8, 9]);
		});

		p.prev();
		await vi.waitFor(() => {
			expect(p.data.get()).toEqual([0, 1, 2, 3, 4]);
		});
		expect(p.page.get()).toBe(1);
	});

	it("prev does nothing on page 1", async () => {
		const p = pagination({
			fetch: mockFetch(20, 5),
			pageSize: 5,
		});

		await vi.waitFor(() => {
			expect(p.data.get()).toHaveLength(5);
		});

		p.prev();
		expect(p.page.get()).toBe(1);
	});

	it("goTo specific page", async () => {
		const p = pagination({
			fetch: mockFetch(20, 5),
			pageSize: 5,
		});

		p.goTo(3);
		await vi.waitFor(() => {
			expect(p.data.get()).toEqual([10, 11, 12, 13, 14]);
		});
		expect(p.page.get()).toBe(3);
	});

	it("goTo rejects invalid page numbers", async () => {
		const p = pagination({
			fetch: mockFetch(20, 5),
			pageSize: 5,
		});

		await vi.waitFor(() => {
			expect(p.data.get()).toHaveLength(5);
		});

		p.goTo(0);
		p.goTo(-1);
		p.goTo(Number.NaN);
		// Page should still be 1
		expect(p.page.get()).toBe(1);
	});

	// -----------------------------------------------------------------------
	// hasNext / hasPrev
	// -----------------------------------------------------------------------

	it("hasNext is false when fewer than pageSize items returned", async () => {
		const p = pagination({
			fetch: mockFetch(7, 5),
			pageSize: 5,
		});

		await vi.waitFor(() => {
			expect(p.hasNext.get()).toBe(true); // 5 items returned
		});

		p.next();
		await vi.waitFor(() => {
			expect(p.hasNext.get()).toBe(false); // 2 items returned
		});
	});

	it("next is guarded by hasNext", async () => {
		const p = pagination({
			fetch: mockFetch(3, 5),
			pageSize: 5,
		});

		await vi.waitFor(() => {
			expect(p.data.get()).toEqual([0, 1, 2]);
		});
		expect(p.hasNext.get()).toBe(false);

		p.next(); // should be no-op since hasNext is false
		await new Promise((r) => setTimeout(r, 20));
		expect(p.page.get()).toBe(1); // still on page 1
	});

	it("hasPrev is false on page 1", async () => {
		const p = pagination({
			fetch: mockFetch(20, 5),
			pageSize: 5,
		});

		await vi.waitFor(() => {
			expect(p.data.get()).toHaveLength(5);
		});
		expect(p.hasPrev.get()).toBe(false);

		p.next();
		await vi.waitFor(() => {
			expect(p.hasPrev.get()).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Loading state
	// -----------------------------------------------------------------------

	it("loading state tracks fetch in progress", async () => {
		const p = pagination({
			fetch: delayedFetch(20, 5, 50),
			pageSize: 5,
		});

		// Initial fetch is in progress
		expect(p.loading.get()).toBe(true);

		await vi.waitFor(() => {
			expect(p.loading.get()).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	it("error state is set on fetch failure", async () => {
		let callCount = 0;
		const p = pagination({
			fetch: async () => {
				callCount++;
				if (callCount > 1) throw new Error("network error");
				return [1, 2, 3];
			},
			pageSize: 5,
		});

		// Initial fetch succeeds
		await vi.waitFor(() => {
			expect(p.data.get()).toHaveLength(3);
		});

		// Second fetch fails
		p.goTo(2);
		await vi.waitFor(() => {
			expect(p.error.get()).toBeInstanceOf(Error);
		});
	});

	// -----------------------------------------------------------------------
	// Refresh
	// -----------------------------------------------------------------------

	it("refresh re-fetches the current page", async () => {
		let callCount = 0;
		const p = pagination({
			fetch: async (_page, _signal) => {
				callCount++;
				return [callCount * 10];
			},
			pageSize: 5,
		});

		await vi.waitFor(() => {
			expect(p.data.get()).toHaveLength(1);
		});
		const firstData = [...p.data.get()];

		p.refresh();
		await vi.waitFor(() => {
			expect(p.data.get()).not.toEqual(firstData);
		});
		expect(p.page.get()).toBe(1);
	});
});
