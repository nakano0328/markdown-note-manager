<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import DashboardStats from '$lib/components/DashboardStats.svelte';
	import NowBanner from '$lib/components/NowBanner.svelte';
	import TaskDashboard from '$lib/components/TaskDashboard.svelte';
	import TimetableGrid from '$lib/components/TimetableGrid.svelte';
	import WeekCalendar from '$lib/components/WeekCalendar.svelte';
	import { formatLocalDate, resolveCurrentPeriod, resolveDaySchedule, weekdayFromDate } from '$lib/calendar';
	import { buildPeriodWindow } from '$lib/period-times';
	import {
		notificationPermission,
		notifyDailyTaskSummary,
		notifyUpcomingClass,
		requestPermission,
		shouldOfferPermissionPrompt
	} from '$lib/notifications';
	import type {
		CalendarEvent,
		PeriodTime,
		PublicHoliday,
		TaskItem,
		Timetable,
		TimetableSettings,
		TimetableTerm
	} from '$lib/types';
	import { AlertCircle, Bell, Loader2 } from 'lucide-svelte';

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
	const periodWindowFn = $derived(buildPeriodWindow(timetableSettings));

	let notifPermission = $state<NotificationPermission | 'unsupported'>('default');
	let showPermissionPrompt = $state(false);
	let upcomingCheckId: ReturnType<typeof setInterval> | null = null;
	let dailySummarySent = $state(false);

	async function handleEnableNotifications() {
		const result = await requestPermission();
		notifPermission = result;
		showPermissionPrompt = false;
	}

	function dismissPermissionPrompt() {
		showPermissionPrompt = false;
		try {
			localStorage.setItem('mnm:notifications:asked', '1');
		} catch {
			// 容量超過などは無視
		}
	}

	function maybeNotifyDailySummary() {
		if (dailySummarySent) return;
		if (notifPermission !== 'granted') return;
		if (tasksLoading || tasks.length === 0) return;
		notifyDailyTaskSummary(today, tasks);
		dailySummarySent = true;
	}

	function tickUpcoming() {
		if (notifPermission !== 'granted') return;
		const snap = resolveCurrentPeriod(new Date(), todaySchedule, periodWindowFn);
		notifyUpcomingClass(snap, today);
	}

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

	async function handlePeriodTimesChange(periodTimes: PeriodTime[]) {
		const res = await fetch('/api/timetable', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ periodTimes })
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({ message: res.statusText }));
			throw new Error(body.message ?? `Failed to update period times (${res.status})`);
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
		loadTasks().then(() => maybeNotifyDailySummary());

		notifPermission = notificationPermission();
		if (shouldOfferPermissionPrompt()) {
			showPermissionPrompt = true;
		}

		upcomingCheckId = setInterval(tickUpcoming, 60_000);
		tickUpcoming();
	});

	$effect(() => {
		void todaySchedule;
		void tasks;
		maybeNotifyDailySummary();
	});

	onDestroy(() => {
		if (upcomingCheckId) clearInterval(upcomingCheckId);
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

	{#if showPermissionPrompt}
		<div class="flex flex-wrap items-center gap-2 rounded border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900">
			<Bell class="size-4 shrink-0" />
			<span class="flex-1">
				課題リマインドと授業開始のブラウザ通知を有効にしますか？
			</span>
			<button
				type="button"
				onclick={handleEnableNotifications}
				class="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700"
			>
				有効にする
			</button>
			<button
				type="button"
				onclick={dismissPermissionPrompt}
				class="rounded border bg-white px-2 py-1 text-xs hover:bg-accent"
			>
				あとで
			</button>
		</div>
	{/if}

	{#if timetableLoading}
		<div class="flex items-center gap-2 py-4 text-sm text-muted-foreground">
			<Loader2 class="size-4 animate-spin" /> 読み込み中…
		</div>
	{:else}
		<NowBanner {todaySchedule} settings={timetableSettings} />

		<DashboardStats
			{tasks}
			{timetable}
			{todayDay}
			{todaySchedule}
			settings={timetableSettings}
			calendarLoading={todayCalendarLoading}
			calendarError={todayCalendarError}
		/>

		<WeekCalendar {timetable} settings={timetableSettings} />

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
				onPeriodTimesChange={handlePeriodTimesChange}
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
