import { describe, expect, it } from "vitest";
import type { MetricEvent, ServiceMetric } from "../../../examples/realtime-dashboard";
import { Inspector } from "../../core/inspector";
import { reactiveLog, reactiveMap } from "../../data/index";
import { derived } from "../../index";

describe("realtime-dashboard example", () => {
	it("reactiveMap starts empty", () => {
		const services = reactiveMap<ServiceMetric>({ ttl: 30_000 });
		expect(services.size()).toBe(0);
		expect(services.sizeStore.get()).toBe(0);
	});

	it("reactiveLog starts empty", () => {
		const log = reactiveLog<MetricEvent>({ maxSize: 100 });
		expect(log.lengthStore.get()).toBe(0);
	});

	it("can add services and read them back", () => {
		const services = reactiveMap<ServiceMetric>({ ttl: 30_000 });

		const metric: ServiceMetric = {
			name: "api-gateway",
			latencyMs: 150,
			errorRate: 0.01,
			requestCount: 1,
			lastUpdated: Date.now(),
		};

		services.set("api-gateway", metric);
		expect(services.size()).toBe(1);
		expect(services.get("api-gateway")).toEqual(metric);
		expect(services.sizeStore.get()).toBe(1);
	});

	it("can append events to log", () => {
		const log = reactiveLog<MetricEvent>({ maxSize: 100 });

		const event: MetricEvent = {
			service: "api-gateway",
			latencyMs: 200,
			isError: false,
			timestamp: Date.now(),
		};

		log.append(event);
		expect(log.lengthStore.get()).toBe(1);
	});

	it("log respects maxSize", () => {
		const log = reactiveLog<MetricEvent>({ maxSize: 3 });

		for (let i = 0; i < 5; i++) {
			log.append({
				service: `svc-${i}`,
				latencyMs: 100 + i,
				isError: false,
				timestamp: Date.now(),
			});
		}

		expect(log.lengthStore.get()).toBe(3);
	});

	it("healthSummary derived computes correctly", () => {
		const services = reactiveMap<ServiceMetric>({ ttl: 30_000 });
		const log = reactiveLog<MetricEvent>({ maxSize: 100 });

		const healthSummary = derived(
			[services.sizeStore, log.lengthStore],
			() => {
				let healthy = 0;
				let warning = 0;
				let critical = 0;
				for (const [, m] of services.entries()) {
					if (m.errorRate > 0.05 || m.latencyMs > 1000) critical++;
					else if (m.errorRate > 0.02 || m.latencyMs > 500) warning++;
					else healthy++;
				}
				return { healthy, warning, critical, total: services.size() };
			},
			{ name: "healthSummary" },
		);

		const obs = Inspector.observe(healthSummary);

		// Initially empty
		expect(healthSummary.get()).toEqual({ healthy: 0, warning: 0, critical: 0, total: 0 });

		// Add a healthy service
		services.set("svc-a", {
			name: "svc-a",
			latencyMs: 100,
			errorRate: 0.01,
			requestCount: 10,
			lastUpdated: Date.now(),
		});
		expect(healthSummary.get()).toEqual({ healthy: 1, warning: 0, critical: 0, total: 1 });

		// Add a critical service
		services.set("svc-b", {
			name: "svc-b",
			latencyMs: 1500,
			errorRate: 0.1,
			requestCount: 5,
			lastUpdated: Date.now(),
		});
		expect(healthSummary.get()).toEqual({ healthy: 1, warning: 0, critical: 1, total: 2 });

		// Add a warning service
		services.set("svc-c", {
			name: "svc-c",
			latencyMs: 600,
			errorRate: 0.01,
			requestCount: 3,
			lastUpdated: Date.now(),
		});
		expect(healthSummary.get()).toEqual({ healthy: 1, warning: 1, critical: 1, total: 3 });

		obs.dispose();
	});

	it("clear resets services and log", () => {
		const services = reactiveMap<ServiceMetric>({ ttl: 30_000 });
		const log = reactiveLog<MetricEvent>({ maxSize: 100 });

		services.set("svc", {
			name: "svc",
			latencyMs: 100,
			errorRate: 0,
			requestCount: 1,
			lastUpdated: Date.now(),
		});
		log.append({
			service: "svc",
			latencyMs: 100,
			isError: false,
			timestamp: Date.now(),
		});

		expect(services.size()).toBe(1);
		expect(log.lengthStore.get()).toBe(1);

		services.clear();
		log.clear();

		expect(services.size()).toBe(0);
		expect(log.lengthStore.get()).toBe(0);
	});
});
