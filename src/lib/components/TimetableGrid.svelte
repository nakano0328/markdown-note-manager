<script lang="ts">
	import { onMount } from 'svelte';
	import { Clock, Loader2, Pencil, Settings } from 'lucide-svelte';
	import {
		WEEKDAYS,
		type PeriodTime,
		type Timetable,
		type TimetableSettings,
		type TimetableSlot,
		type TimetableTerm,
		type TreeNode,
		type Weekday
	} from '$lib/types';
	import { cn } from '$lib/utils';
	import { collectSubjectDirectories, persistTimetableSlots } from '$lib/timetable-client';
	import { newNote } from '$lib/stores/new-note.svelte';
	import { effectivePeriodTimes, enabledPeriods } from '$lib/period-times';
	import TermSettingsModal from './TermSettingsModal.svelte';
	import PeriodTimesModal from './PeriodTimesModal.svelte';
	import TimetableSlotEditor from './TimetableSlotEditor.svelte';

	const WEEKEND_DAYS = new Set<Weekday>(['土', '日']);
	type Day = Weekday;

	interface Props {
		timetable: Timetable;
		todayDay: string | null;
		settings: TimetableSettings | null;
		activeTerm: TimetableTerm | null;
		viewedTerm: TimetableTerm | null;
		onChange: (next: Timetable) => Promise<void> | void;
		onTermChange: (term: Partial<TimetableTerm>) => Promise<void> | void;
		onViewedTermChange: (termId: string) => Promise<void> | void;
		onPeriodTimesChange: (periodTimes: PeriodTime[]) => Promise<void> | void;
	}

	let {
		timetable,
		todayDay,
		settings,
		activeTerm,
		viewedTerm,
		onChange,
		onTermChange,
		onViewedTermChange,
		onPeriodTimesChange
	}: Props = $props();

	let directories = $state<string[]>([]);
	let directoriesError = $state<string | null>(null);
	let saving = $state(false);
	let termEditorOpen = $state(false);
	let periodTimesEditorOpen = $state(false);
	let showWeekends = $state(false);

	let editingDay = $state<Day | null>(null);
	let editingPeriod = $state<string | null>(null);

	const periods = $derived(enabledPeriods(settings));
	const periodTimes = $derived(effectivePeriodTimes(settings));
	const visibleDays = $derived(
		showWeekends ? WEEKDAYS : WEEKDAYS.filter((day) => !WEEKEND_DAYS.has(day))
	);

	const orderedTerms = $derived.by(() =>
		[...(settings?.terms ?? [])].sort((a, b) => {
			const byStart = a.startsAt.localeCompare(b.startsAt);
			if (byStart !== 0) return byStart;
			return a.endsAt.localeCompare(b.endsAt);
		})
	);

	async function loadDirectories() {
		try {
			const res = await fetch('/api/tree');
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(body.message ?? `Failed to load tree (${res.status})`);
			}
			const data = (await res.json()) as { tree: TreeNode[] };
			directories = collectSubjectDirectories(data.tree);
		} catch (e) {
			directoriesError = e instanceof Error ? e.message : 'Unknown error';
		}
	}

	async function commitSlot(
		slot: TimetableSlot | null,
		startTermId: string,
		endTermId: string,
		periodCount = 1
	) {
		if (!editingDay || !editingPeriod) return;
		const day = editingDay;
		const startIndex = periods.indexOf(editingPeriod);
		const targetPeriods =
			startIndex >= 0 ? periods.slice(startIndex, startIndex + periodCount) : [editingPeriod];
		saving = true;
		try {
			const data = await persistTimetableSlots({
				updates: targetPeriods.map((period) => ({ day, period, slot })),
				startTermId,
				endTermId,
				viewedTerm,
				viewedTimetable: timetable
			});
			const viewedResult =
				startTermId === viewedTerm?.id ? (data.timetable ?? {}) : timetable;
			await onChange(viewedResult);
			closeEditor();
		} finally {
			saving = false;
		}
	}

	function openEditor(day: Day, period: string) {
		editingDay = day;
		editingPeriod = period;
	}

	function handleCellClick(day: Day, period: string, slot: TimetableSlot | undefined) {
		if (slot && slot.directory) {
			newNote.request({
				directory: slot.directory,
				subject: slot.subject,
				titleHint: ''
			});
			return;
		}
		openEditor(day, period);
	}

	function closeEditor() {
		editingDay = null;
		editingPeriod = null;
	}

	const editorCurrentSlot = $derived<TimetableSlot | null>(
		editingDay && editingPeriod ? (timetable[editingDay]?.[editingPeriod] ?? null) : null
	);
	const editorRemainingPeriods = $derived(
		editingPeriod && periods.includes(editingPeriod)
			? periods.slice(periods.indexOf(editingPeriod))
			: [editingPeriod ?? '1']
	);

	onMount(loadDirectories);
</script>

<section class="rounded-lg border bg-white p-4">
	<div class="mb-3 flex items-center justify-between">
		<div class="min-w-0">
			<h2 class="text-sm font-semibold">時間割</h2>
		</div>
		<div class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
			{#if saving}
				<span class="flex items-center gap-1">
					<Loader2 class="size-3 animate-spin" /> 保存中…
				</span>
			{/if}
			{#if directoriesError}
				<span class="text-red-700" title={directoriesError}>ディレクトリ取得失敗</span>
			{/if}
			{#if orderedTerms.length > 0}
				<select
					value={viewedTerm?.id ?? ''}
					onchange={(event) => void onViewedTermChange(event.currentTarget.value)}
					class="max-w-44 rounded border bg-white px-2 py-1 text-xs text-foreground"
					aria-label="表示する学期"
				>
					{#each orderedTerms as term (term.id)}
						<option value={term.id}>{term.label}</option>
					{/each}
				</select>
			{/if}
			<label
				class="inline-flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs font-medium text-foreground hover:bg-accent"
				title="土日列を表示"
			>
				<input type="checkbox" bind:checked={showWeekends} class="size-3" />
				<span>土日表示</span>
			</label>
			<button
				type="button"
				onclick={() => (periodTimesEditorOpen = true)}
				disabled={!settings}
				class="inline-flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
				aria-label="授業時間"
				title="授業時間"
			>
				<Clock class="size-3.5" />
				<span class="hidden sm:inline">授業時間</span>
			</button>
			<button
				type="button"
				onclick={() => (termEditorOpen = true)}
				disabled={!settings}
				class="inline-flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
				aria-label="学期設定"
				title="学期設定"
			>
				<Settings class="size-3.5" />
				<span class="hidden sm:inline">学期設定</span>
			</button>
		</div>
	</div>

	{#if !activeTerm}
		<div class="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
			時間割の学期設定を読み込めませんでした。
		</div>
	{/if}

		<div class="overflow-x-auto">
			<table class="w-full table-fixed border-collapse border border-black text-sm">
				<thead>
					<tr>
						<th class="w-20 border-b border-r bg-muted/50 px-1 py-1 text-xs font-medium text-muted-foreground"></th>
						{#each visibleDays as day (day)}
							<th
								class={cn(
									'border-b border-r px-2 py-1 text-xs font-semibold',
									todayDay === day ? 'bg-primary/10 text-primary' : 'bg-muted/40'
								)}
							>
								{day}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each periods as period, index (period)}
						{@const pt = periodTimes[index]}
						<tr>
							<th
								class="border-b border-r bg-muted/40 px-1 py-1 text-center text-xs font-medium text-muted-foreground"
							>
								<div class="font-semibold text-foreground">{period}限</div>
								{#if pt}
									<div class="mt-0.5 whitespace-nowrap text-[9px] font-normal leading-tight tabular-nums text-muted-foreground">
										{pt.start}〜{pt.end}
									</div>
								{/if}
							</th>
							{#each visibleDays as day (day)}
								{@const slot = timetable[day]?.[period]}
								<td
									class={cn(
										'border-b border-r p-0 align-top',
										todayDay === day && 'bg-primary/5'
									)}
								>
									<div class="group relative h-16 w-full">
										<button
											type="button"
											onclick={() => handleCellClick(day, period, slot)}
											class={cn(
												'flex h-full w-full flex-col justify-between p-1.5 text-left transition hover:bg-accent',
												!slot && 'text-muted-foreground'
											)}
											aria-label={slot
												? `${day}曜${period}限 (${slot.subject}) のノートを新規作成`
												: `${day}曜${period}限を追加`}
										>
											{#if slot}
												<span class="line-clamp-3 text-[11px] font-medium leading-tight text-foreground">
													{slot.subject}
												</span>
											{:else}
												<span class="text-xs opacity-50 transition group-hover:opacity-100">＋</span>
											{/if}
										</button>
										{#if slot}
											<button
												type="button"
												onclick={(event) => {
													event.stopPropagation();
													openEditor(day, period);
												}}
												class="absolute right-1 top-1 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100 focus:opacity-100"
												aria-label={`${day}曜${period}限のコマを編集`}
												title="コマを編集"
											>
												<Pencil class="size-3" />
											</button>
										{/if}
									</div>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
</section>

<TermSettingsModal
	open={termEditorOpen}
	{settings}
	{activeTerm}
	{viewedTerm}
	onClose={() => (termEditorOpen = false)}
	onSubmit={onTermChange}
/>

<PeriodTimesModal
	open={periodTimesEditorOpen}
	{settings}
	onClose={() => (periodTimesEditorOpen = false)}
	onSubmit={onPeriodTimesChange}
/>

<TimetableSlotEditor
	open={!!(editingDay && editingPeriod)}
	day={editingDay ?? '月'}
	period={editingPeriod ?? '1'}
	currentSlot={editorCurrentSlot}
	remainingPeriods={editorRemainingPeriods}
	{settings}
	{viewedTerm}
	defaultStartTermId={viewedTerm?.id ?? ''}
	defaultEndTermId={viewedTerm?.id ?? ''}
	{directories}
	onSave={({ slot, startTermId, endTermId, periodCount }) =>
		commitSlot(slot, startTermId, endTermId, periodCount)}
	onDelete={({ startTermId, endTermId }) => commitSlot(null, startTermId, endTermId)}
	onClose={closeEditor}
/>
