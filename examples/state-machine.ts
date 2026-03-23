/**
 * State Machine — Order workflow with typed transitions and graph visualization
 *
 * Demonstrates: stateMachine with declarative transitions, guards, actions,
 * onEnter/onExit hooks, toMermaid() diagram export.
 */

import { derived } from "callbag-recharge";
import { stateMachine } from "callbag-recharge/utils/stateMachine";

// #region display

// ── Types ────────────────────────────────────────────────────

export interface OrderContext {
	orderId: string;
	items: string[];
	total: number;
	attempts: number;
	paidAt?: number;
	shippedAt?: number;
	error?: string;
}

type OrderState =
	| "draft"
	| "reviewing"
	| "processing"
	| "confirmed"
	| "shipped"
	| "delivered"
	| "cancelled"
	| "error";
type OrderEvent = "SUBMIT" | "PAY" | "SHIP" | "DELIVER" | "CANCEL" | "RETRY" | "EDIT";

// ── State machine ────────────────────────────────────────────

export const order = stateMachine<OrderContext, OrderState, OrderEvent>(
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
				onEnter: (ctx) => ({ ...ctx, attempts: ctx.attempts + 1 }),
				on: {
					SHIP: {
						to: "confirmed",
						action: (ctx) => ({ ...ctx, paidAt: Date.now() }),
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

// ── Derived views ────────────────────────────────────────────

export const currentState = order.current;
export const orderContext = order.context;
export const transitions = order.transitions;

/** Events valid from the current state */
export const availableEvents = derived(
	[order.current],
	() => {
		const current = order.current.get();
		const validEvents: OrderEvent[] = [];
		for (const edge of order.transitions) {
			if (edge.from === current && !validEvents.includes(edge.event)) {
				validEvents.push(edge.event);
			}
		}
		return validEvents;
	},
	{ name: "availableEvents" },
);

export const mermaidDiagram = order.toMermaid();

// #endregion display
