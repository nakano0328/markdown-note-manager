<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Clock, BookOpen, FilePlus, ArrowRight } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { resolveCurrentPeriod, type NowSnapshot } from '$lib/calendar';
	import { buildPeriodWindow, getPeriodTime } from '$lib/period-times';
	import { newNote } from '$lib/stores/new-note.svelte';
	import { cn } from '$lib/utils';
	import type { DaySchedule, TimetableSettings } from '$lib/types';

	interface Props {
		todaySchedule: DaySchedule;
		settings: TimetableSettings | null;
	}

	let { todaySchedule, settings }: Props = $props();

	let now = $state(new Date());
	let intervalId: ReturnType<typeof setInterval> | null = null;
	let opening = $state(false);
	let openError = $state<string | null>(null);

	const periodWindowFn = $derived(buildPeriodWindow(settings));
	const snapshot = $derived<NowSnapshot>(resolveCurrentPeriod(now, todaySchedule, periodWindowFn));

	function encodeFilePath(filePath: string): string {
		return filePath.split('/').map(encodeURIComponent).join('/');
	}

	async function openLatestOrCreate(directory: string, subject: string) {
		opening = true;
		openError = null;
		try {
			const res = await fetch(`/api/notes?directory=${encodeURIComponent(directory)}`);
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(body.message ?? `Failed (${res.status})`);
			}
			const data = (await res.json()) as { previousFile: string | null };
			if (data.previousFile) {
				await goto(`/note/${encodeFilePath(`${directory}/${data.previousFile}`)}`);
			} else {
				newNote.request({ directory, subject, titleHint: '' });
			}
		} catch (e) {
			openError = e instanceof Error ? e.message : 'ノートを開けませんでした';
		} finally {
			opening = false;
		}
	}

	function createNew(directory: string, subject: string) {
		newNote.request({ directory, subject, titleHint: '' });
	}

	function formatRemaining(min: number): string {
		if (min < 60) return `${min}分`;
		const h = Math.floor(min / 60);
		const m = min % 60;
		return m === 0 ? `${h}時間` : `${h}時間${m}分`;
	}

	onMount(() => {
		now = new Date();
		intervalId = setInterval(() => {
			now = new Date();
		}, 30_000);
	});

	onDestroy(() => {
		if (intervalId) clearInterval(intervalId);
	});

	const periodLabel = $derived(snapshot.current?.period ?? snapshot.next?.period ?? null);
	const periodTime = $derived(periodLabel ? getPeriodTime(periodLabel, settings) : null);
</script>

{#if snapshot.status === 'in_class' && snapshot.current}
	{@const cur = snapshot.current}
	<section
		class="rounded-lg border border-primary/40 bg-primary/5 p-3 shadow-sm"
		aria-live="polite"
	>
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
			<span class="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
				<Clock class="size-3" />
				LIVE
			</span>
			<span class="font-semibold">
				{cur.period}限 {cur.slot.subject}
			</span>
			<span class="text-xs text-muted-foreground">
				{periodTime?.start}〜{periodTime?.end} ／ 残り {formatRemaining(cur.minutesLeft)}
			</span>
		</div>

		{#if cur.slot.directory}
			<div class="mt-2 flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={() => createNew(cur.slot.directory, cur.slot.subject)}
					class="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
				>
					<FilePlus class="size-3.5" />
					新規ノート
					<ArrowRight class="size-3" />
				</button>
				<button
					type="button"
					onclick={() => openLatestOrCreate(cur.slot.directory, cur.slot.subject)}
					disabled={opening}
					class="inline-flex items-center gap-1 rounded border bg-white px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
				>
					<BookOpen class="size-3.5" />
					最新ノートを開く
				</button>
				{#if openError}
					<span class="text-[11px] text-red-700">{openError}</span>
				{/if}
			</div>
		{/if}
	</section>
{:else if snapshot.next}
	{@const nxt = snapshot.next}
	{@const soon = nxt.minutesUntil <= 15}
	<section
		class={cn(
			'rounded-lg border p-3',
			soon ? 'border-amber-300 bg-amber-50' : 'border-muted bg-muted/30'
		)}
	>
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
			<Clock class={cn('size-4', soon ? 'text-amber-700' : 'text-muted-foreground')} />
			<span class={cn(soon && 'font-semibold text-amber-900')}>
				次は {nxt.period}限 {nxt.slot.subject}
			</span>
			<span class="text-xs text-muted-foreground">
				{periodTime?.start}〜{periodTime?.end} ／ あと {formatRemaining(nxt.minutesUntil)}
			</span>
		</div>
		{#if nxt.slot.directory && soon}
			<div class="mt-2 flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={() => openLatestOrCreate(nxt.slot.directory, nxt.slot.subject)}
					disabled={opening}
					class="inline-flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
				>
					<BookOpen class="size-3.5" />
					最新ノートを開く
				</button>
				{#if openError}
					<span class="text-[11px] text-red-700">{openError}</span>
				{/if}
			</div>
		{/if}
	</section>
{:else if snapshot.status === 'after_last'}
	<section class="rounded-lg border border-muted bg-muted/20 p-3 text-sm text-muted-foreground">
		<Clock class="mr-1 inline size-3.5 align-[-2px]" />
		本日の授業は終了しました。お疲れさまでした。
	</section>
{/if}
