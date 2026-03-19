import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { defineAsyncComponent } from "vue";
import HomeLayout from "./components/HomeLayout.vue";
import "./custom.css";

export default {
	extends: DefaultTheme,
	enhanceApp({ app }) {
		app.component("HomeLayout", HomeLayout);
		if (!import.meta.env.SSR) {
			app.component(
				"AirflowDemo",
				defineAsyncComponent(() => import("./components/AirflowDemo.vue")),
			);
		}
	},
} satisfies Theme;
