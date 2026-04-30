<script lang="ts">
	import { page } from '$app/state';
	import EditorPane from '$lib/components/EditorPane.svelte';
	import PreviewPane from '$lib/components/PreviewPane.svelte';
	import { cn } from '$lib/utils';

	type ViewMode = 'editor' | 'preview';

	const filePath = $derived(safeDecode(page.params.path ?? ''));

	let content = $state('');
	let loading = $state(true);
	let errorMessage = $state<string | null>(null);
	let activeView = $state<ViewMode>('editor');
	let requestId = 0;

	$effect(() => {
		const path = filePath;
		const id = ++requestId;
		const controller = new AbortController();

		content = '';
		errorMessage = null;
		loading = true;

		if (!path) {
			errorMessage = 'ファイルパスが指定されていません';
			loading = false;
			return;
		}

		fetch(`/api/file?path=${encodeURIComponent(path)}`, {
			signal: controller.signal
		})
			.then(async (res) => {
				if (!res.ok) {
					const body = (await res.json().catch(() => ({ message: res.statusText }))) as {
						message?: string;
					};
					throw new Error(body.message ?? `ファイルを読み込めませんでした (${res.status})`);
				}
				return (await res.json()) as { path: string; content: string };
			})
			.then((data) => {
				if (id !== requestId) return;
				content = data.content;
			})
			.catch((e) => {
				if (controller.signal.aborted || id !== requestId) return;
				errorMessage = e instanceof Error ? e.message : 'ファイルを読み込めませんでした';
			})
			.finally(() => {
				if (controller.signal.aborted || id !== requestId) return;
				loading = false;
			});

		return () => {
			controller.abort();
		};
	});

	function safeDecode(value: string): string {
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}
</script>

<div class="flex h-full min-h-[calc(100vh-3rem)] flex-col bg-background">
	<div class="shrink-0 border-b px-3 py-2 lg:hidden">
		<div class="grid w-full grid-cols-2 rounded border bg-muted p-0.5">
			<button
				type="button"
				onclick={() => (activeView = 'editor')}
				class={cn(
					'rounded px-3 py-1 text-xs font-medium',
					activeView === 'editor' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
				)}
			>
				編集
			</button>
			<button
				type="button"
				onclick={() => (activeView = 'preview')}
				class={cn(
					'rounded px-3 py-1 text-xs font-medium',
					activeView === 'preview' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
				)}
			>
				プレビュー
			</button>
		</div>
	</div>

	<div class="min-h-0 flex-1 lg:grid lg:grid-cols-2">
		<div
			class={cn(
				'h-full min-h-0 border-r',
				activeView === 'editor' ? 'block' : 'hidden',
				'lg:block'
			)}
		>
			<EditorPane bind:value={content} {filePath} {loading} {errorMessage} />
		</div>
		<div
			class={cn('h-full min-h-0', activeView === 'preview' ? 'block' : 'hidden', 'lg:block')}
		>
			<PreviewPane {content} {filePath} {loading} />
		</div>
	</div>
</div>
