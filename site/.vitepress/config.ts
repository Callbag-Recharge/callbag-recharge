import { defineConfig } from "vitepress";

export default defineConfig({
	title: "callbag-recharge",
	description: "State that flows. Reactive state management for TypeScript.",
	base: "/callbag-recharge/",

	appearance: false,

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
				href: "https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@300;400;500;600;700&display=swap",
			},
		],
	],

	themeConfig: {
		nav: [
			{ text: "Guide", link: "/getting-started" },
			{ text: "API", link: "/api/state" },
			{ text: "Extras", link: "/extras/" },
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
					{ text: "Inspector", link: "/api/inspector" },
				],
			},
			{
				text: "Extras",
				items: [{ text: "Operator Reference", link: "/extras/" }],
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
