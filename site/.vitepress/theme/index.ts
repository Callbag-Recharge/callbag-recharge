import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { defineAsyncComponent } from "vue";
import HomeLayout from "./components/HomeLayout.vue";
import "./custom.css";

function setupSidebarAccordion(): void {
	if (typeof window === "undefined") return;
	if (document.documentElement.dataset.crSidebarAccordionInstalled === "true") return;
	document.documentElement.dataset.crSidebarAccordionInstalled = "true";

	let programmatic = false;

	document.addEventListener("click", (event) => {
		if (programmatic) return;

		const target = event.target as HTMLElement | null;
		// The clickable header is `.item` inside a collapsible level-0 sidebar section
		const clickedItem = target?.closest?.(".VPSidebarItem.level-0.collapsible > .item");
		if (!(clickedItem instanceof HTMLElement)) return;

		const clickedSection = clickedItem.closest(".VPSidebarItem.level-0.collapsible");
		if (!clickedSection) return;

		// Wait for Vue to update the collapsed class after toggle
		requestAnimationFrame(() => {
			// If the clicked section is now collapsed, the user collapsed it — nothing to do
			if (clickedSection.classList.contains("collapsed")) return;

			// Collapse all other expanded sections
			const allSections = document.querySelectorAll<HTMLElement>(
				".VPSidebarItem.level-0.collapsible:not(.collapsed)",
			);

			programmatic = true;
			for (const section of allSections) {
				if (section === clickedSection) continue;
				const item = section.querySelector<HTMLElement>(":scope > .item");
				item?.click();
			}
			programmatic = false;
		});
	});
}

export default {
	extends: DefaultTheme,
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
