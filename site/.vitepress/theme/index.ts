import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { defineAsyncComponent } from "vue";
import HomeLayout from "./components/HomeLayout.vue";
import "./custom.css";

export default {
	extends: DefaultTheme,
	enhanceApp({ app }) {
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
