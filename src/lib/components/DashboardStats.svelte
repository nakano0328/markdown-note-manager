<script lang="ts">
	import type { DaySchedule, TaskItem, Timetable } from '$lib/types';
	import { CalendarDays, ListTodo, BookOpen } from 'lucide-svelte';

	interface Props {
		tasks: TaskItem[];
		timetable: Timetable;
		todayDay: string | null;
		todaySchedule: DaySchedule;
		calendarLoading?: boolean;
		calendarError?: string | null;
	}

	let {
		tasks,
		timetable,
		todayDay,
		todaySchedule,
		calendarLoading = false,
		calendarError = null
	}: Props = $props();

	const pendingTasks = $derived(tasks.filter((t) => !t.isCompleted).length);
	const totalTasks = $derived(tasks.length);
	const todayClasses = $derived.by(() => {
		return todaySchedule.periods
			.filter((period) => period.slot)
			.map((period) => ({
				period: period.period,
				subject: period.slot!.subject,
				directory: period.slot!.directory,
				source: period.source
			}));
	});
	const todayLabel = $derived.by(() => {
		const holiday = todaySchedule.publicHoliday?.name ?? todaySchedule.schoolHoliday?.title;
		if (holiday) return holiday;
		if (todaySchedule.inboundMove) return `${todaySchedule.inboundMove.fromDate.slice(5)} から移動`;
		if (todaySchedule.followsDay) return `${todaySchedule.followsDay}曜扱い`;
		return todayDay ? `${todayDay}曜` : '休日';
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
			<span class="text-xs text-muted-foreground">コマ ({todayLabel})</span>
		</div>
		{#if calendarLoading}
			<p class="mt-1 text-[11px] text-muted-foreground">カレンダー反映を確認中…</p>
		{:else if calendarError}
			<p class="mt-1 text-[11px] text-amber-700">曜日時間割で暫定表示中</p>
		{/if}
		{#if todayClasses.length > 0}
			<ul class="mt-2 space-y-1 text-xs">
				{#each todayClasses as cls (cls.period)}
					<li class="flex items-center gap-2 truncate">
						<span class="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
							{cls.period}限
						</span>
						<span class={cls.source === 'override' ? 'truncate font-medium text-amber-700' : 'truncate'}>
							{cls.subject}
						</span>
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
