import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";

type FitViewOptions = {
	padding?: number;
	duration?: number;
};

type FlowLike = {
	fitView: (options?: FitViewOptions) => void;
};

type UseAutoFitFlowOptions = {
	panelRef: { value: HTMLElement | null };
	watchSources?: Array<() => unknown>;
	padding?: number;
	duration?: number;
};

export function useAutoFitFlow({
	panelRef,
	watchSources = [],
	padding = 0.2,
	duration = 180,
}: UseAutoFitFlowOptions) {
	const flowInstance = ref<FlowLike | null>(null);
	let resizeObserver: ResizeObserver | null = null;

	function fitGraph() {
		if (!flowInstance.value) return;
		requestAnimationFrame(() => {
			flowInstance.value?.fitView({ padding, duration });
		});
	}

	function onFlowInit(instance: FlowLike) {
		flowInstance.value = instance;
		fitGraph();
	}

	if (watchSources.length > 0) {
		watch(watchSources, async () => {
			await nextTick();
			fitGraph();
		});
	}

	onMounted(() => {
		if (!panelRef.value) return;
		resizeObserver = new ResizeObserver(() => {
			fitGraph();
		});
		resizeObserver.observe(panelRef.value);
	});

	onUnmounted(() => {
		resizeObserver?.disconnect();
		resizeObserver = null;
	});

	return {
		onFlowInit,
		fitGraph,
	};
}
