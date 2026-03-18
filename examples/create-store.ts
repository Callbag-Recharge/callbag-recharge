/**
 * createStore — Zustand-compatible API with diamond-safe selectors
 *
 * Shows how createStore gives you Zustand's familiar API backed by
 * callbag-recharge's reactive graph. Selectors are derived stores
 * with automatic push-phase memoization.
 *
 * Run: npx tsx examples/create-store.ts
 */
import { effect } from "callbag-recharge";
import { subscribe } from "callbag-recharge/extra";
import { batch, createStore } from "callbag-recharge/patterns/createStore";

// ── Create a store ─────────────────────────────────────────

interface Todo {
	text: string;
	done: boolean;
}

const store = createStore((set, _get) => ({
	// State
	count: 0,
	todos: [] as Todo[],

	// Actions — just functions that call set()
	increment: () => set((s) => ({ count: s.count + 1 })),
	decrement: () => set((s) => ({ count: s.count - 1 })),
	addTodo: (text: string) => set((s) => ({ todos: [...s.todos, { text, done: false }] })),
	toggleTodo: (i: number) =>
		set((s) => ({
			todos: s.todos.map((t, idx) => (idx === i ? { ...t, done: !t.done } : t)),
		})),
}));

// ── Selectors — the killer feature ─────────────────────────

// Each select() returns a reactive Store backed by derived()
const count = store.select((s) => s.count);
const todoCount = store.select((s) => s.todos.length);
const doneCount = store.select((s) => s.todos.filter((t) => t.done).length);

// ── React to changes ───────────────────────────────────────

effect([count], () => {
	console.log("Count:", count.get());
});

const unsub = subscribe(todoCount, (n) => {
	console.log("Todos:", n, "| Done:", doneCount.get());
});

// ── Use it ─────────────────────────────────────────────────

store.getState().increment(); // → Count: 1
store.getState().increment(); // → Count: 2

store.getState().addTodo("Learn callbag-recharge"); // → Todos: 1 | Done: 0
store.getState().addTodo("Build something cool"); // → Todos: 2 | Done: 0

// toggleTodo changes doneCount but NOT todoCount → subscribe doesn't fire
// This is push-phase memoization: todoCount selector stays at 2, no recompute
store.getState().toggleTodo(0); // (silent — todoCount unchanged)

// Batching — multiple updates, single notification
batch(() => {
	store.getState().increment();
	store.getState().addTodo("Ship it");
});
// → Count: 3    (fires once, not twice)
// → Todos: 3 | Done: 1  (fires once)

// Cleanup
unsub();
store.destroy();
console.log("--- done ---");
