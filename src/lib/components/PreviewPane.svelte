<script lang="ts">
	import { AlertCircle, Eye, Loader2 } from 'lucide-svelte';
	import { renderMarkdown } from '$lib/markdown/render';

	interface Props {
		content: string;
		filePath: string;
		loading?: boolean;
	}

	let { content, filePath, loading = false }: Props = $props();

	let html = $state('');
	let renderError = $state<string | null>(null);
	let rendering = $state(false);
	let renderId = 0;

	$effect(() => {
		const source = content;
		const path = filePath;
		let cancelled = false;
		const id = ++renderId;

		rendering = true;
		renderError = null;

		renderMarkdown(source, { filePath: path })
			.then((nextHtml) => {
				if (cancelled || id !== renderId) return;
				html = nextHtml;
			})
			.catch((e) => {
				if (cancelled || id !== renderId) return;
				renderError = e instanceof Error ? e.message : 'プレビューの生成に失敗しました';
			})
			.finally(() => {
				if (cancelled || id !== renderId) return;
				rendering = false;
			});

		return () => {
			cancelled = true;
		};
	});
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

	<div class="min-h-0 flex-1 overflow-auto px-5 py-4">
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
