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
				"callbag-recharge/patterns/agentLoop": resolve(root, "src/patterns/agentLoop"),
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
			{ text: "Extras", link: "/extras/" },
			{ text: "Recipes", link: "/recipes/" },
			{ text: "Comparisons", link: "/comparisons/" },
			{ text: "Edge AI", link: "/edge-ai" },
			{ text: "Demos", link: "/demos/" },
			{ text: "Architecture", link: "/architecture/" },
		],

		sidebar: [
			{
				text: "Guide",
				items: [{ text: "Getting Started", link: "/getting-started" }],
			},
			{
				text: "API Reference",
				items: [
					{ text: "state()", link: "/api/state" },
					{ text: "derived()", link: "/api/derived" },
					{ text: "effect()", link: "/api/effect" },
					{ text: "producer()", link: "/api/producer" },
					{ text: "operator()", link: "/api/operator" },
					{ text: "pipe()", link: "/api/pipe" },
					{ text: "batch()", link: "/api/batch" },
					{ text: "subscribe()", link: "/api/subscribe" },
					{ text: "teardown()", link: "/api/teardown" },
					{ text: "Protocol & teardown", link: "/api/protocol" },
					{ text: "Inspector", link: "/api/inspector" },
					{ text: "textBuffer()", link: "/api/textBuffer" },
					{ text: "merge()", link: "/api/merge" },
					{ text: "combine()", link: "/api/combine" },
					{ text: "pipeRaw()", link: "/api/pipeRaw" },
					{ text: "autoSave()", link: "/api/autoSave" },
					{ text: "contentStats()", link: "/api/contentStats" },
					{ text: "cursorInfo()", link: "/api/cursorInfo" },
					{ text: "dagLayout()", link: "/api/dagLayout" },
					{ text: "workflowNode()", link: "/api/workflowNode" },
					{ text: "useSubscribeRecord()", link: "/api/useSubscribeRecord" },
				],
			},
			{
				text: "Extras",
				items: [{ text: "Operator Reference", link: "/extras/" }],
			},
			{
				text: "Recipes",
				items: [
					{ text: "Overview", link: "/recipes/" },
					{
						text: "Airflow-Style Pipeline",
						link: "/recipes/airflow-pipeline",
					},
					{
						text: "Cron Pipeline",
						link: "/recipes/cron-pipeline",
					},
					{
						text: "AI Chat with Streaming",
						link: "/recipes/ai-chat-streaming",
					},
					{
						text: "Reactive Data Pipeline",
						link: "/recipes/data-pipeline",
					},
					{
						text: "Real-Time Dashboard",
						link: "/recipes/real-time-dashboard",
					},
					{
						text: "On-Device LLM Streaming",
						link: "/recipes/on-device-llm-streaming",
					},
					{
						text: "Hybrid Cloud+Edge Routing",
						link: "/recipes/hybrid-routing",
					},
					{
						text: "Tool Calls for Local LLMs",
						link: "/recipes/tool-calls",
					},
					{
						text: "createStore (Zustand Migration)",
						link: "/recipes/zustand-migration",
					},
				],
			},
			{
				text: "Migration Guides",
				items: [
					{
						text: "From Zustand",
						link: "/recipes/zustand-migration",
					},
					{
						text: "From Jotai",
						link: "/recipes/jotai-migration",
					},
					{
						text: "From Nanostores",
						link: "/recipes/nanostores-migration",
					},
				],
			},
			{
				text: "Comparisons",
				items: [
					{ text: "Overview", link: "/comparisons/" },
					{ text: "vs Zustand", link: "/comparisons/zustand" },
					{ text: "vs Jotai", link: "/comparisons/jotai" },
					{ text: "vs RxJS", link: "/comparisons/rxjs" },
					{ text: "vs Airflow", link: "/comparisons/airflow" },
					{ text: "vs n8n", link: "/comparisons/n8n" },
					{ text: "vs LangGraph.js", link: "/comparisons/langgraph" },
					{
						text: "vs Vercel AI SDK",
						link: "/comparisons/vercel-ai-sdk",
					},
				],
			},
			{
				text: "Edge AI",
				items: [
					{
						text: "State Management for Edge AI",
						link: "/edge-ai",
					},
				],
			},
			{
				text: "Demos",
				items: [
					{ text: "Overview", link: "/demos/" },
					{ text: "Markdown Editor", link: "/demos/markdown-editor" },
					{ text: "Workflow Builder", link: "/demos/workflow-builder" },
					{ text: "Airflow in TypeScript", link: "/demos/airflow" },
					{ text: "Form Builder", link: "/demos/form-builder" },
					{ text: "Agent Loop", link: "/demos/agent-loop" },
					{
						text: "Real-time Dashboard",
						link: "/demos/realtime-dashboard",
					},
					{ text: "State Machine", link: "/demos/state-machine" },
					{
						text: "Compat Comparison",
						link: "/demos/compat-comparison",
					},
				],
			},
			{
				text: "Architecture",
				items: [{ text: "Design & Internals", link: "/architecture/" }],
			},
		],

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
