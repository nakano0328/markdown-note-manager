<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import EditorPane from '$lib/components/EditorPane.svelte';
	import PreviewPane from '$lib/components/PreviewPane.svelte';
	import { cn } from '$lib/utils';

	type ViewMode = 'editor' | 'preview';
	type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
	type ScrollSource = 'editor' | 'preview';

	const AUTOSAVE_DELAY_MS = 30_000;
	const filePath = $derived(safeDecode(page.params.path ?? ''));

	let content = $state('');
	let lastSavedContent = $state('');
	let loading = $state(true);
	let errorMessage = $state<string | null>(null);
	let activeView = $state<ViewMode>('editor');
	let saveStatus = $state<SaveStatus>('idle');
	let saveError = $state<string | null>(null);
	let lastSavedAt = $state<Date | null>(null);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let saveController: AbortController | null = null;
	let scrollRatio = $state(0);
	let scrollSource = $state<ScrollSource | null>(null);
	let requestId = 0;
	let saveRequestId = 0;

	const saveStatusText = $derived.by(() => {
		if (loading) return '読み込み中';
		if (saveStatus === 'pending') return '保存待ち';
		if (saveStatus === 'saving') return '保存中';
		if (saveStatus === 'error') return saveError ? `保存失敗: ${saveError}` : '保存失敗';
		if (saveStatus === 'saved') {
			return lastSavedAt ? `保存済み ${formatTime(lastSavedAt)}` : '保存済み';
		}
		return content === lastSavedContent ? '保存済み' : '未保存';
	});

	$effect(() => {
		const path = filePath;
		const id = ++requestId;
		const controller = new AbortController();

		clearSaveTimer();
		abortSaveRequest();
		content = '';
		lastSavedContent = '';
		errorMessage = null;
		saveError = null;
		saveStatus = 'idle';
		lastSavedAt = null;
		scrollRatio = 0;
		scrollSource = null;
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
				lastSavedContent = data.content;
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

	$effect(() => {
		const path = filePath;
		const currentContent = content;
		const savedContent = lastSavedContent;

		if (loading || !path || currentContent === savedContent) {
			clearSaveTimer();
			return;
		}

		saveError = null;
		saveStatus = 'pending';

		// 入力が止まってから一定時間後に保存する。
		const timer = setTimeout(() => {
			void saveContent();
		}, AUTOSAVE_DELAY_MS);
		saveTimer = timer;

		return () => {
			if (saveTimer === timer) saveTimer = null;
			clearTimeout(timer);
		};
	});

	onMount(() => {
		const handleKeydown = (event: KeyboardEvent) => {
			if (!(event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey))) return;
			event.preventDefault();
			void saveContent();
		};

		window.addEventListener('keydown', handleKeydown);

		return () => {
			window.removeEventListener('keydown', handleKeydown);
			clearSaveTimer();
			abortSaveRequest();
		};
	});

	async function saveContent() {
		const path = filePath;
		const snapshot = content;

		clearSaveTimer();

		if (loading || !path) return;
		if (snapshot === lastSavedContent) {
			saveError = null;
			saveStatus = 'saved';
			return;
		}

		const id = ++saveRequestId;
		abortSaveRequest();
		const controller = new AbortController();
		saveController = controller;
		saveStatus = 'saving';
		saveError = null;

		try {
			const res = await fetch('/api/file', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ path, content: snapshot }),
				signal: controller.signal
			});

			if (!res.ok) {
				const body = (await res.json().catch(() => ({ message: res.statusText }))) as {
					message?: string;
				};
				throw new Error(body.message ?? `保存に失敗しました (${res.status})`);
			}

			if (controller.signal.aborted || id !== saveRequestId) return;

			lastSavedContent = snapshot;
			lastSavedAt = new Date();
			saveStatus = content === snapshot ? 'saved' : 'pending';
		} catch (e) {
			if (controller.signal.aborted || id !== saveRequestId) return;
			saveStatus = 'error';
			saveError = e instanceof Error ? e.message : '保存に失敗しました';
		} finally {
			if (saveController === controller) saveController = null;
		}
	}

	function clearSaveTimer() {
		if (!saveTimer) return;
		clearTimeout(saveTimer);
		saveTimer = null;
	}

	function abortSaveRequest() {
		saveController?.abort();
		saveController = null;
	}

	function formatTime(date: Date): string {
		return date.toLocaleTimeString('ja-JP', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function handleScrollRatioChange(ratio: number, source: ScrollSource) {
		scrollRatio = Math.min(Math.max(ratio, 0), 1);
		scrollSource = source;
	}

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
				エディタ
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

	<div class="flex h-8 shrink-0 items-center justify-end border-b px-3 text-xs text-muted-foreground">
		<span
			class={cn(
				'truncate',
				saveStatus === 'error' && 'text-red-600',
				saveStatus === 'saving' && 'text-blue-600',
				saveStatus === 'pending' && 'text-amber-700'
			)}
			title={saveStatusText}
		>
			{saveStatusText}
		</span>
	</div>

	<div class="min-h-0 flex-1 lg:grid lg:grid-cols-2">
		<div
			class={cn(
				'h-full min-h-0 border-r',
				activeView === 'editor' ? 'block' : 'hidden',
				'lg:block'
			)}
		>
			<EditorPane
				bind:value={content}
				{filePath}
				{loading}
				{errorMessage}
				{scrollRatio}
				{scrollSource}
				onScrollRatioChange={handleScrollRatioChange}
			/>
		</div>
		<div
			class={cn('h-full min-h-0', activeView === 'preview' ? 'block' : 'hidden', 'lg:block')}
		>
			<PreviewPane
				{content}
				{filePath}
				{loading}
				{scrollRatio}
				{scrollSource}
				onScrollRatioChange={handleScrollRatioChange}
			/>
		</div>
	</div>
</div>
