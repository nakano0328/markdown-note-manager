<script lang="ts">
	import { AlertCircle, Clock, Minus, Plus, Save, X } from 'lucide-svelte';
	import { DEFAULT_PERIOD_TIMES, MAX_PERIODS, effectivePeriodTimes } from '$lib/period-times';
	import type { PeriodTime, TimetableSettings } from '$lib/types';

	interface Props {
		open: boolean;
		settings: TimetableSettings | null;
		onClose: () => void;
		onSubmit: (periodTimes: PeriodTime[]) => Promise<void> | void;
	}

	let { open, settings, onClose, onSubmit }: Props = $props();

	let draft = $state<PeriodTime[]>([]);
	let saving = $state(false);
	let errorMessage = $state<string | null>(null);
	let initialized = $state(false);

	$effect(() => {
		if (!open) {
			initialized = false;
			errorMessage = null;
			return;
		}
		if (initialized) return;
		draft = effectivePeriodTimes(settings).map((p) => ({ start: p.start, end: p.end }));
		errorMessage = null;
		initialized = true;
	});

	function addPeriod() {
		if (draft.length >= MAX_PERIODS) return;
		const last = draft[draft.length - 1];
		const fallback = DEFAULT_PERIOD_TIMES[draft.length] ?? { start: '00:00', end: '00:00' };
		draft = [
			...draft,
			{
				start: last ? last.end : fallback.start,
				end: fallback.end
			}
		];
		errorMessage = null;
	}

	function removePeriod() {
		if (draft.length <= 1) return;
		draft = draft.slice(0, -1);
		errorMessage = null;
	}

	function validate(): string | null {
		const HHMM = /^\d{2}:\d{2}$/;
		for (let i = 0; i < draft.length; i++) {
			const { start, end } = draft[i];
			if (!HHMM.test(start) || !HHMM.test(end)) {
				return `${i + 1}限の時刻は HH:MM 形式で入力してください`;
			}
			if (start >= end) {
				return `${i + 1}限の開始時刻は終了時刻より前にしてください`;
			}
			if (i > 0 && start < draft[i - 1].end) {
				return `${i + 1}限の開始時刻は${i}限の終了時刻以降にしてください`;
			}
		}
		return null;
	}

	async function submit() {
		if (saving) return;
		const validationError = validate();
		if (validationError) {
			errorMessage = validationError;
			return;
		}
		saving = true;
		errorMessage = null;
		try {
			await onSubmit(draft.map((p) => ({ start: p.start, end: p.end })));
			onClose();
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : '授業時間の保存に失敗しました';
		} finally {
			saving = false;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
			class="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-lg border bg-white p-4 shadow-lg"
		>
			<div class="mb-3 flex items-center justify-between">
				<h3 class="flex items-center gap-1.5 text-sm font-semibold">
					<Clock class="size-3.5" />
					授業時間の設定
				</h3>
				<button
					type="button"
					onclick={onClose}
					class="rounded p-1 text-muted-foreground hover:bg-accent"
					aria-label="閉じる"
				>
					<X class="size-4" />
				</button>
			</div>

			<p class="mb-3 text-[11px] text-muted-foreground">
				ここで指定したコマ数だけ、時間割やカレンダーに反映されます。
			</p>

			<div class="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
				{#each draft as period, index (index)}
					<div class="flex items-center gap-2">
						<span class="w-10 shrink-0 text-xs font-medium text-muted-foreground">
							{index + 1}限
						</span>
						<input
							type="time"
							bind:value={period.start}
							class="w-28 rounded border bg-white px-2 py-1 text-sm focus:border-primary focus:outline-none"
							required
						/>
						<span class="text-xs text-muted-foreground">〜</span>
						<input
							type="time"
							bind:value={period.end}
							class="w-28 rounded border bg-white px-2 py-1 text-sm focus:border-primary focus:outline-none"
							required
						/>
					</div>
				{/each}
			</div>

			<div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
				<div class="flex items-center gap-1">
					<button
						type="button"
						onclick={removePeriod}
						disabled={draft.length <= 1}
						class="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
					>
						<Minus class="size-3" />
						コマを減らす
					</button>
					<button
						type="button"
						onclick={addPeriod}
						disabled={draft.length >= MAX_PERIODS}
						class="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
					>
						<Plus class="size-3" />
						コマを増やす
					</button>
				</div>
				<span class="text-[10px] text-muted-foreground">合計 {draft.length} コマ</span>
			</div>

			{#if errorMessage}
				<div class="mt-3 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
					<AlertCircle class="mt-0.5 size-4 shrink-0" />
					<span>{errorMessage}</span>
				</div>
			{/if}

			<div class="mt-3 flex shrink-0 items-center justify-end gap-2">
				<button
					type="button"
					onclick={onClose}
					class="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
				>
					キャンセル
				</button>
				<button
					type="submit"
					disabled={saving}
					class="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
				>
					<Save class="size-3.5" /> 保存
				</button>
			</div>
		</form>
	</div>
{/if}
