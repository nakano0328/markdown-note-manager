<script lang="ts">
	import { onMount } from 'svelte';
	import {
		AlertCircle,
		CalendarDays,
		ChevronLeft,
		ChevronRight,
		Loader2,
		Pencil,
		Plus,
		Save,
		Settings,
		Trash2,
		X
	} from 'lucide-svelte';
	import TermSettingsModal from '$lib/components/TermSettingsModal.svelte';
	import TimetableSlotEditor from '$lib/components/TimetableSlotEditor.svelte';
	import {
		collectSubjectDirectories,
		directoryName,
		persistTimetableSlot
	} from '$lib/timetable-client';
	import {
		PERIODS,
		buildMonthGrid,
		formatLocalDate,
		isSameMonth,
		parseDate,
		resolveDaySchedule
	} from '$lib/calendar';
	import { WEEKDAYS } from '$lib/types';
	import type {
		CalendarEvent,
		PeriodOverrideEvent,
		PublicHoliday,
		Timetable,
		TimetableSettings,
		TimetableSlot,
		TimetableTerm,
		TreeNode,
		Weekday
	} from '$lib/types';
	import { cn } from '$lib/utils';

	type EventDraft = {
		mode: 'create' | 'edit';
		id?: string;
		date: string;
		type: CalendarEvent['type'];
		title: string;
		note: string;
		followsDay: Weekday;
		fromDate: string;
		period: string;
		slotMode: 'cancel' | 'override';
		subject: string;
		directory: string;
	};

	const today = formatLocalDate(new Date());
	const HEAD_DAYS = ['月', '火', '水', '木', '金', '土', '日'] as const;

	let monthAnchor = $state(today.slice(0, 7) + '-01');
	let timetable = $state<Timetable>({});
	let activeTerm = $state<TimetableTerm | null>(null);
	let viewedTerm = $state<TimetableTerm | null>(null);
	let timetableSettings = $state<TimetableSettings | null>(null);
	let events = $state<CalendarEvent[]>([]);
	let holidays = $state<PublicHoliday[]>([]);
	let directories = $state<string[]>([]);
	let selectedDate = $state<string>(today);

	let loadingTimetable = $state(true);
	let loadingCalendar = $state(true);
	let calendarError = $state<string | null>(null);
	let timetableError = $state<string | null>(null);
	let draft = $state<EventDraft | null>(null);
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let termEditorOpen = $state(false);
	let slotEditing = $state<{ day: Weekday; period: string } | null>(null);
	let slotSaving = $state(false);
	let slotError = $state<string | null>(null);
	let timetableRequestId = 0;
	let calendarRequestId = 0;

	const monthGrid = $derived(buildMonthGrid(monthAnchor));
	const monthTitle = $derived.by(() => {
		const [y, m] = monthAnchor.split('-');
		return `${y}年 ${Number(m)}月`;
	});
	const selectedSchedule = $derived(resolveDaySchedule(selectedDate, timetable, events, holidays));
	const selectedDayEvents = $derived(events.filter((e) => e.date === selectedDate));

	async function loadDirectories() {
		try {
			const res = await fetch('/api/tree');
			if (!res.ok) return;
			const data = (await res.json()) as { tree: TreeNode[] };
			directories = collectSubjectDirectories(data.tree);
		} catch {
			directories = [];
		}
	}

	function openSlotEditor(day: Weekday, period: string) {
		slotEditing = { day, period };
		slotError = null;
	}

	function closeSlotEditor() {
		slotEditing = null;
		slotError = null;
	}

	async function commitSlot(slot: TimetableSlot | null, startTermId: string, endTermId: string) {
		if (!slotEditing) return;
		slotSaving = true;
		slotError = null;
		try {
			await persistTimetableSlot({
				day: slotEditing.day,
				period: slotEditing.period,
				slot,
				startTermId,
				endTermId,
				viewedTerm,
				viewedTimetable: timetable
			});
			await loadTimetable();
			closeSlotEditor();
		} catch (e) {
			slotError = e instanceof Error ? e.message : '時間割の保存に失敗しました';
			throw e;
		} finally {
			slotSaving = false;
		}
	}

	const slotEditorDay = $derived<Weekday>(slotEditing?.day ?? '月');
	const slotEditorPeriod = $derived(slotEditing?.period ?? '1');
	const slotEditorCurrent = $derived<TimetableSlot | null>(
		slotEditing ? (timetable[slotEditing.day]?.[slotEditing.period] ?? null) : null
	);
	const slotEditorDefaultStart = $derived<string>(
		pickTermForDate(selectedDate)?.id ?? viewedTerm?.id ?? ''
	);

	async function loadTimetable(anchor = monthAnchor) {
		const id = ++timetableRequestId;
		loadingTimetable = true;
		timetableError = null;
		try {
			const params = new URLSearchParams();
			params.set('date', anchor);
			const res = await fetch(`/api/timetable${params.size ? `?${params}` : ''}`);
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
			if (id !== timetableRequestId) return;
			timetable = data.timetable ?? {};
			timetableSettings = data.settings;
			activeTerm = data.activeTerm;
			viewedTerm = data.viewedTerm;
		} catch (e) {
			if (id !== timetableRequestId) return;
			timetableError = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			if (id === timetableRequestId) loadingTimetable = false;
		}
	}

	async function handleTermChange(patch: Partial<TimetableTerm>) {
		const res = await fetch('/api/timetable', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ term: patch })
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({ message: res.statusText }));
			throw new Error(body.message ?? `Failed to update term (${res.status})`);
		}
		const data = (await res.json()) as {
			timetable: Timetable;
			settings: TimetableSettings;
			activeTerm: TimetableTerm;
			viewedTerm: TimetableTerm;
		};
		timetableSettings = data.settings;
		activeTerm = data.activeTerm;
		viewedTerm = data.viewedTerm;
		timetable = data.timetable ?? {};
	}

	function pickTermForDate(date: string): TimetableTerm | null {
		if (!timetableSettings) return null;
		return (
			timetableSettings.terms.find((term) => term.startsAt <= date && date <= term.endsAt) ?? null
		);
	}

	async function loadCalendar(anchor = monthAnchor) {
		const id = ++calendarRequestId;
		const grid = buildMonthGrid(anchor);
		const from = grid[0];
		const to = grid[grid.length - 1];
		loadingCalendar = true;
		calendarError = null;
		try {
			const res = await fetch(`/api/calendar?from=${from}&to=${to}`);
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(body.message ?? `Failed to load calendar (${res.status})`);
			}
			const data = (await res.json()) as { events: CalendarEvent[]; holidays: PublicHoliday[] };
			if (id !== calendarRequestId) return;
			events = data.events;
			holidays = data.holidays;
		} catch (e) {
			if (id !== calendarRequestId) return;
			calendarError = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			if (id === calendarRequestId) loadingCalendar = false;
		}
	}

	async function loadMonth(anchor = monthAnchor) {
		await Promise.all([loadTimetable(anchor), loadCalendar(anchor)]);
	}

	function setMonth(anchor: string, dateToSelect = anchor) {
		monthAnchor = anchor;
		selectedDate = dateToSelect;
		void loadMonth(anchor);
	}

	function goPrevMonth() {
		const d = parseDate(monthAnchor);
		d.setMonth(d.getMonth() - 1, 1);
		setMonth(formatLocalDate(d));
	}

	function goNextMonth() {
		const d = parseDate(monthAnchor);
		d.setMonth(d.getMonth() + 1, 1);
		setMonth(formatLocalDate(d));
	}

	function goToday() {
		setMonth(today.slice(0, 7) + '-01', today);
	}

	function weekdayLabelOf(date: string): string {
		const idx = new Date(date).getDay();
		return ['日', '月', '火', '水', '木', '金', '土'][idx];
	}

	function startDraft(date: string, type: CalendarEvent['type']) {
		const wd = WEEKDAYS[(new Date(date).getDay() + 6) % 7] ?? '月';
		draft = {
			mode: 'create',
			date,
			type,
			title: '',
			note: '',
			followsDay: wd as Weekday,
			fromDate: '',
			period: '1',
			slotMode: 'cancel',
			subject: '',
			directory: ''
		};
		saveError = null;
	}

	function startEditDraft(event: CalendarEvent) {
		const base: EventDraft = {
			mode: 'edit',
			id: event.id,
			date: event.date,
			type: event.type,
			title: '',
			note: '',
			followsDay: '月',
			fromDate: '',
			period: '1',
			slotMode: 'cancel',
			subject: '',
			directory: ''
		};
		if (event.type === 'school_holiday') {
			base.title = event.title;
			base.note = event.note ?? '';
		} else if (event.type === 'day_swap') {
			base.followsDay = event.followsDay;
			base.title = event.title ?? '';
			base.note = event.note ?? '';
		} else if (event.type === 'date_move') {
			base.fromDate = event.fromDate;
			base.title = event.title ?? '';
			base.note = event.note ?? '';
		} else {
			base.period = event.period;
			base.slotMode = event.slot ? 'override' : 'cancel';
			base.subject = event.slot?.subject ?? '';
			base.directory = event.slot?.directory ?? '';
			base.title = event.title ?? '';
			base.note = event.note ?? '';
		}
		draft = base;
		saveError = null;
	}

	function closeDraft() {
		draft = null;
		saveError = null;
	}

	function selectDirectory(directory: string) {
		if (!draft) return;
		draft.directory = directory;
		if (!draft.subject) draft.subject = directoryName(directory);
	}

	function buildPayload(draftValue: EventDraft): Record<string, unknown> | string {
		const base: Record<string, unknown> = { date: draftValue.date, type: draftValue.type };
		if (draftValue.mode === 'edit' && draftValue.id) base.id = draftValue.id;
		if (draftValue.note.trim()) base.note = draftValue.note.trim();

		if (draftValue.type === 'school_holiday') {
			const title = draftValue.title.trim();
			if (!title) return 'タイトルを入力してください';
			base.title = title;
			return base;
		}
		if (draftValue.type === 'day_swap') {
			base.followsDay = draftValue.followsDay;
			if (draftValue.title.trim()) base.title = draftValue.title.trim();
			return base;
		}
		if (draftValue.type === 'date_move') {
			const fromDate = draftValue.fromDate.trim();
			if (!fromDate) return '移動元の日付を選択してください';
			if (fromDate === draftValue.date) return '移動元と移動先は別の日付を指定してください';
			base.fromDate = fromDate;
			if (draftValue.title.trim()) base.title = draftValue.title.trim();
			return base;
		}
		base.period = draftValue.period;
		if (draftValue.slotMode === 'cancel') {
			base.slot = null;
		} else {
			const subject = draftValue.subject.trim();
			const directory = draftValue.directory.trim();
			if (!subject || !directory) return '科目名とディレクトリを指定してください';
			base.slot = { subject, directory };
		}
		if (draftValue.title.trim()) base.title = draftValue.title.trim();
		return base;
	}

	async function saveDraft() {
		if (!draft || saving) return;
		const payload = buildPayload(draft);
		if (typeof payload === 'string') {
			saveError = payload;
			return;
		}
		saving = true;
		saveError = null;
		try {
			const isEdit = draft.mode === 'edit';
			const res = await fetch('/api/calendar', {
				method: isEdit ? 'PATCH' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(body.message ?? `Failed to save (${res.status})`);
			}
			const data = (await res.json()) as { event: CalendarEvent };
			if (isEdit) {
				events = events.map((event) => (event.id === data.event.id ? data.event : event));
			} else {
				events = [...events, data.event];
			}
			draft = null;
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			saving = false;
		}
	}

	async function deleteEvent(event: CalendarEvent) {
		if (!confirm(`「${eventLabel(event)}」を削除しますか？`)) return;
		try {
			const res = await fetch(`/api/calendar?id=${encodeURIComponent(event.id)}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(body.message ?? `Failed to delete (${res.status})`);
			}
			events = events.filter((e) => e.id !== event.id);
		} catch (e) {
			calendarError = e instanceof Error ? e.message : 'Unknown error';
		}
	}

	function eventLabel(event: CalendarEvent): string {
		if (event.type === 'school_holiday') return event.title;
		if (event.type === 'day_swap')
			return event.title ?? `${event.followsDay}曜の時間割で運用`;
		if (event.type === 'date_move')
			return event.title ?? `${event.fromDate} の時間割をこの日に移動`;
		const head = event.slot ? `${event.period}限を ${event.slot.subject} に差替` : `${event.period}限を休講`;
		return event.title ?? head;
	}

	function periodOverride(event: CalendarEvent): PeriodOverrideEvent | null {
		return event.type === 'period_override' ? event : null;
	}

	onMount(() => {
		void loadDirectories();
		void loadMonth();
	});
</script>

<div class="mx-auto max-w-6xl space-y-4 p-4">
	<header class="flex flex-wrap items-center justify-between gap-2">
		<div class="flex items-center gap-2">
			<CalendarDays class="size-5 text-muted-foreground" />
			<h1 class="text-xl font-bold">{monthTitle}</h1>
			{#if viewedTerm}
				<span class="text-xs text-muted-foreground">({viewedTerm.label} の時間割)</span>
			{/if}
		</div>
		<div class="flex items-center gap-1">
			<button
				type="button"
				onclick={goPrevMonth}
				class="rounded border px-2 py-1 text-xs hover:bg-accent"
				aria-label="前の月"
			>
				<ChevronLeft class="size-4" />
			</button>
			<button
				type="button"
				onclick={goToday}
				class="rounded border px-3 py-1 text-xs font-medium hover:bg-accent"
			>
				今日
			</button>
			<button
				type="button"
				onclick={goNextMonth}
				class="rounded border px-2 py-1 text-xs hover:bg-accent"
				aria-label="次の月"
			>
				<ChevronRight class="size-4" />
			</button>
			<button
				type="button"
				onclick={() => (termEditorOpen = true)}
				disabled={!timetableSettings}
				class="ml-1 inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
				aria-label="学期設定"
				title="学期設定"
			>
				<Settings class="size-3.5" />
				<span class="hidden sm:inline">学期設定</span>
			</button>
		</div>
	</header>

	{#if calendarError}
		<div class="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
			<AlertCircle class="mt-0.5 size-4 shrink-0" />
			<span>{calendarError}</span>
		</div>
	{/if}
	{#if timetableError}
		<div class="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
			<AlertCircle class="mt-0.5 size-4 shrink-0" />
			<span>時間割の取得に失敗: {timetableError}</span>
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
		<section class="rounded-lg border bg-white p-3">
			{#if loadingCalendar || loadingTimetable}
				<div class="flex items-center gap-2 py-4 text-sm text-muted-foreground">
					<Loader2 class="size-4 animate-spin" /> 読み込み中…
				</div>
			{:else}
				<div class="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
					{#each HEAD_DAYS as h (h)}
						<div class={cn('py-1', h === '日' && 'text-red-600', h === '土' && 'text-blue-600')}>
							{h}
						</div>
					{/each}
				</div>
				<div class="grid grid-cols-7 gap-1">
					{#each monthGrid as date (date)}
						{@const schedule = resolveDaySchedule(date, timetable, events, holidays)}
						{@const wd = weekdayLabelOf(date)}
						{@const inMonth = isSameMonth(date, monthAnchor)}
						{@const holidayLabel = schedule.publicHoliday?.name ?? schedule.schoolHoliday?.title ?? null}
						<button
							type="button"
							onclick={() => (selectedDate = date)}
							class={cn(
								'flex h-24 flex-col items-stretch rounded border p-1 text-left transition hover:border-primary/60',
								!inMonth && 'bg-muted/30 text-muted-foreground/70',
								date === selectedDate && 'border-primary ring-1 ring-primary',
								date === today && 'bg-primary/5'
							)}
						>
							<div class="flex items-baseline justify-between gap-1">
								<span
									class={cn(
										'text-xs font-semibold',
										wd === '日' && 'text-red-600',
										wd === '土' && 'text-blue-600',
										date === today && 'text-primary'
									)}
								>
									{Number(date.split('-')[2])}
								</span>
								<div class="flex shrink-0 items-center gap-0.5">
									{#if schedule.inboundMove}
										<span
											class="rounded bg-emerald-100 px-1 text-[9px] font-medium text-emerald-800"
											title={`${schedule.inboundMove.fromDate} から移動`}
										>
											←{schedule.inboundMove.fromDate.slice(5)}
										</span>
									{:else if schedule.swapEvent}
										<span class="rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-800">
											→{schedule.swapEvent.followsDay}
										</span>
									{/if}
									{#if schedule.outboundMoves.length > 0}
										<span
											class="rounded bg-emerald-50 px-1 text-[9px] font-medium text-emerald-700"
											title={`${schedule.outboundMoves[0].date} へ移動`}
										>
											→{schedule.outboundMoves[0].date.slice(5)}
										</span>
									{/if}
								</div>
							</div>
							{#if holidayLabel}
								<span class="mt-0.5 line-clamp-2 rounded bg-red-100 px-1 py-0.5 text-[10px] font-medium text-red-700">
									{holidayLabel}
								</span>
							{:else}
								<ul class="mt-0.5 min-h-0 flex-1 space-y-0.5 overflow-hidden text-[10px]">
									{#each schedule.periods.filter((p) => p.slot).slice(0, 3) as entry (entry.period)}
										<li class="flex items-center gap-1 truncate">
											<span class="shrink-0 text-[9px] text-muted-foreground">{entry.period}</span>
											<span class={cn('truncate', entry.source === 'override' && 'font-medium text-amber-700')}>
												{entry.slot?.subject}
											</span>
										</li>
									{/each}
									{#if schedule.periods.filter((p) => p.slot).length > 3}
										<li class="text-[9px] text-muted-foreground">+{schedule.periods.filter((p) => p.slot).length - 3}</li>
									{/if}
								</ul>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</section>

		<aside class="rounded-lg border bg-white p-3">
			<div class="mb-2 flex items-center justify-between gap-2">
				<h2 class="text-sm font-semibold">
					{selectedDate} ({weekdayLabelOf(selectedDate)})
				</h2>
				{#if selectedSchedule.publicHoliday}
					<span class="rounded bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
						{selectedSchedule.publicHoliday.name}
					</span>
				{/if}
			</div>

			<div class="mb-3 rounded border bg-muted/30 p-2">
				<p class="mb-1 text-[11px] font-medium text-muted-foreground">この日の実効スケジュール</p>
				{#if selectedSchedule.inboundMove}
					<p class="mb-1 text-[10px] text-emerald-700">
						{selectedSchedule.inboundMove.fromDate} ({weekdayLabelOf(selectedSchedule.inboundMove.fromDate)}) の時間割をここで実施
					</p>
				{:else if selectedSchedule.followsDay}
					<p class="mb-1 text-[10px] text-amber-700">
						振替: {selectedSchedule.followsDay}曜の時間割で運用
					</p>
				{/if}
				{#each selectedSchedule.outboundMoves as move (move.id)}
					<p class="mb-1 text-[10px] text-emerald-700">
						この日の授業は {move.date} ({weekdayLabelOf(move.date)}) に移動
					</p>
				{/each}
				<ul class="space-y-0.5 text-xs">
					{#each selectedSchedule.periods as entry (entry.period)}
						<li class="flex items-center gap-2">
							<span class="w-8 shrink-0 text-[10px] text-muted-foreground">{entry.period}限</span>
							{#if entry.slot}
								<span
									class={cn(
										'truncate',
										entry.source === 'override' && 'font-medium text-amber-700'
									)}
									title={entry.slot.directory}
								>
									{entry.slot.subject}
								</span>
							{:else}
								<span class="text-[10px] text-muted-foreground/70">
									{entry.source === 'canceled' ? '休講' : '—'}
								</span>
							{/if}
						</li>
					{/each}
				</ul>
			</div>

			{#if selectedSchedule.weekday}
				{@const baseDay = selectedSchedule.followsDay ?? selectedSchedule.weekday}
				{@const baseSlots = timetable[baseDay] ?? {}}
				<div class="mb-3 rounded border bg-white p-2">
					<p class="mb-1 text-[11px] font-medium text-muted-foreground">
						{baseDay}曜の時間割を登録・編集
					</p>
					{#if slotError}
						<div class="mb-1 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-[10px] text-red-800">
							<AlertCircle class="mt-0.5 size-3 shrink-0" />
							<span>{slotError}</span>
						</div>
					{/if}
					<ul class="grid grid-cols-1 gap-0.5">
						{#each ['1', '2', '3', '4', '5', '6', '7', '8'] as p (p)}
							{@const baseSlot = baseSlots[p]}
							<li>
								<button
									type="button"
									onclick={() => openSlotEditor(baseDay, p)}
									class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
								>
									<span class="w-8 shrink-0 text-[10px] text-muted-foreground">{p}限</span>
									{#if baseSlot}
										<span class="truncate" title={baseSlot.directory}>{baseSlot.subject}</span>
									{:else}
										<span class="text-[10px] text-muted-foreground/60">＋ 追加</span>
									{/if}
									<Pencil class="ml-auto size-3 shrink-0 text-muted-foreground" />
								</button>
							</li>
						{/each}
					</ul>
					{#if selectedSchedule.followsDay && selectedSchedule.followsDay !== selectedSchedule.weekday}
						<p class="mt-1 text-[10px] text-muted-foreground">
							ヒント: この日は{selectedSchedule.followsDay}曜の時間割で運用中なので、編集は{selectedSchedule.followsDay}曜のスロットに反映されます。
						</p>
					{/if}
				</div>
			{/if}

			<div class="mb-3">
				<div class="mb-1 flex items-center justify-between">
					<p class="text-[11px] font-medium text-muted-foreground">登録イベント</p>
				</div>
				{#if selectedDayEvents.length === 0}
					<p class="text-[11px] text-muted-foreground/80">なし</p>
				{:else}
					<ul class="space-y-1">
						{#each selectedDayEvents as event (event.id)}
							<li class="flex items-start gap-1 rounded border bg-white p-1.5 text-xs">
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1">
										<span
											class={cn(
												'rounded px-1 py-0.5 text-[9px] font-medium',
												event.type === 'school_holiday' && 'bg-red-100 text-red-700',
												event.type === 'day_swap' && 'bg-amber-100 text-amber-800',
												event.type === 'date_move' && 'bg-emerald-100 text-emerald-800',
												event.type === 'period_override' && 'bg-blue-100 text-blue-800'
											)}
										>
											{event.type === 'school_holiday'
												? '休校'
												: event.type === 'day_swap'
													? '振替'
													: event.type === 'date_move'
														? '日付移動'
														: periodOverride(event)?.slot
															? '差替'
															: '休講'}
										</span>
										<span class="truncate font-medium">{eventLabel(event)}</span>
									</div>
									{#if event.note}
										<p class="mt-0.5 text-[10px] text-muted-foreground">{event.note}</p>
									{/if}
								</div>
								<button
									type="button"
									onclick={() => startEditDraft(event)}
									class="rounded p-1 text-muted-foreground hover:bg-accent"
									aria-label="編集"
								>
									<Pencil class="size-3" />
								</button>
								<button
									type="button"
									onclick={() => deleteEvent(event)}
									class="rounded p-1 text-red-600 hover:bg-red-50"
									aria-label="削除"
								>
									<Trash2 class="size-3" />
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div class="space-y-1">
				<p class="text-[11px] font-medium text-muted-foreground">この日にイベントを追加</p>
				<div class="flex flex-col gap-1">
					<button
						type="button"
						onclick={() => startDraft(selectedDate, 'school_holiday')}
						class="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
					>
						<Plus class="size-3" /> 休校 / 学校独自の休み
					</button>
					<button
						type="button"
						onclick={() => startDraft(selectedDate, 'day_swap')}
						class="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
					>
						<Plus class="size-3" /> 振替 (この日は別の曜日の時間割)
					</button>
					<button
						type="button"
						onclick={() => startDraft(selectedDate, 'date_move')}
						class="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
					>
						<Plus class="size-3" /> 授業日程の移動 (別の日から)
					</button>
					<button
						type="button"
						onclick={() => startDraft(selectedDate, 'period_override')}
						class="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
					>
						<Plus class="size-3" /> コマ単位の差替・休講
					</button>
				</div>
			</div>
		</aside>
	</div>
</div>

<TermSettingsModal
	open={termEditorOpen}
	settings={timetableSettings}
	{activeTerm}
	{viewedTerm}
	onClose={() => (termEditorOpen = false)}
	onSubmit={handleTermChange}
/>

<TimetableSlotEditor
	open={!!slotEditing}
	day={slotEditorDay}
	period={slotEditorPeriod}
	currentSlot={slotEditorCurrent}
	settings={timetableSettings}
	{viewedTerm}
	defaultStartTermId={slotEditorDefaultStart}
	defaultEndTermId={slotEditorDefaultStart}
	{directories}
	contextLabel={selectedDate}
	onSave={({ slot, startTermId, endTermId }) => commitSlot(slot, startTermId, endTermId)}
	onDelete={({ startTermId, endTermId }) => commitSlot(null, startTermId, endTermId)}
	onClose={closeSlotEditor}
/>

{#if draft}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void saveDraft();
			}}
			class="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col rounded-lg border bg-white p-4 shadow-lg"
		>
			<div class="mb-3 flex items-center justify-between">
				<h3 class="flex items-center gap-1.5 text-sm font-semibold">
					<Pencil class="size-3.5" />
					{draft.mode === 'edit' ? 'イベントを編集' : 'イベントを追加'}
				</h3>
				<button
					type="button"
					onclick={closeDraft}
					class="rounded p-1 text-muted-foreground hover:bg-accent"
					aria-label="閉じる"
				>
					<X class="size-4" />
				</button>
			</div>

			<div class="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
				<label class="block">
					<span class="mb-1 block text-xs font-medium text-muted-foreground">種別</span>
					<select
						bind:value={draft.type}
						class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
					>
						<option value="school_holiday">休校</option>
						<option value="day_swap">振替 (曜日指定)</option>
						<option value="date_move">授業日程の移動 (別日付から)</option>
						<option value="period_override">コマ差替・休講</option>
					</select>
				</label>

				{#if draft.type !== 'date_move'}
					<label class="block">
						<span class="mb-1 block text-xs font-medium text-muted-foreground">日付</span>
						<input
							type="date"
							bind:value={draft.date}
							class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
						/>
					</label>
				{/if}

				{#if draft.type === 'school_holiday'}
					<label class="block">
						<span class="mb-1 block text-xs font-medium text-muted-foreground">名前 *</span>
						<input
							type="text"
							bind:value={draft.title}
							placeholder="例: 創立記念日"
							class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
						/>
					</label>
				{:else if draft.type === 'day_swap'}
					<label class="block">
						<span class="mb-1 block text-xs font-medium text-muted-foreground">運用する曜日</span>
						<select
							bind:value={draft.followsDay}
							class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
						>
							{#each WEEKDAYS as wd (wd)}
								<option value={wd}>{wd}曜の時間割</option>
							{/each}
						</select>
					</label>
					<label class="block">
						<span class="mb-1 block text-xs font-medium text-muted-foreground">タイトル (任意)</span>
						<input
							type="text"
							bind:value={draft.title}
							placeholder="例: 月曜振替"
							class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
						/>
					</label>
				{:else if draft.type === 'date_move'}
					<div class="flex flex-col items-stretch gap-1">
						<label class="block rounded border bg-emerald-50/40 p-2">
							<span class="mb-1 block text-xs font-medium text-emerald-800">移動元 (この日の授業を…)</span>
							<input
								type="date"
								bind:value={draft.fromDate}
								class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
							/>
							{#if draft.fromDate}
								<span class="mt-1 block text-[10px] text-muted-foreground">
									{draft.fromDate} ({weekdayLabelOf(draft.fromDate)}) の時間割
								</span>
							{/if}
						</label>

						<div class="flex items-center justify-center py-0.5 text-emerald-700" aria-hidden="true">
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-5">
								<path d="M12 5v14" />
								<path d="m19 12-7 7-7-7" />
							</svg>
						</div>

						<label class="block rounded border bg-emerald-50/40 p-2">
							<span class="mb-1 block text-xs font-medium text-emerald-800">移動先 (…この日に実施)</span>
							<input
								type="date"
								bind:value={draft.date}
								class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
							/>
							{#if draft.date}
								<span class="mt-1 block text-[10px] text-muted-foreground">
									{draft.date} ({weekdayLabelOf(draft.date)})
								</span>
							{/if}
						</label>
					</div>

					<label class="block">
						<span class="mb-1 block text-xs font-medium text-muted-foreground">タイトル (任意)</span>
						<input
							type="text"
							bind:value={draft.title}
							placeholder="例: 5/4 (祝) 分の振替"
							class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
						/>
					</label>
				{:else}
					<div class="grid grid-cols-2 gap-2">
						<label class="block">
							<span class="mb-1 block text-xs font-medium text-muted-foreground">コマ</span>
							<select
								bind:value={draft.period}
								class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
							>
								{#each PERIODS as p (p)}
									<option value={p}>{p}限</option>
								{/each}
							</select>
						</label>
						<label class="block">
							<span class="mb-1 block text-xs font-medium text-muted-foreground">扱い</span>
							<select
								bind:value={draft.slotMode}
								class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
							>
								<option value="cancel">休講</option>
								<option value="override">別科目に差替</option>
							</select>
						</label>
					</div>

					{#if draft.slotMode === 'override'}
						<label class="block">
							<span class="mb-1 block text-xs font-medium text-muted-foreground">科目名 *</span>
							<input
								type="text"
								bind:value={draft.subject}
								placeholder="例: パターン認識"
								class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
							/>
						</label>
						<label class="block">
							<span class="mb-1 block text-xs font-medium text-muted-foreground">ディレクトリ *</span>
							<select
								bind:value={draft.directory}
								onchange={() => selectDirectory(draft!.directory)}
								class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
							>
								<option value="">選択してください</option>
								{#each directories as dir (dir)}
									<option value={dir}>{directoryName(dir)} ({dir})</option>
								{/each}
							</select>
						</label>
					{/if}
				{/if}

				<label class="block">
					<span class="mb-1 block text-xs font-medium text-muted-foreground">メモ (任意)</span>
					<textarea
						bind:value={draft.note}
						rows="2"
						class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
					></textarea>
				</label>

				{#if saveError}
					<div class="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
						<AlertCircle class="mt-0.5 size-4 shrink-0" />
						<span>{saveError}</span>
					</div>
				{/if}
			</div>

			<div class="mt-4 flex shrink-0 items-center justify-end gap-2">
				<button
					type="button"
					onclick={closeDraft}
					class="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
				>
					キャンセル
				</button>
				<button
					type="submit"
					disabled={saving}
					class={cn(
						'inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground',
						saving && 'opacity-50'
					)}
				>
					<Save class="size-3.5" /> 保存
				</button>
			</div>
		</form>
	</div>
{/if}
