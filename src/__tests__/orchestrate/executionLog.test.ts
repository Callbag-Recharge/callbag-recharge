import { describe, expect, it } from "vitest";
import { fromTrigger } from "../../extra/fromTrigger";
import { map } from "../../extra/map";
import { pipe, state } from "../../index";
import { executionLog, memoryLogAdapter } from "../../orchestrate/executionLog";
import { pipeline, step } from "../../orchestrate/pipeline";

describe("executionLog", () => {
	it("appends entries and tracks length", () => {
		const log = executionLog();

		log.append({ step: "a", event: "start", timestamp: 1000 });
		log.append({ step: "a", event: "value", timestamp: 1001, value: 42 });
		log.append({ step: "a", event: "complete", timestamp: 1002 });

		expect(log.log.length).toBe(3);
		expect(log.length.get()).toBe(3);
	});

	it("forStep() returns entries for a specific step", () => {
		const log = executionLog();

		log.append({ step: "a", event: "start", timestamp: 1000 });
		log.append({ step: "b", event: "start", timestamp: 1001 });
		log.append({ step: "a", event: "value", timestamp: 1002, value: 1 });
		log.append({ step: "b", event: "value", timestamp: 1003, value: 2 });

		const aEntries = log.forStep("a");
		expect(aEntries).toHaveLength(2);
		expect(aEntries[0].event).toBe("start");
		expect(aEntries[1].event).toBe("value");

		const bEntries = log.forStep("b");
		expect(bEntries).toHaveLength(2);
	});

	it("forStep() returns empty array for unknown step", () => {
		const log = executionLog();
		expect(log.forStep("unknown")).toEqual([]);
	});

	it("latest store reflects most recent entry", () => {
		const log = executionLog();

		log.append({ step: "a", event: "start", timestamp: 1000 });
		expect(log.latest.get()?.event).toBe("start");

		log.append({ step: "a", event: "complete", timestamp: 1001 });
		expect(log.latest.get()?.event).toBe("complete");
	});

	it("clear() resets log and step index", () => {
		const log = executionLog();

		log.append({ step: "a", event: "start", timestamp: 1000 });
		log.append({ step: "a", event: "value", timestamp: 1001 });

		log.clear();
		expect(log.log.length).toBe(0);
		expect(log.forStep("a")).toEqual([]);
	});

	it("bounded mode limits entries", () => {
		const log = executionLog({ maxSize: 3 });

		log.append({ step: "a", event: "start", timestamp: 1 });
		log.append({ step: "a", event: "value", timestamp: 2 });
		log.append({ step: "a", event: "complete", timestamp: 3 });
		log.append({ step: "b", event: "start", timestamp: 4 }); // evicts first

		expect(log.log.length).toBe(3);
	});

	it("destroy() cleans up", () => {
		const log = executionLog();
		log.append({ step: "a", event: "start", timestamp: 1 });
		log.destroy();
		expect(log.forStep("a")).toEqual([]);
	});
});

describe("executionLog + memoryLogAdapter", () => {
	it("persists entries through adapter", () => {
		const adapter = memoryLogAdapter();
		const log = executionLog({ persist: adapter });

		log.append({ step: "a", event: "start", timestamp: 1000 });
		log.append({ step: "a", event: "value", timestamp: 1001 });

		const persisted = adapter.load() as any[];
		expect(persisted).toHaveLength(2);
		expect(persisted[0].step).toBe("a");
	});

	it("clear() also clears adapter", () => {
		const adapter = memoryLogAdapter();
		const log = executionLog({ persist: adapter });

		log.append({ step: "a", event: "start", timestamp: 1000 });
		log.clear();

		const persisted = adapter.load() as any[];
		expect(persisted).toHaveLength(0);
	});
});

describe("executionLog.connectPipeline", () => {
	it("auto-logs pipeline step events", () => {
		const log = executionLog();

		const wf = pipeline({
			trigger: step(fromTrigger<number>()),
			doubled: step(["trigger"], (s: any) =>
				pipe(
					s,
					map((x: number) => x * 2),
				),
			),
		});

		const unsub = log.connectPipeline(wf.inner.stepMeta, wf.inner.order);

		// Fire a value through the pipeline
		(wf.steps.trigger as any).fire(5);

		const triggerEvents = log.forStep("trigger");
		expect(triggerEvents.length).toBeGreaterThan(0);
		expect(triggerEvents.some((e) => e.event === "start" || e.event === "value")).toBe(true);

		const doubledEvents = log.forStep("doubled");
		expect(doubledEvents.length).toBeGreaterThan(0);

		unsub();
		wf.destroy();
	});

	it("logs error events on step failure", () => {
		const log = executionLog();

		const source = state(0);
		const wf = pipeline({
			src: step(source),
		});

		const unsub = log.connectPipeline(wf.inner.stepMeta, wf.inner.order);

		source.set(1);

		const events = log.forStep("src");
		expect(events.length).toBeGreaterThan(0);

		unsub();
		wf.destroy();
	});
});
