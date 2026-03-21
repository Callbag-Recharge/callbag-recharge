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
		// (H1 MarkdownEditor, H2 AIChat, H3 WorkflowBuilder — pending)

		// -- Code examples (with source panel, for doc pages) --
		app.component(
			"AirflowDemo",
			defineAsyncComponent(() => import("./components/examples/AirflowPipeline/AirflowDemo.vue")),
		);
	},
} satisfies Theme;
