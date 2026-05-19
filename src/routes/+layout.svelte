<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import NewNoteModal from '$lib/components/NewNoteModal.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		Home,
		PanelLeftClose,
		PanelLeft,
		UploadCloud,
		CalendarDays,
		Loader2,
		CheckCircle2,
		AlertCircle
	} from 'lucide-svelte';
	import { cn } from '$lib/utils';
	import { newNote } from '$lib/stores/new-note.svelte';
	import { treeState } from '$lib/stores/tree-state.svelte';

	let { children } = $props();

	let sidebarOpen = $state(true);

	type PushStatus = 'idle' | 'pushing' | 'success' | 'error' | 'noop';
	let pushStatus = $state<PushStatus>('idle');
	let pushMessage = $state<string | null>(null);
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

	async function handlePush() {
		if (pushStatus === 'pushing') return;
		if (pushResetTimer) {
			clearTimeout(pushResetTimer);
			pushResetTimer = null;
		}
		pushStatus = 'pushing';
		pushMessage = null;
		try {
			const res = await fetch('/api/git/push', { method: 'POST' });
			const body = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				pushed?: boolean;
				message?: string;
				commitMessage?: string | null;
			};
			if (!res.ok || !body.ok) {
				throw new Error(body.message ?? `Push に失敗しました (${res.status})`);
			}
			if (body.pushed) {
				pushStatus = 'success';
				pushMessage = body.commitMessage ?? body.message ?? 'Pushed';
			} else {
				pushStatus = 'noop';
				pushMessage = body.message ?? 'No changes';
			}
			schedulePushReset();
		} catch (e) {
			pushStatus = 'error';
			pushMessage = e instanceof Error ? e.message : 'Push に失敗しました';
			schedulePushReset(8000);
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
						: 'bg-primary text-primary-foreground hover:bg-primary/90';
	}

	function encodeNotePath(rel: string): string {
		return rel.split('/').map(encodeURIComponent).join('/');
	}
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
			<button
				type="button"
				onclick={handlePush}
				disabled={pushStatus === 'pushing'}
				class={cn(
					'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition disabled:opacity-70',
					pushIconClasses()
				)}
				title={pushMessage ?? 'NOTES_DIR のローカル変更を git add/commit/push'}
			>
				{#if pushStatus === 'pushing'}
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
				{:else}
					Push
				{/if}
			</button>
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
