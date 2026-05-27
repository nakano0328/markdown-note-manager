<script lang="ts">
	import {
		Loader2,
		AlertCircle,
		FileText,
		RefreshCw,
		CheckCircle2,
		CalendarCheck2,
		ChevronUp,
		Equal,
		ChevronDown
	} from 'lucide-svelte';
	import type { TaskItem, TaskPriority } from '$lib/types';
	import { formatLocalDate } from '$lib/calendar';
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

	const today = formatLocalDate(new Date());

	type Bucket =
		| 'overdue'
		| 'today'
		| 'within3'
		| 'within7'
		| 'later'
		| 'undated';

	const BUCKET_LABEL: Record<Bucket, string> = {
		overdue: '期限切れ',
		today: '今日',
		within3: '3日以内',
		within7: '今週',
		later: 'これ以降',
		undated: '期限なし'
	};

	const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'within3', 'within7', 'later', 'undated'];

	const BUCKET_STYLE: Record<Bucket, string> = {
		overdue: 'border-red-300 bg-red-50 text-red-900',
		today: 'border-amber-300 bg-amber-50 text-amber-900',
		within3: 'border-yellow-200 bg-yellow-50 text-yellow-900',
		within7: 'border-sky-200 bg-sky-50 text-sky-900',
		later: 'border-muted bg-muted/30 text-foreground',
		undated: 'border-muted bg-white text-muted-foreground'
	};

	function daysBetween(a: string, b: string): number {
		const da = new Date(a + 'T00:00:00');
		const db = new Date(b + 'T00:00:00');
		return Math.round((db.getTime() - da.getTime()) / 86_400_000);
	}

	function classify(task: TaskItem): Bucket {
		if (!task.dueDate) return 'undated';
		const diff = daysBetween(today, task.dueDate);
		if (diff < 0) return 'overdue';
		if (diff === 0) return 'today';
		if (diff <= 3) return 'within3';
		if (diff <= 7) return 'within7';
		return 'later';
	}

	function priorityRank(p: TaskPriority | null): number {
		switch (p) {
			case 'high':
				return 0;
			case 'medium':
				return 1;
			case 'low':
				return 2;
			default:
				return 3;
		}
	}

	function compareTasks(a: TaskItem, b: TaskItem): number {
		if (a.dueDate && b.dueDate) {
			if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
		} else if (a.dueDate) {
			return -1;
		} else if (b.dueDate) {
			return 1;
		}
		const pr = priorityRank(a.priority) - priorityRank(b.priority);
		if (pr !== 0) return pr;
		return a.subject.localeCompare(b.subject, 'ja');
	}

	const visibleTasks = $derived(showCompleted ? tasks : tasks.filter((t) => !t.isCompleted));
	const pendingCount = $derived(tasks.filter((t) => !t.isCompleted).length);
	const overdueCount = $derived(
		tasks.filter((t) => !t.isCompleted && classify(t) === 'overdue').length
	);
	const todayCount = $derived(
		tasks.filter((t) => !t.isCompleted && classify(t) === 'today').length
	);

	const bucketedTasks = $derived.by(() => {
		const map = new Map<Bucket, TaskItem[]>();
		for (const task of visibleTasks) {
			const b = classify(task);
			const arr = map.get(b) ?? [];
			arr.push(task);
			map.set(b, arr);
		}
		for (const arr of map.values()) arr.sort(compareTasks);
		return BUCKET_ORDER.flatMap((b) => {
			const items = map.get(b);
			return items && items.length > 0 ? [{ bucket: b, items }] : [];
		});
	});

	function encodeFilePath(filePath: string): string {
		return filePath.split('/').map(encodeURIComponent).join('/');
	}

	function dueLabel(dateStr: string): string {
		const diff = daysBetween(today, dateStr);
		if (diff === 0) return '今日';
		if (diff === 1) return '明日';
		if (diff === -1) return '昨日';
		if (diff < 0) return `${-diff}日経過`;
		return `あと${diff}日`;
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
		<h2 class="flex items-center gap-2 text-sm font-semibold">
			未完了の課題
			<span class="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
				{pendingCount}
			</span>
			{#if overdueCount > 0}
				<span class="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
					期限切れ {overdueCount}
				</span>
			{/if}
			{#if todayCount > 0}
				<span class="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
					今日 {todayCount}
				</span>
			{/if}
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
				{#each bucketedTasks as group (group.bucket)}
					<div class={cn('rounded border p-2', BUCKET_STYLE[group.bucket])}>
						<div class="mb-1 flex items-center gap-2 text-xs font-semibold">
							<CalendarCheck2 class="size-3.5" />
							{BUCKET_LABEL[group.bucket]}
							<span class="rounded bg-white/60 px-1 py-0.5 text-[10px] font-medium">
								{group.items.length}
							</span>
						</div>
						<ul class="space-y-1">
							{#each group.items as task (task.id)}
								<li
									class={cn(
										'flex items-start gap-2 rounded bg-white/80 px-2 py-1.5 text-sm hover:bg-white',
										task.isCompleted && 'text-muted-foreground line-through opacity-70'
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
										<div class="flex flex-wrap items-center gap-1.5">
											{#if task.priority === 'high'}
												<ChevronUp class="size-3.5 text-red-600" aria-label="優先度 高" />
											{:else if task.priority === 'medium'}
												<Equal class="size-3.5 text-amber-600" aria-label="優先度 中" />
											{:else if task.priority === 'low'}
												<ChevronDown class="size-3.5 text-sky-600" aria-label="優先度 低" />
											{/if}
											<span class="break-words text-foreground">{task.content}</span>
											{#if task.dueDate}
												<span
													class={cn(
														'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
														group.bucket === 'overdue'
															? 'bg-red-200 text-red-900'
															: group.bucket === 'today'
																? 'bg-amber-200 text-amber-900'
																: 'bg-muted text-muted-foreground'
													)}
												>
													<CalendarCheck2 class="size-3" />
													{task.dueDate}（{dueLabel(task.dueDate)}）
												</span>
											{/if}
										</div>
										<div class="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
											<span class="font-medium">{task.subject}</span>
											<a
												href={`/note/${encodeFilePath(task.filePath)}`}
												class="inline-flex items-center gap-1 hover:text-foreground hover:underline"
											>
												<FileText class="size-3" />
												{task.filePath}:{task.lineNumber}
											</a>
										</div>
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
