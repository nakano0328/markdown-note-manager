<script lang="ts">
	import { Loader2, AlertCircle, FileText, RefreshCw, CheckCircle2 } from 'lucide-svelte';
	import type { TaskItem } from '$lib/types';
	import { cn } from '$lib/utils';

	interface Props {
		tasks: TaskItem[];
		loading: boolean;
		errorMessage: string | null;
		onReload: () => void;
		onToggleTask: (task: TaskItem, isCompleted: boolean) => Promise<void> | void;
	}

	let { tasks, loading, errorMessage, onReload, onToggleTask }: Props = $props();

	let showCompleted = $state(false);
	let toggleError = $state<string | null>(null);
	let updatingTaskIds = $state<Set<string>>(new Set());

	const visibleTasks = $derived(showCompleted ? tasks : tasks.filter((t) => !t.isCompleted));
	const pendingCount = $derived(tasks.filter((t) => !t.isCompleted).length);
	const groupedTasks = $derived.by(() => {
		const groups = new Map<string, TaskItem[]>();
		for (const task of visibleTasks) {
			const arr = groups.get(task.subject) ?? [];
			arr.push(task);
			groups.set(task.subject, arr);
		}
		return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ja'));
	});

	function encodeFilePath(filePath: string): string {
		return filePath.split('/').map(encodeURIComponent).join('/');
	}

	async function handleToggle(task: TaskItem, isCompleted: boolean) {
		toggleError = null;
		updatingTaskIds = new Set(updatingTaskIds).add(task.id);
		try {
			await onToggleTask(task, isCompleted);
		} catch (e) {
			toggleError = e instanceof Error ? e.message : '課題の更新に失敗しました';
		} finally {
			const next = new Set(updatingTaskIds);
			next.delete(task.id);
			updatingTaskIds = next;
		}
	}
</script>

<section class="rounded-lg border bg-white p-4">
	<div class="mb-3 flex items-center justify-between">
		<h2 class="text-sm font-semibold">
			未完了の課題
			<span class="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
				{pendingCount}
			</span>
		</h2>
		<div class="flex items-center gap-2">
			<label class="flex items-center gap-1 text-xs text-muted-foreground">
				<input type="checkbox" bind:checked={showCompleted} class="size-3" />
				完了を表示
			</label>
			<button
				type="button"
				onclick={onReload}
				disabled={loading}
				class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
				aria-label="再読み込み"
				title="再読み込み"
			>
				<RefreshCw class={cn('size-4', loading && 'animate-spin')} />
			</button>
		</div>
	</div>

	{#if loading && tasks.length === 0}
		<div class="flex items-center gap-2 py-6 text-sm text-muted-foreground">
			<Loader2 class="size-4 animate-spin" /> 読み込み中…
		</div>
	{:else if errorMessage}
		<div class="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
			<AlertCircle class="mt-0.5 size-4 shrink-0" />
			<span>{errorMessage}</span>
		</div>
	{:else}
		{#if toggleError}
			<div class="mb-3 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
				<AlertCircle class="mt-0.5 size-4 shrink-0" />
				<span>{toggleError}</span>
			</div>
		{/if}

		{#if visibleTasks.length === 0}
			<div class="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
				<CheckCircle2 class="size-6 text-primary/60" />
				<span>{tasks.length === 0 ? '課題はありません' : 'すべて完了済みです'}</span>
			</div>
		{:else}
			<div class="space-y-3">
				{#each groupedTasks as [subject, items] (subject)}
					<div>
						<div class="mb-1 text-xs font-semibold text-muted-foreground">{subject}</div>
						<ul class="space-y-1">
							{#each items as task (task.id)}
								<li
									class={cn(
										'flex items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent',
										task.isCompleted && 'text-muted-foreground line-through'
									)}
								>
									<input
										type="checkbox"
										checked={task.isCompleted}
										disabled={loading || updatingTaskIds.has(task.id)}
										class="mt-1 size-3.5 shrink-0"
										aria-label={`${task.content} を${task.isCompleted ? '未完了' : '完了'}にする`}
										onchange={(event) => void handleToggle(task, event.currentTarget.checked)}
									/>
									<div class="min-w-0 flex-1">
										<div class="break-words">{task.content}</div>
										<a
											href={`/note/${encodeFilePath(task.filePath)}`}
											class="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
										>
											<FileText class="size-3" />
											{task.filePath}:{task.lineNumber}
										</a>
									</div>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</section>
