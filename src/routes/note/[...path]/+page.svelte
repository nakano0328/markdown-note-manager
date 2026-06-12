<script lang="ts">
	import { page } from '$app/state';
	import { beforeNavigate, goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Check, Loader2, Pencil, X } from 'lucide-svelte';
	import EditorPane from '$lib/components/EditorPane.svelte';
	import PreviewPane from '$lib/components/PreviewPane.svelte';
	import { markNotesDirty } from '$lib/notes-sync';
	import { treeState } from '$lib/stores/tree-state.svelte';
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
	let titleDraft = $state('');
	let titleInput = $state<HTMLInputElement | null>(null);
	let isTitleEditing = $state(false);
	let renameStatus = $state<'idle' | 'renaming' | 'error'>('idle');
	let renameError = $state<string | null>(null);
	let requestId = 0;
	let saveRequestId = 0;

	const hasUnsavedChanges = $derived(!loading && content !== lastSavedContent);
	const currentTitle = $derived(titleFromPath(filePath));
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

	beforeNavigate((navigation) => {
		if (!hasUnsavedChanges) return;
		if (navigation.willUnload) {
			navigation.cancel();
			return;
		}
		if (!confirm('未保存の変更があります。保存せずに移動しますか？')) {
			navigation.cancel();
		}
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
		titleDraft = titleFromPath(path);
		isTitleEditing = false;
		renameStatus = 'idle';
		renameError = null;

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
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!hasUnsavedChanges) return;
			event.preventDefault();
			event.returnValue = '';
		};

		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('beforeunload', handleBeforeUnload);

		return () => {
			window.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('beforeunload', handleBeforeUnload);
			clearSaveTimer();
			abortSaveRequest();
		};
	});

	async function saveContent(): Promise<boolean> {
		const path = filePath;
		const snapshot = content;

		clearSaveTimer();

		if (loading || !path) return false;
		if (snapshot === lastSavedContent) {
			saveError = null;
			saveStatus = 'saved';
			return true;
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

			if (controller.signal.aborted || id !== saveRequestId) return false;

			lastSavedContent = snapshot;
			lastSavedAt = new Date();
			saveStatus = content === snapshot ? 'saved' : 'pending';
			markNotesDirty();
			return true;
		} catch (e) {
			if (controller.signal.aborted || id !== saveRequestId) return false;
			saveStatus = 'error';
			saveError = e instanceof Error ? e.message : '保存に失敗しました';
			return false;
		} finally {
			if (saveController === controller) saveController = null;
		}
	}

	async function renameNote() {
		const path = filePath;
		const nextTitle = titleDraft.trim();
		if (loading || renameStatus === 'renaming' || !path) return;
		if (!nextTitle) {
			renameStatus = 'error';
			renameError = 'タイトルを入力してください';
			return;
		}
		if (nextTitle === currentTitle) {
			isTitleEditing = false;
			return;
		}

		renameStatus = 'renaming';
		renameError = null;

		const saved = await saveContent();
		if (!saved) {
			renameStatus = 'error';
			renameError = saveError ?? 'リネーム前の保存に失敗しました';
			return;
		}

		try {
			const res = await fetch('/api/file', {
				method: 'PATCH',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ path, title: nextTitle })
			});
			const body = (await res.json().catch(() => ({ message: res.statusText }))) as {
				path?: string;
				content?: string;
				message?: string;
			};

			if (!res.ok || !body.path || typeof body.content !== 'string') {
				throw new Error(body.message ?? `タイトル変更に失敗しました (${res.status})`);
			}

			content = body.content;
			lastSavedContent = body.content;
			lastSavedAt = new Date();
			saveStatus = 'saved';
			titleDraft = nextTitle;
			isTitleEditing = false;
			renameStatus = 'idle';
			renameError = null;
			markNotesDirty();
			treeState.revealFile(body.path);
			await goto(`/note/${encodeNotePath(body.path)}`, { replaceState: true });
		} catch (e) {
			renameStatus = 'error';
			renameError = e instanceof Error ? e.message : 'タイトル変更に失敗しました';
		}
	}

	function resetTitleDraft() {
		titleDraft = currentTitle;
		isTitleEditing = false;
		renameStatus = 'idle';
		renameError = null;
	}

	function startTitleEditing() {
		if (loading || renameStatus === 'renaming') return;
		titleDraft = currentTitle;
		isTitleEditing = true;
		renameStatus = 'idle';
		renameError = null;
		requestAnimationFrame(() => {
			titleInput?.focus();
			titleInput?.select();
		});
	}

	function handleTitleKeydown(event: KeyboardEvent) {
		if (!isTitleEditing) return;
		if (event.key === 'Enter') {
			event.preventDefault();
			void renameNote();
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			resetTitleDraft();
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

	function titleFromPath(pathValue: string): string {
		const filename = pathValue.split('/').pop() ?? '';
		const match = filename.match(/^(\d{2})_(.+)\.md$/);
		if (match) return match[2];
		return filename.replace(/\.md$/i, '');
	}

	function encodeNotePath(rel: string): string {
		return rel.split('/').map(encodeURIComponent).join('/');
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

	<div class="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
		<div class="flex min-w-0 flex-1 items-center gap-1.5">
			<input
				bind:this={titleInput}
				class={cn(
					'min-w-0 flex-1 rounded border px-2 py-1 text-sm font-medium text-foreground outline-none',
					isTitleEditing
						? 'bg-background focus:border-primary'
						: 'border-transparent bg-transparent'
				)}
				aria-label="ノートタイトル"
				bind:value={titleDraft}
				onkeydown={handleTitleKeydown}
				readonly={!isTitleEditing}
				disabled={loading || renameStatus === 'renaming'}
			/>
			{#if !isTitleEditing}
				<button
					type="button"
					class="inline-flex size-7 shrink-0 items-center justify-center rounded border bg-background text-muted-foreground hover:bg-accent disabled:opacity-60"
					aria-label="タイトルを編集"
					title="タイトルを編集"
					onclick={startTitleEditing}
					disabled={loading || renameStatus === 'renaming'}
				>
					<Pencil class="size-3.5" />
				</button>
			{:else}
				<button
					type="button"
					class="inline-flex size-7 shrink-0 items-center justify-center rounded border bg-background text-foreground hover:bg-accent disabled:opacity-60"
					aria-label="タイトルを変更"
					title="タイトルを変更"
					onclick={() => void renameNote()}
					disabled={loading || renameStatus === 'renaming'}
				>
					{#if renameStatus === 'renaming'}
						<Loader2 class="size-3.5 animate-spin" />
					{:else}
						<Check class="size-3.5" />
					{/if}
				</button>
				<button
					type="button"
					class="inline-flex size-7 shrink-0 items-center justify-center rounded border bg-background text-muted-foreground hover:bg-accent disabled:opacity-60"
					aria-label="タイトル変更を取り消し"
					title="タイトル変更を取り消し"
					onclick={resetTitleDraft}
					disabled={renameStatus === 'renaming'}
				>
					<X class="size-3.5" />
				</button>
			{/if}
		</div>
		{#if renameError}
			<span class="hidden max-w-[16rem] truncate text-red-600 md:inline" title={renameError}>
				{renameError}
			</span>
		{/if}
		<span
			class={cn(
				'shrink-0 truncate',
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
