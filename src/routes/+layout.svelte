<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import NewNoteModal from '$lib/components/NewNoteModal.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import {
		Home,
		PanelLeftClose,
		PanelLeft,
		UploadCloud,
		CalendarDays,
		Loader2,
		CheckCircle2,
		AlertCircle,
		ChevronDown
	} from 'lucide-svelte';
	import { cn } from '$lib/utils';
	import { NOTES_DIRTY_EVENT } from '$lib/notes-sync';
	import { newNote } from '$lib/stores/new-note.svelte';
	import { treeState } from '$lib/stores/tree-state.svelte';

	let { children } = $props();

	let sidebarOpen = $state(true);

	type PushStatus = 'idle' | 'pushing' | 'success' | 'error' | 'noop';
	let pushStatus = $state<PushStatus>('idle');
	let pushMessage = $state<string | null>(null);
	let hasPendingChanges = $state(false);
	let pendingFileCount = $state(0);
	let pendingFilePaths = $state<string[]>([]);
	let otherChangedFileCount = $state(0);
	let aheadCommitCount = $state(0);
	let pushMenuOpen = $state(false);
	let activePushPath = $state<string | null>(null);
	let pushResetTimer: ReturnType<typeof setTimeout> | null = null;

	const breadcrumbs = $derived.by(() => {
		const url = page.url.pathname;
		if (url === '/') return ['Home'];
		if (url === '/calendar') return ['カレンダー'];
		if (url.startsWith('/note/')) {
			const rest = decodeURIComponent(url.replace(/^\/note\//, ''));
			return ['Notes', ...rest.split('/')];
		}
		return [url];
	});

	function schedulePushReset(delay = 4000) {
		if (pushResetTimer) clearTimeout(pushResetTimer);
		pushResetTimer = setTimeout(() => {
			pushStatus = 'idle';
			pushMessage = null;
			pushResetTimer = null;
		}, delay);
	}

	async function handlePush(files: string[] | null = null) {
		if (pushStatus === 'pushing') return;
		if (pushResetTimer) {
			clearTimeout(pushResetTimer);
			pushResetTimer = null;
		}
		pushStatus = 'pushing';
		pushMessage = null;
		activePushPath = files?.length === 1 ? files[0] : null;
		try {
			const res = await fetch('/api/git/push', {
				method: 'POST',
				headers: files ? { 'content-type': 'application/json' } : undefined,
				body: files ? JSON.stringify({ files }) : undefined
			});
			const body = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				pushed?: boolean;
				message?: string;
				commitMessage?: string | null;
				pendingFiles?: number;
				pendingFilePaths?: string[];
				otherChangedFiles?: number;
				ahead?: number;
			};
			if (!res.ok || !body.ok) {
				throw new Error(body.message ?? `Push に失敗しました (${res.status})`);
			}
			pendingFileCount = body.pendingFiles ?? 0;
			pendingFilePaths = body.pendingFilePaths ?? [];
			otherChangedFileCount = body.otherChangedFiles ?? 0;
			aheadCommitCount = body.ahead ?? 0;
			if (body.pushed) {
				pushStatus = 'success';
				hasPendingChanges = pendingFileCount > 0 || aheadCommitCount > 0;
				pushMessage = body.commitMessage ?? body.message ?? 'Pushed';
			} else {
				pushStatus = 'noop';
				hasPendingChanges = pendingFileCount > 0 || aheadCommitCount > 0;
				pushMessage = body.message ?? 'No changes';
			}
			void loadGitStatus();
			if (pendingFileCount === 0) pushMenuOpen = false;
			schedulePushReset();
		} catch (e) {
			pushStatus = 'error';
			pushMessage = e instanceof Error ? e.message : 'Push に失敗しました';
			schedulePushReset(8000);
		} finally {
			activePushPath = null;
		}
	}

	function pushIconClasses() {
		return pushStatus === 'pushing'
			? 'bg-primary text-primary-foreground'
			: pushStatus === 'success'
				? 'bg-emerald-600 text-white'
				: pushStatus === 'noop'
					? 'bg-muted text-foreground'
					: pushStatus === 'error'
						? 'bg-red-600 text-white'
						: hasPendingChanges
							? 'bg-amber-500 text-white hover:bg-amber-600'
							: 'bg-primary text-primary-foreground hover:bg-primary/90';
	}

	function encodeNotePath(rel: string): string {
		return rel.split('/').map(encodeURIComponent).join('/');
	}

	function fileLabel(pathValue: string): string {
		return pathValue.split('/').at(-1) ?? pathValue;
	}

	async function loadGitStatus() {
		try {
			const res = await fetch('/api/git/status');
			if (!res.ok) return;
			const body = (await res.json()) as {
				dirty?: boolean;
				pendingFiles?: number;
				pendingFilePaths?: string[];
				otherChangedFiles?: number;
				ahead?: number;
			};
			hasPendingChanges = Boolean(body.dirty);
			pendingFileCount = body.pendingFiles ?? 0;
			pendingFilePaths = body.pendingFilePaths ?? [];
			otherChangedFileCount = body.otherChangedFiles ?? 0;
			aheadCommitCount = body.ahead ?? 0;
			if (pendingFilePaths.length === 0) pushMenuOpen = false;
		} catch {
			// git 状態の表示に失敗しても編集操作は妨げない。
		}
	}

	onMount(() => {
		const handleNotesDirty = () => {
			hasPendingChanges = true;
			pendingFileCount = Math.max(pendingFileCount, 1);
			if (pushStatus === 'noop') {
				pushStatus = 'idle';
				pushMessage = null;
			}
			void loadGitStatus();
		};

		window.addEventListener(NOTES_DIRTY_EVENT, handleNotesDirty);
		void loadGitStatus();

		return () => {
			window.removeEventListener(NOTES_DIRTY_EVENT, handleNotesDirty);
		};
	});

	onDestroy(() => {
		if (pushResetTimer) clearTimeout(pushResetTimer);
	});
</script>

<div class="flex h-screen w-screen flex-col overflow-hidden">
	<header class="flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-sidebar-bg px-3">
		<div class="flex min-w-0 flex-1 items-center gap-2">
			<button
				type="button"
				onclick={() => (sidebarOpen = !sidebarOpen)}
				class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
				aria-label="Toggle sidebar"
				title="Toggle sidebar"
			>
				{#if sidebarOpen}
					<PanelLeftClose class="size-4" />
				{:else}
					<PanelLeft class="size-4" />
				{/if}
			</button>
			<a
				href="/"
				class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
				aria-label="ホームへ戻る"
				title="ホームへ戻る"
			>
				<Home class="size-4" />
			</a>
			<a
				href="/calendar"
				class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
				aria-label="カレンダーを開く"
				title="カレンダー"
			>
				<CalendarDays class="size-4" />
			</a>
			<nav class="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-sm">
				{#each breadcrumbs as crumb, i (i)}
					{#if i > 0}
						<span class="shrink-0 text-muted-foreground">/</span>
					{/if}
					<span
						class={cn(
							'shrink-0',
							i === breadcrumbs.length - 1 ? 'font-medium' : 'text-muted-foreground'
						)}
					>
						{crumb}
					</span>
				{/each}
			</nav>
		</div>
		<div class="flex shrink-0 items-center gap-2">
			{#if pushMessage}
				<span
					class={cn(
						'hidden max-w-[18rem] truncate text-[11px] md:inline',
						pushStatus === 'error' && 'text-red-600',
						pushStatus === 'success' && 'text-emerald-700',
						pushStatus === 'noop' && 'text-muted-foreground'
					)}
					title={pushMessage}
				>
					{pushMessage}
				</span>
			{/if}
			<div class="relative flex shrink-0 items-center">
				<button
					type="button"
					onclick={() => void handlePush()}
					disabled={pushStatus === 'pushing'}
					class={cn(
						'inline-flex items-center gap-1.5 rounded-l px-3 py-1.5 text-xs font-medium transition disabled:opacity-70',
						pendingFilePaths.length > 0 ? 'rounded-r-none' : 'rounded-r',
						pushIconClasses()
					)}
					title={
						pushMessage ??
						(hasPendingChanges
							? `未同期の対象変更 ${pendingFileCount} 件、未 push commit ${aheadCommitCount} 件`
							: otherChangedFileCount > 0
								? `対象外の変更 ${otherChangedFileCount} 件は push しません`
								: 'アプリで保存した変更を git add/commit/push')
					}
				>
					{#if pushStatus === 'pushing' && activePushPath === null}
						<Loader2 class="size-3.5 animate-spin" />
					{:else if pushStatus === 'success'}
						<CheckCircle2 class="size-3.5" />
					{:else if pushStatus === 'error'}
						<AlertCircle class="size-3.5" />
					{:else}
						<UploadCloud class="size-3.5" />
					{/if}
					{#if pushStatus === 'pushing'}
						Pushing…
					{:else if pushStatus === 'success'}
						Pushed
					{:else if pushStatus === 'error'}
						Push 失敗
					{:else if pushStatus === 'noop'}
						変更なし
					{:else if hasPendingChanges}
						{pendingFileCount > 1 ? `未同期 ${pendingFileCount}` : '未同期'}
					{:else if otherChangedFileCount > 0}
						対象外あり
					{:else}
						Push
					{/if}
				</button>
				{#if pendingFilePaths.length > 0}
					<button
						type="button"
						onclick={() => (pushMenuOpen = !pushMenuOpen)}
						disabled={pushStatus === 'pushing'}
						class={cn(
							'inline-flex items-center justify-center rounded-r border-l border-black/10 px-2 py-1.5 text-xs font-medium transition disabled:opacity-70',
							pushIconClasses()
						)}
						aria-label="Push 対象を選択"
						title="Push 対象を選択"
					>
						<ChevronDown class={cn('size-3.5 transition', pushMenuOpen && 'rotate-180')} />
					</button>
				{/if}

				{#if pushMenuOpen && pendingFilePaths.length > 0}
					<div
						class="absolute right-0 top-full z-30 mt-2 w-[min(26rem,calc(100vw-1.5rem))] rounded border bg-background shadow-lg"
					>
						<div class="flex items-center justify-between gap-2 border-b px-3 py-2">
							<span class="min-w-0 truncate text-xs font-medium text-foreground">Push 対象</span>
							<button
								type="button"
								class="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-60"
								onclick={() => void handlePush()}
								disabled={pushStatus === 'pushing'}
							>
								<UploadCloud class="size-3" />
								すべて
							</button>
						</div>
						<div class="max-h-72 overflow-y-auto p-1">
							{#each pendingFilePaths as file (file)}
								<div class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent">
									<span class="min-w-0 flex-1 truncate text-[11px] text-foreground" title={file}>
										{fileLabel(file)}
									</span>
									<button
										type="button"
										class="inline-flex shrink-0 items-center gap-1 rounded border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-60"
										onclick={() => void handlePush([file])}
										disabled={pushStatus === 'pushing'}
										title={`${file} を push`}
									>
										{#if pushStatus === 'pushing' && activePushPath === file}
											<Loader2 class="size-3 animate-spin" />
										{:else}
											<UploadCloud class="size-3" />
										{/if}
										Push
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</header>

	<div class="flex min-h-0 flex-1">
		{#if sidebarOpen}
			<div class="w-[14rem] shrink-0 md:w-[16rem]">
				<Sidebar />
			</div>
		{/if}
		<main class="min-w-0 flex-1 overflow-auto">
			{@render children()}
		</main>
	</div>
</div>

<NewNoteModal
	open={newNote.open}
	directory={newNote.directory}
	subject={newNote.subject}
	titleHint={newNote.titleHint}
	onClose={() => newNote.close()}
	onCreated={(note) => {
		treeState.revealFile(note.path);
		newNote.close();
		void goto(`/note/${encodeNotePath(note.path)}`);
	}}
/>
