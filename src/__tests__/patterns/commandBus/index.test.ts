import { describe, expect, it } from "vitest";
import type { CommandDef } from "../../../patterns/commandBus";
import { commandBus } from "../../../patterns/commandBus";

describe("commandBus", () => {
	// -----------------------------------------------------------------------
	// Basic dispatch
	// -----------------------------------------------------------------------

	it("dispatches a command and executes it", () => {
		let value = 0;
		const bus = commandBus({
			add: {
				execute: (n: number) => {
					value += n;
				},
			},
		});

		bus.dispatch("add", 5);
		expect(value).toBe(5);
	});

	it("throws on unknown command", () => {
		const bus = commandBus({
			noop: { execute: () => {} },
		});

		expect(() => (bus as any).dispatch("unknown")).toThrow("Unknown command");
	});

	it("supports void args (no-arg dispatch)", () => {
		let called = false;
		const bus = commandBus({
			reset: {
				execute: () => {
					called = true;
				},
			} as CommandDef,
		});

		bus.dispatch("reset");
		expect(called).toBe(true);
	});

	// -----------------------------------------------------------------------
	// lastCommand
	// -----------------------------------------------------------------------

	it("lastCommand tracks the most recent dispatch", () => {
		const bus = commandBus({
			a: { execute: (_n: number) => {} },
			b: { execute: (_s: string) => {} },
		});

		expect(bus.lastCommand.get()).toBeNull();

		bus.dispatch("a", 42);
		expect(bus.lastCommand.get()?.name).toBe("a");
		expect(bus.lastCommand.get()?.args).toBe(42);

		bus.dispatch("b", "hello");
		expect(bus.lastCommand.get()?.name).toBe("b");
		expect(bus.lastCommand.get()?.args).toBe("hello");
	});

	// -----------------------------------------------------------------------
	// Undo / Redo
	// -----------------------------------------------------------------------

	it("undo reverses command with undo method", () => {
		let value = 0;
		const bus = commandBus({
			add: {
				execute: (n: number) => {
					value += n;
				},
				undo: (n: number) => {
					value -= n;
				},
			},
		});

		bus.dispatch("add", 10);
		expect(value).toBe(10);

		expect(bus.undo()).toBe(true);
		expect(value).toBe(0);
	});

	it("redo re-executes undone command", () => {
		let value = 0;
		const bus = commandBus({
			add: {
				execute: (n: number) => {
					value += n;
				},
				undo: (n: number) => {
					value -= n;
				},
			},
		});

		bus.dispatch("add", 10);
		bus.undo();
		expect(value).toBe(0);

		expect(bus.redo()).toBe(true);
		expect(value).toBe(10);
	});

	it("undo returns false when stack is empty", () => {
		const bus = commandBus({
			a: { execute: () => {}, undo: () => {} },
		});
		expect(bus.undo()).toBe(false);
	});

	it("redo returns false when stack is empty", () => {
		const bus = commandBus({
			a: { execute: () => {}, undo: () => {} },
		});
		expect(bus.redo()).toBe(false);
	});

	it("canUndo/canRedo are reactive", () => {
		const bus = commandBus({
			a: { execute: () => {}, undo: () => {} } as CommandDef,
		});

		expect(bus.canUndo.get()).toBe(false);
		expect(bus.canRedo.get()).toBe(false);

		bus.dispatch("a");
		expect(bus.canUndo.get()).toBe(true);
		expect(bus.canRedo.get()).toBe(false);

		bus.undo();
		expect(bus.canUndo.get()).toBe(false);
		expect(bus.canRedo.get()).toBe(true);

		bus.redo();
		expect(bus.canUndo.get()).toBe(true);
		expect(bus.canRedo.get()).toBe(false);
	});

	it("new dispatch clears redo stack", () => {
		let _value = 0;
		const bus = commandBus({
			set: {
				execute: (n: number) => {
					_value = n;
				},
				undo: () => {
					_value = 0;
				},
			},
		});

		bus.dispatch("set", 1);
		bus.dispatch("set", 2);
		bus.undo(); // back to set(1)
		expect(bus.canRedo.get()).toBe(true);

		bus.dispatch("set", 3); // clears redo
		expect(bus.canRedo.get()).toBe(false);
	});

	it("commands without undo do not enter history", () => {
		const bus = commandBus({
			noUndo: { execute: () => {} },
		});

		bus.dispatch("noUndo");
		expect(bus.canUndo.get()).toBe(false);
	});

	// -----------------------------------------------------------------------
	// maxHistory
	// -----------------------------------------------------------------------

	it("maxHistory caps undo stack", () => {
		let _value = 0;
		const bus = commandBus(
			{
				add: {
					execute: (n: number) => {
						_value += n;
					},
					undo: (n: number) => {
						_value -= n;
					},
				},
			},
			{ maxHistory: 3 },
		);

		bus.dispatch("add", 1);
		bus.dispatch("add", 2);
		bus.dispatch("add", 3);
		bus.dispatch("add", 4); // oldest (1) dropped

		let undoCount = 0;
		while (bus.undo() === true) undoCount++;

		expect(undoCount).toBe(3);
	});

	it("maxHistory 0 disables undo", () => {
		const bus = commandBus(
			{ a: { execute: () => {}, undo: () => {} } as CommandDef },
			{ maxHistory: 0 },
		);

		bus.dispatch("a");
		expect(bus.canUndo.get()).toBe(false);
	});

	// -----------------------------------------------------------------------
	// Middleware
	// -----------------------------------------------------------------------

	it("middleware intercepts dispatch", () => {
		const log: string[] = [];
		let value = 0;

		const bus = commandBus(
			{
				add: {
					execute: (n: number) => {
						value += n;
					},
				},
			},
			{
				middleware: [
					(name, _args, next) => {
						log.push(`before:${name}`);
						const result = next();
						log.push(`after:${name}`);
						return result;
					},
				],
			},
		);

		bus.dispatch("add", 5);
		expect(log).toEqual(["before:add", "after:add"]);
		expect(value).toBe(5);
	});

	it("multiple middleware execute in order", () => {
		const order: number[] = [];

		const bus = commandBus(
			{ a: { execute: () => {} } as CommandDef },
			{
				middleware: [
					(_n, _a, next) => {
						order.push(1);
						return next();
					},
					(_n, _a, next) => {
						order.push(2);
						return next();
					},
					(_n, _a, next) => {
						order.push(3);
						return next();
					},
				],
			},
		);

		bus.dispatch("a");
		expect(order).toEqual([1, 2, 3]);
	});

	it("redo routes through middleware", () => {
		const log: string[] = [];
		let value = 0;

		const bus = commandBus(
			{
				add: {
					execute: (n: number) => {
						value += n;
					},
					undo: (n: number) => {
						value -= n;
					},
				},
			},
			{
				middleware: [
					(name, _args, next) => {
						log.push(`mw:${name}`);
						return next();
					},
				],
			},
		);

		bus.dispatch("add", 5);
		bus.undo();
		log.length = 0; // clear log from dispatch

		bus.redo();
		expect(log).toEqual(["mw:add"]); // middleware was called
		expect(value).toBe(5);
	});

	it("redo updates lastCommand", () => {
		const bus = commandBus({
			a: { execute: () => {}, undo: () => {} } as CommandDef,
		});

		bus.dispatch("a");
		bus.undo();
		bus.redo();
		expect(bus.lastCommand.get()?.name).toBe("a");
	});

	// -----------------------------------------------------------------------
	// Exception-safe listeners
	// -----------------------------------------------------------------------

	it("throwing listener does not block other listeners", () => {
		const received: number[] = [];
		const bus = commandBus({
			add: { execute: (_n: number) => {} },
		});

		bus.on("add", () => {
			throw new Error("boom");
		});
		bus.on("add", (n) => received.push(n));

		bus.dispatch("add", 42);
		expect(received).toEqual([42]); // second listener still fired
	});

	// -----------------------------------------------------------------------
	// on() — command listeners
	// -----------------------------------------------------------------------

	it("on() subscribes to command executions", () => {
		const received: number[] = [];
		const bus = commandBus({
			add: { execute: (_n: number) => {} },
		});

		const unsub = bus.on("add", (n) => received.push(n));

		bus.dispatch("add", 1);
		bus.dispatch("add", 2);

		expect(received).toEqual([1, 2]);

		unsub();
		bus.dispatch("add", 3);
		expect(received).toEqual([1, 2]); // unsubscribed
	});

	// -----------------------------------------------------------------------
	// Dispose
	// -----------------------------------------------------------------------

	it("dispose prevents further dispatches", () => {
		let value = 0;
		const bus = commandBus({
			add: {
				execute: (n: number) => {
					value += n;
				},
			},
		});

		bus.dispatch("add", 5);
		bus.dispose();
		bus.dispatch("add", 10); // no-op

		expect(value).toBe(5);
	});

	it("dispose clears undo/redo stacks", () => {
		const bus = commandBus({
			a: { execute: () => {}, undo: () => {} } as CommandDef,
		});

		bus.dispatch("a");
		bus.dispose();

		expect(bus.canUndo.get()).toBe(false);
		expect(bus.canRedo.get()).toBe(false);
	});
});
