import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitepress";

const root = resolve(__dirname, "../..");

export default defineConfig({
	buildEnd() {
		copyFileSync(resolve(root, "llms.txt"), resolve(root, "site/.vitepress/dist/llms.txt"));
		copyFileSync(
			resolve(root, "llms-full.txt"),
			resolve(root, "site/.vitepress/dist/llms-full.txt"),
		);
	},

	title: "callbag-recharge",
	description: "State that flows. Reactive state management for TypeScript.",
	base: "/callbag-recharge/",

	appearance: false,

	vite: {
		resolve: {
			alias: {
				"@lib": resolve(root, "src"),
				"@examples": resolve(root, "examples"),
				"callbag-recharge/extra": resolve(root, "src/extra"),
				"callbag-recharge/data": resolve(root, "src/data"),
				"callbag-recharge/orchestrate": resolve(root, "src/orchestrate"),
				"callbag-recharge/utils": resolve(root, "src/utils"),
				"callbag-recharge/memory": resolve(root, "src/memory"),
				"callbag-recharge/messaging": resolve(root, "src/messaging"),
				"callbag-recharge/ai/agentLoop": resolve(root, "src/ai/agentLoop"),
				"callbag-recharge/ai/chatStream": resolve(root, "src/ai/chatStream"),
				"callbag-recharge/ai/memoryStore": resolve(root, "src/ai/memoryStore"),
				"callbag-recharge/ai/toolCallState": resolve(root, "src/ai/toolCallState"),
				"callbag-recharge/ai/hybridRoute": resolve(root, "src/ai/hybridRoute"),
				"callbag-recharge/ai/fromLLM": resolve(root, "src/ai/fromLLM"),
				"callbag-recharge/ai": resolve(root, "src/ai"),
				"callbag-recharge/patterns/formField": resolve(root, "src/patterns/formField"),
				"callbag-recharge/patterns/textEditor": resolve(root, "src/patterns/textEditor"),
				"callbag-recharge/compat/vue": resolve(root, "src/compat/vue"),
				"callbag-recharge/compat/jotai": resolve(root, "src/compat/jotai"),
				"callbag-recharge/compat/zustand": resolve(root, "src/compat/zustand"),
				"callbag-recharge/compat/signals": resolve(root, "src/compat/signals"),
				"callbag-recharge": resolve(root, "src"),
			},
		},
	},

	markdown: {
		theme: "material-theme-palenight",
	},

	head: [
		["link", { rel: "icon", href: "/callbag-recharge/favicon.ico" }],
		["meta", { property: "og:title", content: "callbag-recharge" }],
		[
			"meta",
			{
				property: "og:description",
				content: "State that flows. Reactive state management for TypeScript.",
			},
		],
		["meta", { property: "og:type", content: "website" }],
		[
			"link",
			{
				rel: "preconnect",
				href: "https://fonts.googleapis.com",
			},
		],
		[
			"link",
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossorigin: "",
			},
		],
		[
			"link",
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@300;400;500;600;700&family=Tangerine:wght@400;700&family=Libre+Baskerville:ital,wght@1,400&display=swap",
			},
		],
	],

	themeConfig: {
		nav: [
			{ text: "Guide", link: "/getting-started" },
			{ text: "API", link: "/api/state" },
			{ text: "Recipes", link: "/recipes/" },
			{ text: "Comparisons", link: "/comparisons/" },
			{ text: "Edge AI", link: "/edge-ai" },
			{ text: "Demos", link: "/demos/" },
			{ text: "Architecture", link: "/architecture/" },
			{ text: "Blog", link: "/blog/" },
		],

		sidebar: {
			"/getting-started": [
				{
					text: "Guide",
					items: [{ text: "Getting Started", link: "/getting-started" }],
				},
			],
			"/api/": [
				{
					text: "Core",
					collapsed: false,
					items: [
						{ text: "state()", link: "/api/state" },
						{ text: "derived()", link: "/api/derived" },
						{ text: "dynamicDerived()", link: "/api/dynamicDerived" },
						{ text: "effect()", link: "/api/effect" },
						{ text: "producer()", link: "/api/producer" },
						{ text: "operator()", link: "/api/operator" },
						{ text: "pipe()", link: "/api/pipe" },
						{ text: "batch()", link: "/api/batch" },
						{ text: "teardown()", link: "/api/teardown" },
						{ text: "subscribe()", link: "/api/subscribe" },
						{ text: "Inspector", link: "/api/inspector" },
						{ text: "Protocol & Lifecycle", link: "/api/protocol" },
					],
				},
				{
					text: "Raw",
					collapsed: true,
					items: [
						{ text: "rawSubscribe()", link: "/api/rawSubscribe" },
						{ text: "rawSkip()", link: "/api/rawSkip" },
						{ text: "rawFromPromise()", link: "/api/rawFromPromise" },
						{ text: "rawFromAsyncIter()", link: "/api/rawFromAsyncIter" },
						{ text: "rawFromAny()", link: "/api/rawFromAny" },
						{ text: "rawRace()", link: "/api/rawRace" },
						{ text: "firstValueFrom()", link: "/api/firstValueFrom" },
						{ text: "latestAsync()", link: "/api/latestAsync" },
						{ text: "fromTimer()", link: "/api/fromTimer" },
						{ text: "fromNodeCallback()", link: "/api/fromNodeCallback" },
					],
				},
				{
					text: "Extra",
					collapsed: true,
					items: [
						{ text: "All Operators Reference", link: "/extras/" },
						{ text: "fromAny()", link: "/api/fromAny" },
						{ text: "fromIter()", link: "/api/fromIter" },
						{ text: "fromAsyncIter()", link: "/api/fromAsyncIter" },
						{ text: "fromEvent()", link: "/api/fromEvent" },
						{ text: "fromPromise()", link: "/api/fromPromise" },
						{ text: "fromObs()", link: "/api/fromObs" },
						{ text: "of()", link: "/api/of" },
						{ text: "empty()", link: "/api/empty" },
						{ text: "never()", link: "/api/never" },
						{ text: "throwError()", link: "/api/throwError" },
						{ text: "interval()", link: "/api/interval" },
						{ text: "fromCron()", link: "/api/fromCron" },
						{ text: "fromTrigger()", link: "/api/fromTrigger" },
						{ text: "route()", link: "/api/route" },
						{ text: "pipeRaw()", link: "/api/pipeRaw" },
						{ text: "map()", link: "/api/map" },
						{ text: "filter()", link: "/api/filter" },
						{ text: "scan()", link: "/api/scan" },
						{ text: "take()", link: "/api/take" },
						{ text: "skip()", link: "/api/skip" },
						{ text: "first()", link: "/api/first" },
						{ text: "last()", link: "/api/last" },
						{ text: "find()", link: "/api/find" },
						{ text: "elementAt()", link: "/api/elementAt" },
						{ text: "distinctUntilChanged()", link: "/api/distinctUntilChanged" },
						{ text: "startWith()", link: "/api/startWith" },
						{ text: "pairwise()", link: "/api/pairwise" },
						{ text: "takeUntil()", link: "/api/takeUntil" },
						{ text: "takeWhile()", link: "/api/takeWhile" },
						{ text: "withLatestFrom()", link: "/api/withLatestFrom" },
						{ text: "partition()", link: "/api/partition" },
						{ text: "switchMap()", link: "/api/switchMap" },
						{ text: "concatMap()", link: "/api/concatMap" },
						{ text: "exhaustMap()", link: "/api/exhaustMap" },
						{ text: "flat()", link: "/api/flat" },
						{ text: "share()", link: "/api/share" },
						{ text: "tap()", link: "/api/tap" },
						{ text: "remember()", link: "/api/remember" },
						{ text: "cached()", link: "/api/cached" },
						{ text: "debounce()", link: "/api/debounce" },
						{ text: "throttle()", link: "/api/throttle" },
						{ text: "delay()", link: "/api/delay" },
						{ text: "merge()", link: "/api/merge" },
						{ text: "combine()", link: "/api/combine" },
						{ text: "concat()", link: "/api/concat" },
						{ text: "race()", link: "/api/race" },
						{ text: "buffer()", link: "/api/buffer" },
						{ text: "bufferCount()", link: "/api/bufferCount" },
						{ text: "bufferTime()", link: "/api/bufferTime" },
						{ text: "window()", link: "/api/window" },
						{ text: "windowCount()", link: "/api/windowCount" },
						{ text: "windowTime()", link: "/api/windowTime" },
						{ text: "sample()", link: "/api/sample" },
						{ text: "audit()", link: "/api/audit" },
						{ text: "timeout()", link: "/api/timeout" },
						{ text: "reduce()", link: "/api/reduce" },
						{ text: "toArray()", link: "/api/toArray" },
						{ text: "groupBy()", link: "/api/groupBy" },
						{ text: "rescue()", link: "/api/rescue" },
						{ text: "repeat()", link: "/api/repeat" },
						{ text: "forEach()", link: "/api/forEach" },
						{ text: "pausable()", link: "/api/pausable" },
						{ text: "subject()", link: "/api/subject" },
						{ text: "wrap()", link: "/api/wrap" },
					],
				},
				{
					text: "Data Structures",
					collapsed: true,
					items: [
						{ text: "reactiveLog()", link: "/api/reactiveLog" },
						{ text: "compaction()", link: "/api/compaction" },
						{ text: "reactiveMap()", link: "/api/reactiveMap" },
						{ text: "reactiveIndex()", link: "/api/reactiveIndex" },
						{ text: "reactiveList()", link: "/api/reactiveList" },
						{ text: "pubsub()", link: "/api/pubsub" },
					],
				},
				{
					text: "Orchestration",
					collapsed: true,
					items: [
						{ text: "pipeline()", link: "/api/pipeline" },
						{ text: "task()", link: "/api/task" },
						{ text: "taskState()", link: "/api/taskState" },
						{ text: "branch()", link: "/api/branch" },
						{ text: "approval()", link: "/api/approval" },
						{ text: "gate()", link: "/api/gate" },
						{ text: "forEach()", link: "/api/forEach" },
						{ text: "onFailure()", link: "/api/onFailure" },
						{ text: "wait()", link: "/api/wait" },
						{ text: "join()", link: "/api/join" },
						{ text: "sensor()", link: "/api/sensor" },
						{ text: "loop()", link: "/api/loop" },
						{ text: "subPipeline()", link: "/api/subPipeline" },
						{ text: "executionLog()", link: "/api/executionLog" },
						{ text: "pipelineRunner()", link: "/api/pipelineRunner" },
						{ text: "checkpoint()", link: "/api/checkpoint" },
						{ text: "fromCron()", link: "/api/fromCron" },
						{ text: "fromTrigger()", link: "/api/fromTrigger" },
						{ text: "route()", link: "/api/route" },
						{ text: "toMermaid()", link: "/api/toMermaid" },
						{ text: "toD2()", link: "/api/toD2" },
						{ text: "dagLayout()", link: "/api/dagLayout" },
						{ text: "workflowNode()", link: "/api/workflowNode" },
					],
				},
				{
					text: "Messaging",
					collapsed: true,
					items: [
						{ text: "topic()", link: "/api/topic" },
						{ text: "subscription()", link: "/api/subscription" },
						{ text: "jobQueue()", link: "/api/jobQueue" },
						{ text: "jobFlow()", link: "/api/jobFlow" },
						{ text: "repeatPublish()", link: "/api/repeatPublish" },
					],
				},
				{
					text: "Memory",
					collapsed: true,
					items: [
						{
							text: "collection()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/memory/collection.ts",
						},
						{
							text: "memoryNode()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/memory/node.ts",
						},
						{
							text: "decay()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/memory/decay.ts",
						},
						{
							text: "vectorIndex()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/memory/vectorIndex.ts",
						},
					],
				},
				{
					text: "Adapters",
					collapsed: true,
					items: [
						{ text: "fromLLM()", link: "/api/fromLLM" },
						{
							text: "fromMCP()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/adapters/mcp.ts",
						},
						{
							text: "fromHTTP()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/adapters/http.ts",
						},
						{
							text: "fromWebSocket()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/adapters/websocket.ts",
						},
						{
							text: "fromWebhook()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/adapters/webhook.ts",
						},
						{
							text: "toSSE()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/adapters/sse.ts",
						},
					],
				},
				{
					text: "Worker",
					collapsed: true,
					items: [
						{
							text: "workerBridge()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/worker/bridge.ts",
						},
						{
							text: "workerSelf()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/worker/self.ts",
						},
						{
							text: "withConnectionStatus()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/utils/withConnectionStatus.ts",
						},
					],
				},
				{
					text: "Utils",
					collapsed: true,
					items: [
						{ text: "withStatus()", link: "/api/withStatus" },
						{ text: "withBreaker()", link: "/api/withBreaker" },
						{ text: "withSchema()", link: "/api/withSchema" },
						{ text: "withMeta()", link: "/api/withMeta" },
						{ text: "retry()", link: "/api/retry" },
						{ text: "track()", link: "/api/track" },
						{ text: "dag()", link: "/api/dag" },
						{ text: "cascadingCache()", link: "/api/cascadingCache" },
						{ text: "tieredStorage()", link: "/api/tieredStorage" },
						{ text: "keyedAsync()", link: "/api/keyedAsync" },
						{ text: "namespace()", link: "/api/namespace" },
						{ text: "transaction()", link: "/api/transaction" },
						{ text: "priorityQueue()", link: "/api/priorityQueue" },
						{ text: "tokenTracker()", link: "/api/tokenTracker" },
						{ text: "autoSave()", link: "/api/autoSave" },
						{ text: "contentStats()", link: "/api/contentStats" },
						{ text: "cursorInfo()", link: "/api/cursorInfo" },
						{
							text: "cancellableStream()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/utils/cancellableStream.ts",
						},
						{
							text: "stateMachine()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/utils/stateMachine.ts",
						},
						{
							text: "circuitBreaker()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/utils/circuitBreaker.ts",
						},
						{
							text: "backoff()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/utils/backoff.ts",
						},
					],
				},
				{
					text: "Patterns",
					collapsed: true,
					items: [
						{
							text: "chatStream()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/ai/chatStream",
						},
						{
							text: "agentLoop()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/ai/agentLoop",
						},
						{ text: "memoryStore()", link: "/api/memoryStore" },
						{ text: "ragPipeline()", link: "/api/ragPipeline" },
						{ text: "conversationSummary()", link: "/api/conversationSummary" },
						{
							text: "createStore()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/patterns/createStore",
						},
						{
							text: "formField()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/patterns/formField",
						},
						{
							text: "textEditor()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/patterns/textEditor",
						},
						{
							text: "undoRedo()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/patterns/undoRedo",
						},
						{
							text: "pagination()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/patterns/pagination",
						},
						{
							text: "toolCallState()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/ai/toolCallState",
						},
						{
							text: "hybridRoute()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/ai/hybridRoute",
						},
						{
							text: "commandBus()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/patterns/commandBus",
						},
						{
							text: "selection()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/patterns/selection",
						},
						{
							text: "rateLimiter()",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/patterns/rateLimiter",
						},
						{ text: "textBuffer()", link: "/api/textBuffer" },
					],
				},
				{
					text: "Framework Bindings",
					collapsed: true,
					items: [
						{ text: "useSubscribeRecord() (Vue)", link: "/api/useSubscribeRecord" },
						{
							text: "Vue (useStore, useSubscribe)",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/compat/vue/index.ts",
						},
						{
							text: "React (useStore, useSubscribe)",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/compat/react/index.ts",
						},
						{
							text: "Svelte (useSubscribe)",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/compat/svelte/index.ts",
						},
						{
							text: "Solid (useSubscribe)",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/compat/solid/index.ts",
						},
						{
							text: "Zustand compat",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/compat/zustand/index.ts",
						},
						{
							text: "Jotai compat",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/compat/jotai/index.ts",
						},
						{
							text: "Nanostores compat",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/compat/nanostores/index.ts",
						},
						{
							text: "TC39 Signals compat",
							link: "https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/compat/signals/index.ts",
						},
					],
				},
			],
			"/extras/": [
				{
					text: "Extra",
					collapsed: false,
					items: [
						{ text: "Extra API Index", link: "/extras/" },
						{ text: "fromAny()", link: "/api/fromAny" },
						{ text: "fromIter()", link: "/api/fromIter" },
						{ text: "fromAsyncIter()", link: "/api/fromAsyncIter" },
						{ text: "fromEvent()", link: "/api/fromEvent" },
						{ text: "fromPromise()", link: "/api/fromPromise" },
						{ text: "fromObs()", link: "/api/fromObs" },
						{ text: "of()", link: "/api/of" },
						{ text: "empty()", link: "/api/empty" },
						{ text: "never()", link: "/api/never" },
						{ text: "throwError()", link: "/api/throwError" },
						{ text: "interval()", link: "/api/interval" },
						{ text: "fromCron()", link: "/api/fromCron" },
						{ text: "fromTrigger()", link: "/api/fromTrigger" },
						{ text: "route()", link: "/api/route" },
						{ text: "pipeRaw()", link: "/api/pipeRaw" },
						{ text: "map()", link: "/api/map" },
						{ text: "filter()", link: "/api/filter" },
						{ text: "scan()", link: "/api/scan" },
						{ text: "take()", link: "/api/take" },
						{ text: "skip()", link: "/api/skip" },
						{ text: "first()", link: "/api/first" },
						{ text: "last()", link: "/api/last" },
						{ text: "find()", link: "/api/find" },
						{ text: "elementAt()", link: "/api/elementAt" },
						{ text: "distinctUntilChanged()", link: "/api/distinctUntilChanged" },
						{ text: "startWith()", link: "/api/startWith" },
						{ text: "pairwise()", link: "/api/pairwise" },
						{ text: "takeUntil()", link: "/api/takeUntil" },
						{ text: "takeWhile()", link: "/api/takeWhile" },
						{ text: "withLatestFrom()", link: "/api/withLatestFrom" },
						{ text: "partition()", link: "/api/partition" },
						{ text: "switchMap()", link: "/api/switchMap" },
						{ text: "concatMap()", link: "/api/concatMap" },
						{ text: "exhaustMap()", link: "/api/exhaustMap" },
						{ text: "flat()", link: "/api/flat" },
						{ text: "share()", link: "/api/share" },
						{ text: "tap()", link: "/api/tap" },
						{ text: "remember()", link: "/api/remember" },
						{ text: "cached()", link: "/api/cached" },
						{ text: "debounce()", link: "/api/debounce" },
						{ text: "throttle()", link: "/api/throttle" },
						{ text: "delay()", link: "/api/delay" },
						{ text: "merge()", link: "/api/merge" },
						{ text: "combine()", link: "/api/combine" },
						{ text: "concat()", link: "/api/concat" },
						{ text: "race()", link: "/api/race" },
						{ text: "buffer()", link: "/api/buffer" },
						{ text: "bufferCount()", link: "/api/bufferCount" },
						{ text: "bufferTime()", link: "/api/bufferTime" },
						{ text: "window()", link: "/api/window" },
						{ text: "windowCount()", link: "/api/windowCount" },
						{ text: "windowTime()", link: "/api/windowTime" },
						{ text: "sample()", link: "/api/sample" },
						{ text: "audit()", link: "/api/audit" },
						{ text: "timeout()", link: "/api/timeout" },
						{ text: "reduce()", link: "/api/reduce" },
						{ text: "toArray()", link: "/api/toArray" },
						{ text: "groupBy()", link: "/api/groupBy" },
						{ text: "rescue()", link: "/api/rescue" },
						{ text: "repeat()", link: "/api/repeat" },
						{ text: "forEach()", link: "/api/forEach" },
						{ text: "pausable()", link: "/api/pausable" },
						{ text: "subject()", link: "/api/subject" },
						{ text: "wrap()", link: "/api/wrap" },
					],
				},
			],
			"/recipes/": [
				{
					text: "Recipes",
					collapsed: false,
					items: [
						{ text: "Overview", link: "/recipes/" },
						{ text: "Airflow-Style Pipeline", link: "/recipes/airflow-pipeline" },
						{ text: "Cron Pipeline", link: "/recipes/cron-pipeline" },
						{ text: "AI Chat with Streaming", link: "/recipes/ai-chat-streaming" },
						{ text: "Reactive Data Pipeline", link: "/recipes/data-pipeline" },
						{ text: "Real-Time Dashboard", link: "/recipes/real-time-dashboard" },
						{ text: "On-Device LLM Streaming", link: "/recipes/on-device-llm-streaming" },
						{ text: "Hybrid Cloud+Edge Routing", link: "/recipes/hybrid-routing" },
						{ text: "Tool Calls for Local LLMs", link: "/recipes/tool-calls" },
					],
				},
				{
					text: "Migration Guides",
					collapsed: true,
					items: [
						{ text: "From Zustand", link: "/recipes/zustand-migration" },
						{ text: "From Jotai", link: "/recipes/jotai-migration" },
						{ text: "From Nanostores", link: "/recipes/nanostores-migration" },
					],
				},
			],
			"/comparisons/": [
				{
					text: "Comparisons",
					collapsed: false,
					items: [
						{ text: "Overview", link: "/comparisons/" },
						{ text: "vs Zustand", link: "/comparisons/zustand" },
						{ text: "vs Jotai", link: "/comparisons/jotai" },
						{ text: "vs RxJS", link: "/comparisons/rxjs" },
						{ text: "vs Airflow", link: "/comparisons/airflow" },
						{ text: "vs n8n", link: "/comparisons/n8n" },
						{ text: "vs LangGraph.js", link: "/comparisons/langgraph" },
						{ text: "vs Vercel AI SDK", link: "/comparisons/vercel-ai-sdk" },
					],
				},
			],
			"/edge-ai": [
				{
					text: "Edge AI",
					items: [{ text: "State Management for Edge AI", link: "/edge-ai" }],
				},
			],
			"/demos/": [
				{
					text: "Demos",
					collapsed: false,
					items: [
						{ text: "Overview", link: "/demos/" },
						{ text: "Markdown Editor", link: "/demos/markdown-editor" },
						{ text: "Workflow Builder", link: "/demos/workflow-builder" },
						{ text: "Airflow in TypeScript", link: "/demos/airflow" },
						{ text: "Form Builder", link: "/demos/form-builder" },
						{ text: "Agent Loop", link: "/demos/agent-loop" },
						{ text: "Real-time Dashboard", link: "/demos/realtime-dashboard" },
						{ text: "State Machine", link: "/demos/state-machine" },
						{ text: "Compat Comparison", link: "/demos/compat-comparison" },
					],
				},
			],
			"/architecture/": [
				{
					text: "Architecture",
					items: [{ text: "Design & Internals", link: "/architecture/" }],
				},
			],
			"/blog/": [
				{
					text: "The callbag-recharge Chronicle",
					collapsed: false,
					items: [
						{ text: "Blog Home", link: "/blog/" },
						{
							text: "Arc 1: Origins",
							collapsed: false,
							items: [
								{
									text: "1. Callbag Is Dead. Long Live Callbag.",
									link: "/blog/01-callbag-is-dead-long-live-callbag",
								},
								{
									text: "2. The Protocol That Already Solved Your Problem",
									link: "/blog/02-the-protocol-that-already-solved-your-problem",
								},
								{
									text: "3. Signals Are Not Enough",
									link: "/blog/03-signals-are-not-enough",
								},
							],
						},
						{
							text: "Arc 2: Architecture v1",
							collapsed: false,
							items: [
								{
									text: "4. Push Dirty, Pull Values: Our First Diamond Solution",
									link: "/blog/04-push-dirty-pull-values-our-first-diamond-solution",
								},
								{
									text: "5. Why Explicit Dependencies Beat Magic Tracking",
									link: "/blog/05-why-explicit-dependencies-beat-magic-tracking",
								},
								{
									text: "6. The Inspector Pattern: Observability as a First-Class Citizen",
									link: "/blog/06-the-inspector-pattern-observability-as-first-class-citizen",
								},
							],
						},
						{
							text: "Arc 3: Architecture v2",
							collapsed: false,
							items: [
								{
									text: "7. Data Should Flow Through the Graph, Not Around It",
									link: "/blog/07-data-should-flow-through-the-graph-not-around-it",
								},
								{
									text: "8. Two-Phase Push: DIRTY First, Values Second",
									link: "/blog/08-two-phase-push-dirty-first-values-second",
								},
								{
									text: "9. From Pull-Phase to Push-Phase Memoization",
									link: "/blog/09-from-pull-phase-to-push-phase-memoization",
								},
							],
						},
						{
							text: "Arc 4: Callbag-Native",
							collapsed: false,
							items: [
								{
									text: "10. Promises Are the New Callback Hell",
									link: "/blog/10-promises-are-the-new-callback-hell",
								},
							],
						},
					],
				},
			],
		},

		socialLinks: [
			{
				icon: "github",
				link: "https://github.com/Callbag-Recharge/callbag-recharge",
			},
		],

		footer: {
			message: "Released under the MIT License.",
		},
	},
});
