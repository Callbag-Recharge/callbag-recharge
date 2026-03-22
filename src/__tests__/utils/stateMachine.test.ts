import { describe, expect, it } from "vitest";
import { Inspector } from "../../core/inspector";
import { stateMachine } from "../../utils/stateMachine";

// ---------------------------------------------------------------------------
// Basic state machine tests
// ---------------------------------------------------------------------------
describe("stateMachine", () => {
	function createTrafficLight() {
		return stateMachine(
			{ count: 0 },
			{
				initial: "red" as const,
				states: {
					red: {},
					yellow: {},
					green: {},
				},
				on: {
					NEXT: (ctx, current) => {
						const order: Record<string, "red" | "yellow" | "green"> = {
							red: "green",
							green: "yellow",
							yellow: "red",
						};
						return {
							state: order[current],
							context: { count: ctx.count + 1 },
						};
					},
				} as any,
			},
		);
	}

	it("starts in the initial state", () => {
		const m = createTrafficLight();
		expect(m.current.get()).toBe("red");
		expect(m.context.get()).toEqual({ count: 0 });
	});

	it("transitions on send", () => {
		const m = createTrafficLight();
		const result = m.send("NEXT" as any);
		expect(result).toBe(true);
		expect(m.current.get()).toBe("green");
		expect(m.context.get()).toEqual({ count: 1 });
	});

	it("chains multiple transitions", () => {
		const m = createTrafficLight();
		m.send("NEXT" as any); // red → green
		m.send("NEXT" as any); // green → yellow
		m.send("NEXT" as any); // yellow → red
		expect(m.current.get()).toBe("red");
		expect(m.context.get()).toEqual({ count: 3 });
	});

	it("returns false for unknown events", () => {
		const m = createTrafficLight();
		const result = m.send("UNKNOWN" as any);
		expect(result).toBe(false);
		expect(m.current.get()).toBe("red");
	});

	it("returns false when handler rejects transition", () => {
		const m = stateMachine(
			{},
			{
				initial: "idle" as const,
				states: { idle: {}, active: {} },
				on: {
					ACTIVATE: (_ctx, current) => {
						if (current !== "idle") return false;
						return { state: "active" as const };
					},
				} as any,
			},
		);
		m.send("ACTIVATE" as any);
		expect(m.current.get()).toBe("active");
		// Now rejecting from active state
		const result = m.send("ACTIVATE" as any);
		expect(result).toBe(false);
		expect(m.current.get()).toBe("active");
	});

	it("matches checks current state", () => {
		const m = createTrafficLight();
		expect(m.matches("red")).toBe(true);
		expect(m.matches("green")).toBe(false);
		m.send("NEXT" as any);
		expect(m.matches("green")).toBe(true);
		expect(m.matches("red")).toBe(false);
	});

	it("reset returns to initial state and context", () => {
		const m = createTrafficLight();
		m.send("NEXT" as any);
		m.send("NEXT" as any);
		expect(m.current.get()).toBe("yellow");
		expect(m.context.get()).toEqual({ count: 2 });

		m.reset();
		expect(m.current.get()).toBe("red");
		expect(m.context.get()).toEqual({ count: 0 });
	});

	// ---------------------------------------------------------------------------
	// onEnter / onExit hooks
	// ---------------------------------------------------------------------------
	it("runs onExit and onEnter on transition", () => {
		const log: string[] = [];
		const m = stateMachine(
			{ value: 0 },
			{
				initial: "a" as const,
				states: {
					a: {
						onExit: (ctx) => {
							log.push("exit-a");
							return { value: ctx.value + 10 };
						},
					},
					b: {
						onEnter: (ctx) => {
							log.push("enter-b");
							return { value: ctx.value + 100 };
						},
					},
				},
				on: {
					GO: () => ({ state: "b" as const }),
				} as any,
			},
		);

		m.send("GO" as any);
		expect(log).toEqual(["exit-a", "enter-b"]);
		expect(m.context.get()).toEqual({ value: 110 });
	});

	it("onEnter/onExit can return void (no context change)", () => {
		const log: string[] = [];
		const m = stateMachine(
			{ x: 1 },
			{
				initial: "a" as const,
				states: {
					a: {
						onExit: () => {
							log.push("exit");
						},
					},
					b: {
						onEnter: () => {
							log.push("enter");
						},
					},
				},
				on: {
					GO: () => ({ state: "b" as const }),
				} as any,
			},
		);

		m.send("GO" as any);
		expect(log).toEqual(["exit", "enter"]);
		// Context unchanged since hooks returned void
		expect(m.context.get()).toEqual({ x: 1 });
	});

	it("transition can update context without onEnter/onExit", () => {
		const m = stateMachine(
			{ text: "" },
			{
				initial: "idle" as const,
				states: { idle: {}, editing: {} },
				on: {
					EDIT: () => ({
						state: "editing" as const,
						context: { text: "hello" },
					}),
				} as any,
			},
		);

		m.send("EDIT" as any);
		expect(m.current.get()).toBe("editing");
		expect(m.context.get()).toEqual({ text: "hello" });
	});

	it("reset runs onExit for current state and onEnter for initial state", () => {
		const log: string[] = [];
		const m = stateMachine(
			{},
			{
				initial: "a" as const,
				states: {
					a: {
						onEnter: () => {
							log.push("enter-a");
						},
					},
					b: {
						onExit: () => {
							log.push("exit-b");
						},
					},
				},
				on: {
					GO: () => ({ state: "b" as const }),
				} as any,
			},
		);

		m.send("GO" as any);
		log.length = 0;

		m.reset();
		expect(log).toEqual(["exit-b", "enter-a"]);
		expect(m.current.get()).toBe("a");
	});

	it("current and context are reactive stores", () => {
		const m = createTrafficLight();

		// Subscribe to current store
		const obs = Inspector.observe(m.current);

		m.send("NEXT" as any); // red → green
		m.send("NEXT" as any); // green → yellow

		expect(obs.values).toEqual(["green", "yellow"]);

		obs.dispose();
	});
});
