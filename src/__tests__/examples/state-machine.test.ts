import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderContext } from "../../../examples/state-machine";
import { Inspector } from "../../core/inspector";
import { derived, effect } from "../../index";
import { stateMachine } from "../../utils/stateMachine";

// We recreate the state machine per test to get a fresh instance,
// since the example module is singleton (module-level side effects).

function createOrderMachine(mathRandomValue?: number) {
	const randomMock =
		mathRandomValue !== undefined
			? vi.spyOn(Math, "random").mockReturnValue(mathRandomValue)
			: undefined;

	const order = stateMachine<
		OrderContext,
		| "draft"
		| "reviewing"
		| "processing"
		| "confirmed"
		| "shipped"
		| "delivered"
		| "cancelled"
		| "error",
		"SUBMIT" | "PAY" | "SHIP" | "DELIVER" | "CANCEL" | "RETRY" | "EDIT" | "FAIL"
	>(
		{ orderId: "ORD-001", items: ["Widget A", "Gadget B"], total: 49.99, attempts: 0 },
		{
			initial: "draft",
			states: {
				draft: {
					on: {
						SUBMIT: {
							to: "reviewing",
							guard: (ctx) => ctx.items.length > 0,
						},
					},
				},
				reviewing: {
					on: {
						PAY: "processing",
						EDIT: "draft",
						CANCEL: "cancelled",
					},
				},
				processing: {
					onEnter: (ctx) => {
						const updated = { ...ctx, attempts: ctx.attempts + 1 };
						if (Math.random() < 0.2) {
							return { ...updated, error: "Payment declined" };
						}
						return updated;
					},
					on: {
						SHIP: {
							to: "confirmed",
							guard: (ctx) => !ctx.error,
							action: (ctx) => ({ ...ctx, paidAt: Date.now() }),
						},
						FAIL: {
							to: "error",
							guard: (ctx) => !!ctx.error,
						},
						CANCEL: {
							to: "cancelled",
							guard: (ctx) => !ctx.paidAt,
						},
					},
				},
				confirmed: {
					on: {
						SHIP: {
							to: "shipped",
							action: (ctx) => ({ ...ctx, shippedAt: Date.now() }),
						},
					},
				},
				shipped: {
					on: {
						DELIVER: "delivered",
					},
				},
				delivered: {},
				cancelled: {
					on: {
						RETRY: {
							to: "draft",
							guard: (ctx) => ctx.attempts < 3,
							action: (ctx) => ({ ...ctx, error: undefined }),
						},
					},
				},
				error: {
					on: {
						RETRY: {
							to: "draft",
							guard: (ctx) => ctx.attempts < 3,
							action: (ctx) => ({ ...ctx, error: undefined }),
						},
					},
				},
			},
		},
	);

	// Auto-transition: if processing sets an error, fire FAIL reactively
	const disposeEffect = effect([order.current, order.context], () => {
		const st = order.current.get();
		const ctx = order.context.get();
		if (st === "processing" && ctx.error) {
			order.send("FAIL");
		}
	});

	return { order, randomMock, disposeEffect };
}

describe("state-machine example", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("starts in draft state", () => {
		const { order } = createOrderMachine(0.5);
		expect(order.current.get()).toBe("draft");
	});

	it("transitions draft -> reviewing on SUBMIT", () => {
		const { order } = createOrderMachine(0.5);
		const accepted = order.send("SUBMIT");
		expect(accepted).toBe(true);
		expect(order.current.get()).toBe("reviewing");
	});

	it("blocks SUBMIT when items are empty", () => {
		const order = stateMachine<OrderContext, "draft" | "reviewing", "SUBMIT">(
			{ orderId: "ORD-002", items: [], total: 0, attempts: 0 },
			{
				initial: "draft",
				states: {
					draft: {
						on: {
							SUBMIT: {
								to: "reviewing",
								guard: (ctx) => ctx.items.length > 0,
							},
						},
					},
					reviewing: {},
				},
			},
		);
		const accepted = order.send("SUBMIT");
		expect(accepted).toBe(false);
		expect(order.current.get()).toBe("draft");
	});

	it("transitions reviewing -> processing on PAY, increments attempts", () => {
		const { order } = createOrderMachine(0.5); // 0.5 >= 0.2, no error
		order.send("SUBMIT");
		order.send("PAY");
		expect(order.current.get()).toBe("processing");
		expect(order.context.get().attempts).toBe(1);
	});

	it("auto-transitions to error when onEnter sets error (Math.random < 0.2)", () => {
		const { order } = createOrderMachine(0.1); // 0.1 < 0.2, triggers error
		order.send("SUBMIT");
		order.send("PAY");
		// onEnter sets error, effect fires FAIL
		expect(order.context.get().error).toBe("Payment declined");
		expect(order.current.get()).toBe("error");
	});

	it("SHIP is blocked when ctx.error is set", () => {
		const { order, randomMock } = createOrderMachine(0.1);
		order.send("SUBMIT");
		order.send("PAY");
		// Now in error state due to auto-transition. Even if we manually go back to processing:
		// The guard on SHIP checks !ctx.error, so SHIP should be rejected.
		// Let's test from processing directly without auto-transition by controlling the flow.
		randomMock?.mockRestore();

		// Create a fresh machine where we stay in processing with an error but no auto-FAIL
		const order2 = stateMachine<
			OrderContext,
			"draft" | "reviewing" | "processing" | "confirmed" | "error",
			"SUBMIT" | "PAY" | "SHIP" | "FAIL"
		>(
			{ orderId: "ORD-003", items: ["X"], total: 10, attempts: 0 },
			{
				initial: "processing",
				states: {
					draft: {},
					reviewing: {},
					processing: {
						onEnter: (ctx) => ({ ...ctx, attempts: ctx.attempts + 1, error: "Payment declined" }),
						on: {
							SHIP: {
								to: "confirmed",
								guard: (ctx) => !ctx.error,
							},
						},
					},
					confirmed: {},
					error: {},
				},
			},
		);
		// Machine starts in processing, onEnter has set error
		expect(order2.context.get().error).toBe("Payment declined");
		const accepted = order2.send("SHIP");
		expect(accepted).toBe(false);
		expect(order2.current.get()).toBe("processing");
	});

	it("RETRY from error clears error and goes to draft", () => {
		const { order } = createOrderMachine(0.1);
		order.send("SUBMIT");
		order.send("PAY");
		expect(order.current.get()).toBe("error");

		const accepted = order.send("RETRY");
		expect(accepted).toBe(true);
		expect(order.current.get()).toBe("draft");
		expect(order.context.get().error).toBeUndefined();
	});

	it("reset() returns to initial state and context", () => {
		const { order } = createOrderMachine(0.5);
		order.send("SUBMIT");
		expect(order.current.get()).toBe("reviewing");

		order.reset();
		expect(order.current.get()).toBe("draft");
		expect(order.context.get().attempts).toBe(0);
	});

	it("availableEvents derived computes correct events from current state", () => {
		const { order } = createOrderMachine(0.5);

		const availableEvents = derived(
			[order.current],
			() => {
				const current = order.current.get();
				const validEvents: string[] = [];
				for (const edge of order.transitions) {
					if (edge.from === current && !validEvents.includes(edge.event)) {
						validEvents.push(edge.event);
					}
				}
				return validEvents;
			},
			{ name: "availableEvents" },
		);

		const obs = Inspector.observe(availableEvents);

		// Initial state is "draft", so available events should be ["SUBMIT"]
		expect(availableEvents.get()).toEqual(["SUBMIT"]);

		order.send("SUBMIT");
		expect(availableEvents.get()).toEqual(expect.arrayContaining(["PAY", "EDIT", "CANCEL"]));

		obs.dispose();
	});

	it("toMermaid() returns a non-empty string", () => {
		const { order } = createOrderMachine(0.5);
		const mermaid = order.toMermaid();
		expect(typeof mermaid).toBe("string");
		expect(mermaid.length).toBeGreaterThan(0);
		expect(mermaid).toContain("draft");
	});

	it("full happy path: draft -> reviewing -> processing -> confirmed -> shipped -> delivered", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const { order } = createOrderMachine(0.5);

		order.send("SUBMIT"); // draft -> reviewing
		expect(order.current.get()).toBe("reviewing");

		order.send("PAY"); // reviewing -> processing
		expect(order.current.get()).toBe("processing");
		expect(order.context.get().attempts).toBe(1);

		order.send("SHIP"); // processing -> confirmed (guard: !ctx.error passes)
		expect(order.current.get()).toBe("confirmed");
		expect(order.context.get().paidAt).toBeDefined();

		order.send("SHIP"); // confirmed -> shipped
		expect(order.current.get()).toBe("shipped");
		expect(order.context.get().shippedAt).toBeDefined();

		order.send("DELIVER"); // shipped -> delivered
		expect(order.current.get()).toBe("delivered");
	});
});
