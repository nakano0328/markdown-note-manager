<script lang="ts">
	import { onMount } from 'svelte';
	import { CalendarRange, AlertCircle, Loader2, ArrowRight } from 'lucide-svelte';
	import {
		buildWeekDates,
		formatLocalDate,
		resolveDaySchedule,
		startOfWeekSunday,
		termForDate
	} from '$lib/calendar';
	import { enabledPeriods } from '$lib/period-times';
	import type {
		CalendarEvent,
		PublicHoliday,
		Timetable,
		TimetableSettings,
		TimetableTerm
	} from '$lib/types';
	import { cn } from '$lib/utils';

	interface Props {
		timetable: Timetable;
		settings: TimetableSettings | null;
		viewedTerm: TimetableTerm | null;
	}

	let { timetable, settings, viewedTerm }: Props = $props();

	const today = formatLocalDate(new Date());
	const weekDates = $derived(buildWeekDates(today));
	const weekStart = $derived(startOfWeekSunday(today));
	const weekEnd = $derived(weekDates[weekDates.length - 1]);
	const allowedPeriods = $derived(new Set(enabledPeriods(settings)));

	let events = $state<CalendarEvent[]>([]);
	let holidays = $state<PublicHoliday[]>([]);
	let timetableByTermId = $state<Record<string, Timetable>>({});
	let loading = $state(true);
	let loadingTimetables = $state(false);
	let errorMessage = $state<string | null>(null);
	let timetableError = $state<string | null>(null);
	let timetableLoadKey = $state('');

	type TimetableResponse = {
		timetable: Timetable;
		viewedTerm: TimetableTerm;
	};

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

	function timetableForDate(date: string): Timetable {
		const term = termForDate(settings, date);
		if (!term) return {};
		if (viewedTerm?.id === term.id) return timetable;
		return timetableByTermId[term.id] ?? {};
	}

	function termBoundaryLabel(date: string): string | null {
		const term = termForDate(settings, date);
		if (!term) return null;
		if (date === term.startsAt) return `${term.label} 開始`;
		if (date === term.endsAt) return `${term.label} 終了`;
		return null;
	}

	const requiredTermIds = $derived.by(() => {
		if (!settings) return [];
		const ids: string[] = [];
		const dates = [...weekDates];
		for (const event of events) {
			if (event.type === 'date_move') dates.push(event.fromDate);
		}
		for (const date of dates) {
			const term = termForDate(settings, date);
			if (term && !ids.includes(term.id)) ids.push(term.id);
		}
		return ids;
	});

	const schedules = $derived(
		weekDates.map((date) => ({
			date,
			schedule: resolveDaySchedule(date, timetableForDate, events, holidays, settings)
		}))
	);

	async function loadTimetables(termIds: string[], key: string) {
		if (termIds.length === 0) {
			timetableByTermId = {};
			loadingTimetables = false;
			timetableError = null;
			return;
		}
		loadingTimetables = true;
		timetableError = null;
		try {
			const responses = await Promise.all(
				termIds.map(async (termId) => {
					const res = await fetch(`/api/timetable?termId=${encodeURIComponent(termId)}`);
					if (!res.ok) {
						const body = await res.json().catch(() => ({ message: res.statusText }));
						throw new Error(body.message ?? `Failed to load timetable (${res.status})`);
					}
					return (await res.json()) as TimetableResponse;
				})
			);
			if (key !== timetableLoadKey) return;
			const next: Record<string, Timetable> = {};
			for (const response of responses) {
				next[response.viewedTerm.id] = response.timetable ?? {};
			}
			timetableByTermId = next;
		} catch (e) {
			if (key !== timetableLoadKey) return;
			timetableError = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			if (key === timetableLoadKey) loadingTimetables = false;
		}
	}

	onMount(load);

	$effect(() => {
		const key = requiredTermIds.join('|');
		if (key === timetableLoadKey) return;
		timetableLoadKey = key;
		void loadTimetables(requiredTermIds, key);
	});
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

	{#if errorMessage || timetableError}
		<div class="mb-2 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
			<AlertCircle class="mt-0.5 size-4 shrink-0" />
			<span>{errorMessage ?? timetableError}</span>
		</div>
	{/if}

	{#if loading || loadingTimetables}
		<div class="flex items-center gap-2 py-2 text-xs text-muted-foreground">
			<Loader2 class="size-3 animate-spin" /> 読み込み中…
		</div>
	{:else}
		<ul class="grid grid-cols-7 gap-1">
			{#each schedules as { date, schedule } (date)}
				{@const wd = weekdayLabel(date)}
				{@const holidayName = schedule.publicHoliday?.name ?? schedule.schoolHoliday?.title ?? null}
				{@const boundaryLabel = termBoundaryLabel(date)}
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
					{/if}
					{#if boundaryLabel}
						<span class="mt-0.5 line-clamp-2 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
							{boundaryLabel}
						</span>
					{/if}
					{#if !holidayName && schedule.inboundMove}
						<span class="mt-0.5 line-clamp-2 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-medium text-emerald-800">
							{schedule.inboundMove.fromDate.slice(5)} から移動
						</span>
					{:else if !holidayName && schedule.swapEvent}
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
