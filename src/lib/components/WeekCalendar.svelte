<script lang="ts">
	import { onMount } from 'svelte';
	import { CalendarRange, AlertCircle, Loader2, ArrowRight } from 'lucide-svelte';
	import {
		buildWeekDates,
		formatLocalDate,
		resolveDaySchedule,
		startOfWeekSunday
	} from '$lib/calendar';
	import { enabledPeriods } from '$lib/period-times';
	import type { CalendarEvent, PublicHoliday, Timetable, TimetableSettings } from '$lib/types';
	import { cn } from '$lib/utils';

	interface Props {
		timetable: Timetable;
		settings: TimetableSettings | null;
	}

	let { timetable, settings }: Props = $props();

	const today = formatLocalDate(new Date());
	const weekDates = $derived(buildWeekDates(today));
	const weekStart = $derived(startOfWeekSunday(today));
	const weekEnd = $derived(weekDates[weekDates.length - 1]);
	const allowedPeriods = $derived(new Set(enabledPeriods(settings)));

	let events = $state<CalendarEvent[]>([]);
	let holidays = $state<PublicHoliday[]>([]);
	let loading = $state(true);
	let errorMessage = $state<string | null>(null);

	async function load() {
		loading = true;
		errorMessage = null;
		try {
			const res = await fetch(`/api/calendar?from=${weekStart}&to=${weekEnd}`);
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(body.message ?? `Failed to load calendar (${res.status})`);
			}
			const data = (await res.json()) as { events: CalendarEvent[]; holidays: PublicHoliday[] };
			events = data.events;
			holidays = data.holidays;
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			loading = false;
		}
	}

	function weekdayLabel(date: string): string {
		const d = new Date(date);
		const idx = d.getDay();
		const all = ['日', '月', '火', '水', '木', '金', '土'];
		return all[idx];
	}

	function isToday(date: string): boolean {
		return date === today;
	}

	function dayLabel(date: string): string {
		const [, , day] = date.split('-');
		return String(Number(day));
	}

	const schedules = $derived(
		weekDates.map((date) => ({ date, schedule: resolveDaySchedule(date, timetable, events, holidays) }))
	);

	onMount(load);
</script>

<section class="rounded-lg border bg-white p-4">
	<div class="mb-3 flex items-center justify-between gap-2">
		<div class="flex min-w-0 items-center gap-2">
			<CalendarRange class="size-4 shrink-0 text-muted-foreground" />
			<h2 class="text-sm font-semibold">今週のカレンダー</h2>
			<span class="truncate text-xs text-muted-foreground">{weekStart}〜{weekEnd}</span>
		</div>
		<a
			href="/calendar"
			class="inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-xs text-foreground hover:bg-accent"
		>
			月表示 <ArrowRight class="size-3" />
		</a>
	</div>

	{#if errorMessage}
		<div class="mb-2 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
			<AlertCircle class="mt-0.5 size-4 shrink-0" />
			<span>{errorMessage}</span>
		</div>
	{/if}

	{#if loading}
		<div class="flex items-center gap-2 py-2 text-xs text-muted-foreground">
			<Loader2 class="size-3 animate-spin" /> 読み込み中…
		</div>
	{:else}
		<ul class="grid grid-cols-7 gap-1">
			{#each schedules as { date, schedule } (date)}
				{@const wd = weekdayLabel(date)}
				{@const holidayName = schedule.publicHoliday?.name ?? schedule.schoolHoliday?.title ?? null}
				<li
					class={cn(
						'flex h-28 flex-col rounded border p-1.5 text-left transition',
						isToday(date) && 'border-primary bg-primary/5',
						(schedule.isWeekend || holidayName) && !isToday(date) && 'bg-muted/30'
					)}
				>
					<div class="flex items-baseline justify-between gap-1">
						<span class="text-[10px] font-medium text-muted-foreground">{wd}</span>
						<span
							class={cn(
								'text-sm font-bold',
								wd === '日' && 'text-red-600',
								wd === '土' && 'text-blue-600',
								isToday(date) && 'text-primary'
							)}
						>
							{dayLabel(date)}
						</span>
					</div>

					{#if holidayName}
						<span class="mt-0.5 line-clamp-2 rounded bg-red-100 px-1 py-0.5 text-[10px] font-medium text-red-700">
							{holidayName}
						</span>
					{:else if schedule.inboundMove}
						<span class="mt-0.5 line-clamp-2 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-medium text-emerald-800">
							{schedule.inboundMove.fromDate.slice(5)} から移動
						</span>
					{:else if schedule.swapEvent}
						<span class="mt-0.5 line-clamp-2 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800">
							{schedule.swapEvent.followsDay}曜の時間割
						</span>
					{/if}
					{#if schedule.outboundMoves.length > 0}
						<span class="mt-0.5 line-clamp-2 rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-medium text-emerald-700">
							→ {schedule.outboundMoves[0].date.slice(5)} へ移動
						</span>
					{/if}

					<ul class="mt-1 min-h-0 flex-1 space-y-0.5 overflow-hidden text-[10px]">
						{#each schedule.periods.filter((p) => allowedPeriods.has(p.period) && p.slot) as entry (entry.period)}
							<li class="flex items-center gap-1 truncate">
								<span class="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground">
									{entry.period}
								</span>
								<span class={cn('truncate', entry.source === 'override' && 'font-medium text-amber-700')}>
									{entry.slot?.subject}
								</span>
							</li>
						{/each}
						{#if !holidayName && schedule.periods.filter((p) => allowedPeriods.has(p.period)).every((p) => !p.slot) && !schedule.isWeekend}
							<li class="text-muted-foreground/70">授業なし</li>
						{/if}
					</ul>
				</li>
			{/each}
		</ul>
	{/if}
</section>
