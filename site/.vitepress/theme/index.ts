import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { defineAsyncComponent } from "vue";
import HomeLayout from "./components/HomeLayout.vue";
import Layout from "./Layout.vue";
import "./custom.css";

function setupSidebarAccordion(): void {
	if (typeof window === "undefined") return;
	if (document.documentElement.dataset.crSidebarAccordionInstalled === "true") return;
	document.documentElement.dataset.crSidebarAccordionInstalled = "true";

	let suppressing = false;

	const observer = new MutationObserver((mutations) => {
		if (suppressing) return;

		for (const mutation of mutations) {
			const el = mutation.target as HTMLElement;
			if (!el.classList) continue;

			// Only care about level-0 collapsible sidebar sections
			if (
				!el.classList.contains("VPSidebarItem") ||
				!el.classList.contains("level-0") ||
				!el.classList.contains("collapsible")
			)
				continue;

			// Detect expansion: old class list had "collapsed", new one doesn't
			const wasCollapsed = mutation.oldValue?.includes("collapsed") ?? false;
			const isNowExpanded = !el.classList.contains("collapsed");
			if (!wasCollapsed || !isNowExpanded) continue;

			// This section just expanded — collapse all other expanded sections
			suppressing = true;
			const allSections = document.querySelectorAll<HTMLElement>(
				".VPSidebarItem.level-0.collapsible:not(.collapsed)",
			);
			for (const section of allSections) {
				if (section === el) continue;
				// Click the header to trigger VitePress's own toggle()
				section.querySelector<HTMLElement>(":scope > .item")?.click();
			}
			suppressing = false;
			break;
		}
	});

	// Start observing once the sidebar exists; re-attach after SPA navigations
	const attach = () => {
		const sidebar = document.querySelector(".VPSidebar");
		if (sidebar) {
			observer.observe(sidebar, {
				attributes: true,
				attributeFilter: ["class"],
				attributeOldValue: true,
				subtree: true,
			});
		}
	};

	// The sidebar may not exist yet at enhanceApp time — poll briefly then watch
	const tryAttach = () => {
		if (document.querySelector(".VPSidebar")) {
			attach();
		} else {
			requestAnimationFrame(tryAttach);
		}
	};
	tryAttach();

	// Re-attach after VitePress SPA navigations re-render the sidebar
	new MutationObserver(() => attach()).observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
}

export default {
	extends: DefaultTheme,
	Layout,
	enhanceApp({ app }) {
		setupSidebarAccordion();
		app.component("HomeLayout", HomeLayout);

		// -- Showcase apps (homepage heroes, no code panel) --
		app.component(
			"MarkdownEditor",
			defineAsyncComponent(
				() => import("./components/showcases/MarkdownEditor/MarkdownEditor.vue"),
			),
		);
		app.component(
			"WorkflowBuilder",
			defineAsyncComponent(
				() => import("./components/showcases/WorkflowBuilder/WorkflowBuilder.vue"),
			),
		);
		// (H2 AIChat — pending)

		// -- Code examples (with source panel, for doc pages) --
		app.component(
			"AirflowDemo",
			defineAsyncComponent(() => import("./components/examples/AirflowPipeline/AirflowDemo.vue")),
		);
		app.component(
			"FormBuilder",
			defineAsyncComponent(() => import("./components/examples/FormBuilder/FormBuilder.vue")),
		);
		app.component(
			"AgentLoop",
			defineAsyncComponent(() => import("./components/examples/AgentLoop/AgentLoop.vue")),
		);
		app.component(
			"RealtimeDashboard",
			defineAsyncComponent(
				() => import("./components/examples/RealtimeDashboard/RealtimeDashboard.vue"),
			),
		);
		app.component(
			"StateMachine",
			defineAsyncComponent(() => import("./components/examples/StateMachine/StateMachine.vue")),
		);
		app.component(
			"CompatComparison",
			defineAsyncComponent(
				() => import("./components/examples/CompatComparison/CompatComparison.vue"),
			),
		);
	},
} satisfies Theme;
