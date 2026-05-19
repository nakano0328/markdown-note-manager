<script lang="ts">
	import { AlertCircle, Eye, Loader2 } from 'lucide-svelte';
	import { renderMarkdown } from '$lib/markdown/render';

	type ScrollSource = 'editor' | 'preview';

	interface Props {
		content: string;
		filePath: string;
		loading?: boolean;
		scrollRatio?: number;
		scrollSource?: ScrollSource | null;
		onScrollRatioChange?: (ratio: number, source: ScrollSource) => void;
	}

	let {
		content,
		filePath,
		loading = false,
		scrollRatio = 0,
		scrollSource = null,
		onScrollRatioChange
	}: Props = $props();

	const RENDER_DEBOUNCE_MS = 150;

	let html = $state('');
	let renderError = $state<string | null>(null);
	let rendering = $state(false);
	let previewScroller = $state<HTMLDivElement | null>(null);
	let syncingScroll = false;
	let renderId = 0;
	let lastRenderedSource: string | null = null;
	let lastRenderedPath: string | null = null;

	$effect(() => {
		const source = content;
		const path = filePath;

		// 既にレンダリング済みの内容と一致する場合は再描画しない
		if (source === lastRenderedSource && path === lastRenderedPath) return;

		let cancelled = false;
		const id = ++renderId;
		// 入力が止まるまで描画を遅らせる
		const timer = setTimeout(() => {
			if (cancelled) return;
			rendering = true;
			renderError = null;

			renderMarkdown(source, { filePath: path })
				.then((nextHtml) => {
					if (cancelled || id !== renderId) return;
					html = nextHtml;
					lastRenderedSource = source;
					lastRenderedPath = path;
				})
				.catch((e) => {
					if (cancelled || id !== renderId) return;
					renderError = e instanceof Error ? e.message : 'プレビューの生成に失敗しました';
				})
				.finally(() => {
					if (cancelled || id !== renderId) return;
					rendering = false;
				});
		}, RENDER_DEBOUNCE_MS);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

	$effect(() => {
		const scroller = previewScroller;
		const ratio = scrollRatio;
		const source = scrollSource;
		const currentHtml = html;
		void currentHtml;

		if (!scroller || source === 'preview') return;

		requestAnimationFrame(() => {
			applyScrollRatio(scroller, ratio);
		});
	});

	function handleScroll() {
		if (!previewScroller || syncingScroll) return;
		onScrollRatioChange?.(getScrollRatio(previewScroller), 'preview');
	}

	function applyScrollRatio(element: HTMLElement, ratio: number) {
		const maxScroll = element.scrollHeight - element.clientHeight;
		const nextScrollTop = maxScroll <= 0 ? 0 : maxScroll * ratio;
		if (Math.abs(element.scrollTop - nextScrollTop) < 1) return;

		syncingScroll = true;
		element.scrollTop = nextScrollTop;
		requestAnimationFrame(() => {
			syncingScroll = false;
		});
	}

	function getScrollRatio(element: HTMLElement) {
		const maxScroll = element.scrollHeight - element.clientHeight;
		if (maxScroll <= 0) return 0;
		return element.scrollTop / maxScroll;
	}
</script>

<section class="flex h-full min-h-0 flex-col bg-white text-black">
	<div class="flex h-11 shrink-0 items-center justify-between border-b border-black px-3">
		<div class="flex min-w-0 items-center gap-2">
			<Eye class="size-4 shrink-0 text-neutral-500" />
			<div class="min-w-0 truncate text-sm font-medium">プレビュー</div>
		</div>
		{#if rendering || loading}
			<div class="flex shrink-0 items-center gap-1.5 text-xs text-neutral-500">
				<Loader2 class="size-3.5 animate-spin" />
				描画中
			</div>
		{/if}
	</div>

	<div bind:this={previewScroller} onscroll={handleScroll} class="min-h-0 flex-1 overflow-auto px-5 py-4">
		{#if renderError}
			<div class="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
				<AlertCircle class="mt-0.5 size-4 shrink-0" />
				<div>{renderError}</div>
			</div>
		{:else}
			<article class="note-preview prose prose-neutral max-w-none">
				{@html html}
			</article>
		{/if}
	</div>
</section>
