import { onUnmounted, watch } from "vue";

type BoolRef = { value: boolean };

export function useLockPageScroll(active: BoolRef) {
	const prevHtmlOverflow = { value: "" };
	const prevBodyOverflow = { value: "" };

	watch(
		() => active.value,
		(enabled) => {
			if (typeof document === "undefined") return;
			if (enabled) {
				prevHtmlOverflow.value = document.documentElement.style.overflow;
				prevBodyOverflow.value = document.body.style.overflow;
				document.documentElement.style.overflow = "hidden";
				document.body.style.overflow = "hidden";
				return;
			}
			document.documentElement.style.overflow = prevHtmlOverflow.value;
			document.body.style.overflow = prevBodyOverflow.value;
		},
		{ immediate: true },
	);

	onUnmounted(() => {
		if (typeof document === "undefined") return;
		document.documentElement.style.overflow = prevHtmlOverflow.value;
		document.body.style.overflow = prevBodyOverflow.value;
	});
}
