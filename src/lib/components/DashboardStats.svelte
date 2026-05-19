<script lang="ts">
	import type { TaskItem, Timetable } from '$lib/types';
	import { CalendarDays, ListTodo, BookOpen } from 'lucide-svelte';

	interface Props {
		tasks: TaskItem[];
		timetable: Timetable;
		todayDay: string | null;
	}

	let { tasks, timetable, todayDay }: Props = $props();

	const pendingTasks = $derived(tasks.filter((t) => !t.isCompleted).length);
	const totalTasks = $derived(tasks.length);
	const todayClasses = $derived.by(() => {
		if (!todayDay) return [] as { period: string; subject: string; directory: string }[];
		const slots = timetable[todayDay] ?? {};
		return Object.entries(slots)
			.map(([period, slot]) => ({ period, ...slot }))
			.sort((a, b) => Number(a.period) - Number(b.period));
	});
</script>

<section class="grid grid-cols-1 gap-3 sm:grid-cols-3">
	<div class="rounded-lg border bg-white p-4">
		<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
			<CalendarDays class="size-3.5" />
			今日の時間割
		</div>
		<div class="mt-2 flex items-baseline gap-1">
			<span class="text-2xl font-bold text-foreground">{todayClasses.length}</span>
			<span class="text-xs text-muted-foreground">コマ ({todayDay ?? '休日'})</span>
		</div>
		{#if todayClasses.length > 0}
			<ul class="mt-2 space-y-1 text-xs">
				{#each todayClasses as cls (cls.period)}
					<li class="flex items-center gap-2 truncate">
						<span class="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
							{cls.period}限
						</span>
						<span class="truncate">{cls.subject}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-2 text-xs text-muted-foreground">登録された授業はありません</p>
		{/if}
	</div>

	<div class="rounded-lg border bg-white p-4">
		<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
			<ListTodo class="size-3.5" />
			未完了タスク
		</div>
		<div class="mt-2 flex items-baseline gap-1">
			<span class="text-2xl font-bold text-foreground">{pendingTasks}</span>
			<span class="text-xs text-muted-foreground">/ {totalTasks} 件</span>
		</div>
		<p class="mt-2 text-xs text-muted-foreground">
			ノート内の <code class="rounded bg-muted px-1">- [ ]</code> を抽出
		</p>
	</div>

	<div class="rounded-lg border bg-white p-4">
		<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
			<BookOpen class="size-3.5" />
			登録科目数
		</div>
		<div class="mt-2 flex items-baseline gap-1">
			<span class="text-2xl font-bold text-foreground">
				{Object.values(timetable).reduce((sum, day) => sum + Object.keys(day).length, 0)}
			</span>
			<span class="text-xs text-muted-foreground">コマ (週)</span>
		</div>
		<p class="mt-2 text-xs text-muted-foreground">時間割に登録されたコマ数</p>
	</div>
</section>
