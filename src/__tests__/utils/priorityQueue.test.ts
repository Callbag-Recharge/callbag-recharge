import { describe, expect, it } from "vitest";
import { priorityQueue } from "../../utils/priorityQueue";

describe("priorityQueue", () => {
	// --- Happy path ---

	it("extracts items in priority order (min-heap)", () => {
		const pq = priorityQueue<number>((a, b) => a - b);
		pq.push(5);
		pq.push(1);
		pq.push(3);
		pq.push(2);
		pq.push(4);

		expect(pq.poll()).toBe(1);
		expect(pq.poll()).toBe(2);
		expect(pq.poll()).toBe(3);
		expect(pq.poll()).toBe(4);
		expect(pq.poll()).toBe(5);
	});

	it("peek returns min without removing", () => {
		const pq = priorityQueue<number>((a, b) => a - b);
		pq.push(3);
		pq.push(1);
		expect(pq.peek()).toBe(1);
		expect(pq.size).toBe(2);
	});

	it("poll returns undefined when empty", () => {
		const pq = priorityQueue<number>((a, b) => a - b);
		expect(pq.poll()).toBeUndefined();
	});

	it("peek returns undefined when empty", () => {
		const pq = priorityQueue<number>((a, b) => a - b);
		expect(pq.peek()).toBeUndefined();
	});

	it("tracks size and isEmpty", () => {
		const pq = priorityQueue<number>((a, b) => a - b);
		expect(pq.size).toBe(0);
		expect(pq.isEmpty).toBe(true);

		pq.push(1);
		expect(pq.size).toBe(1);
		expect(pq.isEmpty).toBe(false);

		pq.poll();
		expect(pq.size).toBe(0);
		expect(pq.isEmpty).toBe(true);
	});

	it("drain returns all items in priority order and empties queue", () => {
		const pq = priorityQueue<number>((a, b) => a - b);
		pq.push(4);
		pq.push(1);
		pq.push(3);
		pq.push(2);

		expect(pq.drain()).toEqual([1, 2, 3, 4]);
		expect(pq.isEmpty).toBe(true);
	});

	it("clear removes all items", () => {
		const pq = priorityQueue<number>((a, b) => a - b);
		pq.push(1);
		pq.push(2);
		pq.push(3);
		pq.clear();
		expect(pq.size).toBe(0);
		expect(pq.poll()).toBeUndefined();
	});

	// --- Custom comparator ---

	it("works as max-heap with reversed comparator", () => {
		const pq = priorityQueue<number>((a, b) => b - a);
		pq.push(1);
		pq.push(5);
		pq.push(3);

		expect(pq.poll()).toBe(5);
		expect(pq.poll()).toBe(3);
		expect(pq.poll()).toBe(1);
	});

	it("works with object comparator (priority field)", () => {
		interface Task {
			name: string;
			priority: number;
		}
		const pq = priorityQueue<Task>((a, b) => a.priority - b.priority);
		pq.push({ name: "low", priority: 10 });
		pq.push({ name: "high", priority: 1 });
		pq.push({ name: "mid", priority: 5 });

		expect(pq.poll()!.name).toBe("high");
		expect(pq.poll()!.name).toBe("mid");
		expect(pq.poll()!.name).toBe("low");
	});

	// --- Edge cases ---

	it("handles duplicate values", () => {
		const pq = priorityQueue<number>((a, b) => a - b);
		pq.push(2);
		pq.push(2);
		pq.push(1);
		pq.push(2);

		expect(pq.drain()).toEqual([1, 2, 2, 2]);
	});

	it("handles single element", () => {
		const pq = priorityQueue<number>((a, b) => a - b);
		pq.push(42);
		expect(pq.peek()).toBe(42);
		expect(pq.poll()).toBe(42);
		expect(pq.isEmpty).toBe(true);
	});

	it("handles interleaved push and poll", () => {
		const pq = priorityQueue<number>((a, b) => a - b);
		pq.push(5);
		pq.push(3);
		expect(pq.poll()).toBe(3);
		pq.push(1);
		pq.push(4);
		expect(pq.poll()).toBe(1);
		expect(pq.poll()).toBe(4);
		expect(pq.poll()).toBe(5);
	});

	it("handles large number of items", () => {
		const pq = priorityQueue<number>((a, b) => a - b);
		const n = 1000;
		const shuffled = Array.from({ length: n }, (_, i) => i).sort(() => Math.random() - 0.5);
		for (const v of shuffled) pq.push(v);

		const result = pq.drain();
		expect(result).toEqual(Array.from({ length: n }, (_, i) => i));
	});

	it("drain works when destructured (no this-binding issue)", () => {
		const pq = priorityQueue<number>((a, b) => a - b);
		pq.push(3);
		pq.push(1);
		pq.push(2);
		const { drain } = pq;
		expect(drain()).toEqual([1, 2, 3]);
	});

	it("drain on empty queue returns empty array", () => {
		const pq = priorityQueue<number>((a, b) => a - b);
		expect(pq.drain()).toEqual([]);
	});
});
