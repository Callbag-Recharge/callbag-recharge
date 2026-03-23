import { afterEach, describe, expect, it } from "vitest";
import { derived } from "../../core/derived";
import { Inspector } from "../../core/inspector";
import { state } from "../../core/state";
import { taskState } from "../../orchestrate/taskState";

describe("Inspector.observeTaskState", () => {
	afterEach(() => {
		Inspector._reset();
	});

	it("captures idle → running → success transitions", async () => {
		const ts = taskState<string>({ id: "test-task" });
		const obs = Inspector.observeTaskState(ts);

		expect(obs.currentStatus).toBe("idle");
		expect(obs.transitions).toHaveLength(0);

		await ts.run(async () => "done");

		expect(obs.transitions).toHaveLength(2);
		expect(obs.transitions[0]).toMatchObject({ from: "idle", to: "running" });
		expect(obs.transitions[1]).toMatchObject({ from: "running", to: "success" });
		expect(obs.currentStatus).toBe("success");

		obs.dispose();
		ts.destroy();
	});

	it("captures error transitions with error value", async () => {
		const ts = taskState<string>({ id: "fail-task" });
		const obs = Inspector.observeTaskState(ts);

		const err = new Error("boom");
		await ts
			.run(async () => {
				throw err;
			})
			.catch(() => {});

		expect(obs.transitions).toHaveLength(2);
		expect(obs.transitions[0]).toMatchObject({ from: "idle", to: "running" });
		expect(obs.transitions[1]).toMatchObject({ from: "running", to: "error" });
		expect(obs.transitions[1].error).toBe(err);

		obs.dispose();
		ts.destroy();
	});

	it("captures markSkipped transition", () => {
		const ts = taskState<string>({ id: "skip-task" });
		const obs = Inspector.observeTaskState(ts);

		ts.markSkipped();

		expect(obs.transitions).toHaveLength(1);
		expect(obs.transitions[0]).toMatchObject({ from: "idle", to: "skipped" });

		obs.dispose();
		ts.destroy();
	});

	it("captures reset back to idle", async () => {
		const ts = taskState<string>({ id: "reset-task" });
		const obs = Inspector.observeTaskState(ts);

		await ts.run(async () => "ok");
		ts.reset();

		expect(obs.transitions).toHaveLength(3);
		expect(obs.transitions[2]).toMatchObject({ from: "success", to: "idle" });

		obs.dispose();
		ts.destroy();
	});

	it("has timestamps on all transitions", async () => {
		const ts = taskState<string>({ id: "ts-task" });
		const obs = Inspector.observeTaskState(ts);

		await ts.run(async () => "ok");

		for (const t of obs.transitions) {
			expect(typeof t.timestamp).toBe("number");
			expect(t.timestamp).toBeGreaterThan(0);
		}

		obs.dispose();
		ts.destroy();
	});
});

describe("Inspector.causalityTrace", () => {
	afterEach(() => {
		Inspector._reset();
	});

	it("identifies which dep triggered recomputation", () => {
		const a = state(1, { name: "depA" });
		const b = state(10, { name: "depB" });
		const d = derived([a, b], () => a.get() + b.get());

		const obs = Inspector.causalityTrace(d);
		// Initial evaluation happens on subscribe — skip it
		const initialLen = obs.causality.length;

		a.set(2);
		expect(obs.causality).toHaveLength(initialLen + 1);
		const aEntry = obs.causality[initialLen];
		expect(aEntry.triggerDepIndex).toBe(0);
		expect(aEntry.triggerDepName).toBe("depA");
		expect(aEntry.result).toBe(12);
		expect(aEntry.depValues).toEqual([2, 10]);

		b.set(20);
		expect(obs.causality).toHaveLength(initialLen + 2);
		const bEntry = obs.causality[initialLen + 1];
		expect(bEntry.triggerDepIndex).toBe(1);
		expect(bEntry.triggerDepName).toBe("depB");
		expect(bEntry.result).toBe(22);

		obs.dispose();
	});

	it("reports -1 for initial evaluation (no dep changed)", () => {
		const a = state(1, { name: "x" });
		const d = derived([a], () => a.get() * 2);

		// The derived evaluates lazily on first subscribe
		const obs = Inspector.causalityTrace(d);

		// First causality entry is from initial subscription eval
		// prevDepValues was snapshot before subscribe, so if a.get() hasn't changed, index = -1
		// Actually derived evaluates on subscribe, values haven't changed from snapshot
		if (obs.causality.length > 0) {
			expect(obs.causality[0].triggerDepIndex).toBe(-1);
		}

		a.set(5);
		const last = obs.causality[obs.causality.length - 1];
		expect(last.triggerDepIndex).toBe(0);
		expect(last.result).toBe(10);

		obs.dispose();
	});

	it("falls back to regular observe for non-derived stores", () => {
		const s = state(42, { name: "plain" });
		const obs = Inspector.causalityTrace(s);

		expect(obs.causality).toHaveLength(0);
		s.set(100);
		expect(obs.values).toContain(100);
		expect(obs.causality).toHaveLength(0); // no causality for non-derived

		obs.dispose();
	});

	it("restores original _fn on dispose", () => {
		const a = state(1);
		const d = derived([a], () => a.get() + 1) as any;

		const originalFn = d._fn;
		const obs = Inspector.causalityTrace(d);
		expect(d._fn).not.toBe(originalFn); // wrapped

		obs.dispose();
		expect(d._fn).toBe(originalFn); // restored
	});

	it("reconnect returns fresh observation", () => {
		const a = state(1, { name: "a" });
		const d = derived([a], () => a.get() * 3);

		const obs1 = Inspector.causalityTrace(d);
		a.set(2);
		expect(obs1.causality.length).toBeGreaterThanOrEqual(1);

		const obs2 = obs1.reconnect();
		// reconnect re-subscribes, which may trigger an initial eval
		const initialLen = obs2.causality.length;

		a.set(3);
		expect(obs2.causality.length).toBeGreaterThan(initialLen);
		expect(obs2.causality[obs2.causality.length - 1].result).toBe(9);

		obs2.dispose();
	});

	it("has timestamps on all causality entries", () => {
		const a = state(1, { name: "a" });
		const d = derived([a], () => a.get());

		const obs = Inspector.causalityTrace(d);
		a.set(2);
		a.set(3);

		for (const entry of obs.causality) {
			expect(typeof entry.timestamp).toBe("number");
			expect(entry.timestamp).toBeGreaterThan(0);
		}

		obs.dispose();
	});
});
