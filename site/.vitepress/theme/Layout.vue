<script setup lang="ts">
import { useData } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { computed } from "vue";

const { frontmatter, page } = useData();

/** Long-form date for blog articles; ISO `date` lives in frontmatter only. */
const blogPublishedLabel = computed(() => {
	const raw = frontmatter.value.date;
	if (raw == null || raw === "") return "";
	const path = page.value.relativePath ?? "";
	if (!path.startsWith("blog/") || path === "blog/index.md") return "";

	const s = String(raw).trim();
	// YAML date-only → local noon to avoid TZ shifting the calendar day
	const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s;
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return "";

	return new Intl.DateTimeFormat("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
	}).format(new Date(t));
});
</script>

<template>
	<DefaultTheme.Layout>
		<template #layout-top>
			<div class="cr-deprecation-banner">
				<strong>This project has been succeeded by <a href="https://graphrefly.dev">GraphReFly</a>.</strong>
				New development happens at <a href="https://github.com/graphrefly/graphrefly-ts">graphrefly-ts</a>.
				<code>npm install @graphrefly/graphrefly</code>
			</div>
		</template>
		<template #doc-before>
			<p v-if="blogPublishedLabel" class="cr-blog-published">{{ blogPublishedLabel }}</p>
		</template>
	</DefaultTheme.Layout>
</template>
