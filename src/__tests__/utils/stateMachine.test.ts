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
					red: {
						on: {
							NEXT: {
								to: "green" as const,
								action: (ctx) => ({ count: ctx.count + 1 }),
							},
						},
					},
					yellow: {
						on: {
							NEXT: {
								to: "red" as const,
								action: (ctx) => ({ count: ctx.count + 1 }),
							},
						},
					},
					green: {
						on: {
							NEXT: {
								to: "yellow" as const,
								action: (ctx) => ({ count: ctx.count + 1 }),
							},
						},
					},
				},
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

	it("returns false when event not defined for current state", () => {
		const m = stateMachine(
			{},
			{
				initial: "idle" as const,
				states: {
					idle: {
						on: { ACTIVATE: "active" as const },
					},
					active: {
						// No ACTIVATE event defined here — can't re-activate
					},
				},
			},
		);
		m.send("ACTIVATE" as any);
		expect(m.current.get()).toBe("active");
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
	// String shorthand transitions
	// ---------------------------------------------------------------------------
	it("supports string shorthand for transitions", () => {
		const m = stateMachine(
			{},
			{
				initial: "off" as const,
				states: {
					off: { on: { TOGGLE: "on" as const } },
					on: { on: { TOGGLE: "off" as const } },
				},
			},
		);
		expect(m.current.get()).toBe("off");
		m.send("TOGGLE" as any);
		expect(m.current.get()).toBe("on");
		m.send("TOGGLE" as any);
		expect(m.current.get()).toBe("off");
	});

	// ---------------------------------------------------------------------------
	// Guard support
	// ---------------------------------------------------------------------------
	it("guard rejects transition when returning false", () => {
		const m = stateMachine(
			{ attempts: 0 },
			{
				initial: "idle" as const,
				states: {
					idle: {
						on: {
							TRY: {
								to: "active" as const,
								guard: (ctx) => ctx.attempts < 2,
								action: (ctx) => ({ attempts: ctx.attempts + 1 }),
							},
						},
					},
					active: {
						on: { DONE: "idle" as const },
					},
				},
			},
		);

		expect(m.send("TRY" as any)).toBe(true); // attempts: 1
		m.send("DONE" as any);
		expect(m.send("TRY" as any)).toBe(true); // attempts: 2
		m.send("DONE" as any);
		expect(m.send("TRY" as any)).toBe(false); // guard rejects
		expect(m.current.get()).toBe("idle");
	});

	// ---------------------------------------------------------------------------
	// Array of guarded alternatives
	// ---------------------------------------------------------------------------
	it("supports array of guarded alternatives (first match wins)", () => {
		const m = stateMachine(
			{ isPremium: false },
			{
				initial: "idle" as const,
				states: {
					idle: {
						on: {
							SUBMIT: [
								{ to: "premium" as const, guard: (ctx) => ctx.isPremium },
								{ to: "standard" as const },
							],
						},
					},
					premium: {},
					standard: {},
				},
			},
		);

		m.send("SUBMIT" as any);
		expect(m.current.get()).toBe("standard");

		// Reset and try with premium
		const m2 = stateMachine(
			{ isPremium: true },
			{
				initial: "idle" as const,
				states: {
					idle: {
						on: {
							SUBMIT: [
								{ to: "premium" as const, guard: (ctx) => ctx.isPremium },
								{ to: "standard" as const },
							],
						},
					},
					premium: {},
					standard: {},
				},
			},
		);

		m2.send("SUBMIT" as any);
		expect(m2.current.get()).toBe("premium");
	});

	// ---------------------------------------------------------------------------
	// Payload support
	// ---------------------------------------------------------------------------
	it("passes payload to guard and action", () => {
		const m = stateMachine(
			{ value: "" },
			{
				initial: "idle" as const,
				states: {
					idle: {
						on: {
							SET: {
								to: "done" as const,
								guard: (_ctx, payload) => typeof payload === "string",
								action: (_ctx, payload) => ({ value: payload }),
							},
						},
					},
					done: {},
				},
			},
		);

		expect(m.send("SET" as any, 42)).toBe(false); // guard rejects
		expect(m.send("SET" as any, "hello")).toBe(true);
		expect(m.context.get()).toEqual({ value: "hello" });
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
						on: { GO: "b" as const },
					},
					b: {
						onEnter: (ctx) => {
							log.push("enter-b");
							return { value: ctx.value + 100 };
						},
					},
				},
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
						on: { GO: "b" as const },
					},
					b: {
						onEnter: () => {
							log.push("enter");
						},
					},
				},
			},
		);

		m.send("GO" as any);
		expect(log).toEqual(["exit", "enter"]);
		expect(m.context.get()).toEqual({ x: 1 });
	});

	it("action updates context without onEnter/onExit", () => {
		const m = stateMachine(
			{ text: "" },
			{
				initial: "idle" as const,
				states: {
					idle: {
						on: {
							EDIT: {
								to: "editing" as const,
								action: () => ({ text: "hello" }),
							},
						},
					},
					editing: {},
				},
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
						on: { GO: "b" as const },
					},
					b: {
						onExit: () => {
							log.push("exit-b");
						},
					},
				},
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

		const obs = Inspector.observe(m.current);

		m.send("NEXT" as any); // red → green
		m.send("NEXT" as any); // green → yellow

		expect(obs.values).toEqual(["green", "yellow"]);

		obs.dispose();
	});

	// ---------------------------------------------------------------------------
	// transitions — extracted graph edges
	// ---------------------------------------------------------------------------
	it("transitions returns all edges", () => {
		const m = stateMachine(
			{},
			{
				initial: "a" as const,
				states: {
					a: { on: { GO: "b" as const } },
					b: {
						on: {
							BACK: "a" as const,
							NEXT: {
								to: "c" as const,
								guard: () => true,
							},
						},
					},
					c: {},
				},
			},
		);

		expect(m.transitions).toEqual([
			{ from: "a", event: "GO", to: "b", guarded: false },
			{ from: "b", event: "BACK", to: "a", guarded: false },
			{ from: "b", event: "NEXT", to: "c", guarded: true },
		]);
	});

	// ---------------------------------------------------------------------------
	// toMermaid
	// ---------------------------------------------------------------------------
	it("toMermaid produces valid diagram", () => {
		const m = stateMachine(
			{},
			{
				initial: "idle" as const,
				states: {
					idle: { on: { START: "running" as const } },
					running: { on: { STOP: "idle" as const } },
				},
			},
		);

		const diagram = m.toMermaid();
		expect(diagram).toContain("stateDiagram-v2");
		expect(diagram).toContain("[*] --> idle");
		expect(diagram).toContain("idle --> running : START");
		expect(diagram).toContain("running --> idle : STOP");
	});

	it("toMermaid marks guarded transitions", () => {
		const m = stateMachine(
			{},
			{
				initial: "a" as const,
				states: {
					a: {
						on: {
							GO: { to: "b" as const, guard: () => true },
						},
					},
					b: {},
				},
			},
		);

		expect(m.toMermaid()).toContain("GO [guarded]");
	});

	// ---------------------------------------------------------------------------
	// toD2
	// ---------------------------------------------------------------------------
	it("toD2 produces valid diagram", () => {
		const m = stateMachine(
			{},
			{
				initial: "idle" as const,
				states: {
					idle: { on: { START: "running" as const } },
					running: { on: { STOP: "idle" as const } },
				},
			},
		);

		const diagram = m.toD2();
		expect(diagram).toContain('idle: "idle (initial)"');
		expect(diagram).toContain("idle -> running: START");
		expect(diagram).toContain("running -> idle: STOP");
	});
});
