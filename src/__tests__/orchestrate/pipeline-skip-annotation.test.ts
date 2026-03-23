import { afterEach, describe, expect, it } from "vitest";
import { Inspector } from "../../core/inspector";
import { fromTrigger } from "../../extra/fromTrigger";
import { pipeline, source } from "../../orchestrate/pipeline";
import { task } from "../../orchestrate/task";

describe("pipeline skip propagation annotations", () => {
	afterEach(() => {
		Inspector._reset();
	});

	it("annotates skipped tasks with upstream failure info", async () => {
		const wf = pipeline({
			trigger: source(fromTrigger<string>()),
			fetch: task(["trigger"], async () => {
				throw new Error("network fail");
			}),
			process: task(["fetch"], async (_signal, [data]) => data),
		});

		(wf.steps.trigger as any).fire("go");
		await new Promise((r) => setTimeout(r, 50));

		// Use traceLog to check annotations were recorded
		const log = Inspector.traceLog();
		const skipAnnotations = log.filter((e) => e.reason.includes("skipped"));
		expect(skipAnnotations.length).toBeGreaterThanOrEqual(1);
		expect(skipAnnotations[0].reason).toContain("fetch");
		expect(skipAnnotations[0].reason).toContain("failed/skipped");

		wf.destroy();
	});

	it("cascading skip annotations mention the intermediate step", async () => {
		const wf = pipeline({
			trigger: source(fromTrigger<string>()),
			a: task(["trigger"], async () => {
				throw new Error("fail");
			}),
			b: task(["a"], async (_signal, [v]) => v),
			c: task(["b"], async (_signal, [v]) => v),
		});

		(wf.steps.trigger as any).fire("go");
		await new Promise((r) => setTimeout(r, 50));

		const log = Inspector.traceLog();
		const skipAnnotations = log.filter((e) => e.reason.includes("skipped"));

		// Both b and c should have skip annotations
		expect(skipAnnotations.length).toBeGreaterThanOrEqual(2);

		// b's annotation should mention "a"
		const bAnnotation = skipAnnotations.find((e) => e.reason.includes("[a]"));
		expect(bAnnotation).toBeDefined();

		// c's annotation should mention "b" (cascaded)
		const cAnnotation = skipAnnotations.find((e) => e.reason.includes("[b]"));
		expect(cAnnotation).toBeDefined();

		wf.destroy();
	});
});
