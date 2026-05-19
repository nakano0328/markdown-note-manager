<script lang="ts">
	import { onMount } from 'svelte';
	import DashboardStats from '$lib/components/DashboardStats.svelte';
	import TaskDashboard from '$lib/components/TaskDashboard.svelte';
	import TimetableGrid from '$lib/components/TimetableGrid.svelte';
	import WeekCalendar from '$lib/components/WeekCalendar.svelte';
	import { formatLocalDate, resolveDaySchedule, weekdayFromDate } from '$lib/calendar';
	import type {
		CalendarEvent,
		PublicHoliday,
		TaskItem,
		Timetable,
		TimetableSettings,
		TimetableTerm
	} from '$lib/types';
	import { AlertCircle, Loader2 } from 'lucide-svelte';

	const today = formatLocalDate(new Date());
	const todayDay = weekdayFromDate(today);

	let timetable = $state<Timetable>({});
	let timetableSettings = $state<TimetableSettings | null>(null);
	let activeTerm = $state<TimetableTerm | null>(null);
	let viewedTerm = $state<TimetableTerm | null>(null);
	let tasks = $state<TaskItem[]>([]);
	let todayEvents = $state<CalendarEvent[]>([]);
	let todayHolidays = $state<PublicHoliday[]>([]);
	let timetableLoading = $state(true);
	let tasksLoading = $state(true);
	let todayCalendarLoading = $state(true);
	let timetableError = $state<string | null>(null);
	let tasksError = $state<string | null>(null);
	let todayCalendarError = $state<string | null>(null);

	const todaySchedule = $derived(
		resolveDaySchedule(today, timetable, todayEvents, todayHolidays)
	);

	async function loadTimetable(termId?: string) {
		timetableLoading = true;
		timetableError = null;
		try {
			const url = termId
				? `/api/timetable?termId=${encodeURIComponent(termId)}`
				: `/api/timetable?date=${today}`;
			const res = await fetch(url);
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(body.message ?? `Failed to load timetable (${res.status})`);
			}
			const data = (await res.json()) as {
				timetable: Timetable;
				settings: TimetableSettings;
				activeTerm: TimetableTerm;
				viewedTerm: TimetableTerm;
			};
			timetable = data.timetable ?? {};
			timetableSettings = data.settings;
			activeTerm = data.activeTerm;
			viewedTerm = data.viewedTerm;
		} catch (e) {
			timetableError = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			timetableLoading = false;
		}
	}

	async function loadTodayCalendar() {
		todayCalendarLoading = true;
		todayCalendarError = null;
		try {
			const res = await fetch(`/api/calendar?from=${today}&to=${today}`);
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(body.message ?? `Failed to load calendar (${res.status})`);
			}
			const data = (await res.json()) as { events: CalendarEvent[]; holidays: PublicHoliday[] };
			todayEvents = data.events;
			todayHolidays = data.holidays;
		} catch (e) {
			todayCalendarError = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			todayCalendarLoading = false;
		}
	}

	async function loadTasks() {
		tasksLoading = true;
		tasksError = null;
		try {
			const res = await fetch('/api/tasks');
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(body.message ?? `Failed to load tasks (${res.status})`);
			}
			const data = (await res.json()) as { tasks: TaskItem[] };
			tasks = data.tasks;
		} catch (e) {
			tasksError = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			tasksLoading = false;
		}
	}

	function handleTimetableChange(next: Timetable) {
		timetable = next;
	}

	async function handleViewedTermChange(termId: string) {
		await loadTimetable(termId);
	}

	async function handleTermChange(termPatch: Partial<TimetableTerm>) {
		const res = await fetch('/api/timetable', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ term: termPatch })
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({ message: res.statusText }));
			throw new Error(body.message ?? `Failed to update timetable settings (${res.status})`);
		}

		const data = (await res.json()) as {
			timetable: Timetable;
			settings: TimetableSettings;
			activeTerm: TimetableTerm;
			viewedTerm: TimetableTerm;
		};
		timetable = data.timetable ?? {};
		timetableSettings = data.settings;
		activeTerm = data.activeTerm;
		viewedTerm = data.viewedTerm;
	}

	async function handleTaskToggle(task: TaskItem, isCompleted: boolean) {
		const res = await fetch('/api/tasks', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filePath: task.filePath,
				lineNumber: task.lineNumber,
				isCompleted
			})
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({ message: res.statusText }));
			throw new Error(body.message ?? `Failed to update task (${res.status})`);
		}

		const data = (await res.json()) as { task: TaskItem | null };
		if (!data.task) {
			await loadTasks();
			return;
		}

		tasks = tasks.map((item) => (item.id === task.id ? data.task! : item));
	}

	onMount(() => {
		loadTimetable();
		loadTodayCalendar();
		loadTasks();
	});
</script>

<div class="mx-auto max-w-5xl space-y-4 p-4">
	<header>
		<h1 class="text-xl font-bold">ホーム</h1>
		<p class="mt-1 text-xs text-muted-foreground">
			今日 ({todayDay ? `${todayDay}曜日` : '休日'}) の時間割と未完了の課題を表示します。
			{#if activeTerm && viewedTerm}
				<span class="ml-1">今季: {activeTerm.label} / 表示中: {viewedTerm.label}</span>
			{/if}
		</p>
	</header>

	{#if timetableError}
		<div class="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
			<AlertCircle class="mt-0.5 size-4 shrink-0" />
			<span>時間割の読み込みに失敗: {timetableError}</span>
		</div>
	{/if}
	{#if todayCalendarError}
		<div class="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
			<AlertCircle class="mt-0.5 size-4 shrink-0" />
			<span>今日のカレンダー反映に失敗: {todayCalendarError}</span>
		</div>
	{/if}

	{#if timetableLoading}
		<div class="flex items-center gap-2 py-4 text-sm text-muted-foreground">
			<Loader2 class="size-4 animate-spin" /> 読み込み中…
		</div>
	{:else}
		<DashboardStats
			{tasks}
			{timetable}
			{todayDay}
			{todaySchedule}
			calendarLoading={todayCalendarLoading}
			calendarError={todayCalendarError}
		/>

		<WeekCalendar {timetable} />

		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
			<TimetableGrid
				{timetable}
				{todayDay}
				settings={timetableSettings}
				{activeTerm}
				{viewedTerm}
				onChange={handleTimetableChange}
				onTermChange={handleTermChange}
				onViewedTermChange={handleViewedTermChange}
			/>
			<TaskDashboard
				{tasks}
				loading={tasksLoading}
				errorMessage={tasksError}
				onReload={loadTasks}
				onToggleTask={handleTaskToggle}
			/>
		</div>
	{/if}
</div>
