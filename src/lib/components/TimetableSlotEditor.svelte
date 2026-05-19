<script lang="ts">
	import { AlertCircle, ChevronDown, Pencil, Save, Trash2, X } from 'lucide-svelte';
	import type { TimetableSettings, TimetableSlot, TimetableTerm } from '$lib/types';
	import { directoryName } from '$lib/timetable-client';
	import { cn } from '$lib/utils';

	interface Props {
		open: boolean;
		day: string;
		period: string;
		currentSlot: TimetableSlot | null;
		settings: TimetableSettings | null;
		viewedTerm: TimetableTerm | null;
		defaultStartTermId: string;
		defaultEndTermId: string;
		directories: string[];
		contextLabel?: string;
		onSave: (args: {
			slot: TimetableSlot;
			startTermId: string;
			endTermId: string;
		}) => Promise<void> | void;
		onDelete?: (args: { startTermId: string; endTermId: string }) => Promise<void> | void;
		onClose: () => void;
	}

	let {
		open,
		day,
		period,
		currentSlot,
		settings,
		viewedTerm,
		defaultStartTermId,
		defaultEndTermId,
		directories,
		contextLabel = '',
		onSave,
		onDelete,
		onClose
	}: Props = $props();

	let subject = $state('');
	let directory = $state('');
	let startTermId = $state('');
	let endTermId = $state('');
	let directoryMenuOpen = $state(false);
	let saving = $state(false);
	let errorMessage = $state<string | null>(null);
	let initialized = $state(false);

	const orderedTerms = $derived(
		[...(settings?.terms ?? [])].sort((a, b) => {
			const byStart = a.startsAt.localeCompare(b.startsAt);
			if (byStart !== 0) return byStart;
			return a.endsAt.localeCompare(b.endsAt);
		})
	);

	const applyUntilTerms = $derived.by(() => {
		const startIndex = orderedTerms.findIndex((term) => term.id === startTermId);
		return startIndex >= 0 ? orderedTerms.slice(startIndex) : orderedTerms;
	});

	$effect(() => {
		if (!open) {
			initialized = false;
			return;
		}
		if (initialized) return;
		subject = currentSlot?.subject ?? '';
		directory = currentSlot?.directory ?? '';
		startTermId = defaultStartTermId;
		endTermId = defaultEndTermId || defaultStartTermId;
		directoryMenuOpen = false;
		errorMessage = null;
		initialized = true;
	});

	$effect(() => {
		if (!startTermId || !endTermId) return;
		const startIdx = orderedTerms.findIndex((t) => t.id === startTermId);
		const endIdx = orderedTerms.findIndex((t) => t.id === endTermId);
		if (startIdx >= 0 && endIdx >= 0 && endIdx < startIdx) endTermId = startTermId;
	});

	function pickDirectory(value: string) {
		directory = value;
		if (!subject) subject = directoryName(value);
		directoryMenuOpen = false;
		errorMessage = null;
	}

	async function submit() {
		if (saving) return;
		const subjectTrim = subject.trim();
		const directoryTrim = directory.trim();
		if (!subjectTrim || !directoryTrim) {
			errorMessage = '科目名とディレクトリを指定してください';
			return;
		}
		if (!startTermId || !endTermId) {
			errorMessage = '対象学期を選択してください';
			return;
		}
		saving = true;
		errorMessage = null;
		try {
			await onSave({
				slot: { subject: subjectTrim, directory: directoryTrim },
				startTermId,
				endTermId
			});
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : '保存に失敗しました';
		} finally {
			saving = false;
		}
	}

	async function remove() {
		if (!onDelete || saving) return;
		saving = true;
		errorMessage = null;
		try {
			await onDelete({ startTermId, endTermId });
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : '削除に失敗しました';
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
			class="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col rounded-lg border bg-white p-4 shadow-lg"
		>
			<div class="mb-3 flex items-center justify-between">
				<h3 class="flex items-center gap-1.5 text-sm font-semibold">
					<Pencil class="size-3.5" />
					{day}曜 {period}限
					{#if contextLabel}
						<span class="text-[10px] font-normal text-muted-foreground">({contextLabel})</span>
					{/if}
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

			<div class="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
				<label class="block">
					<span class="mb-1 block text-xs font-medium text-muted-foreground">科目名</span>
					<input
						type="text"
						bind:value={subject}
						oninput={() => (errorMessage = null)}
						placeholder="例: パターン認識"
						class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
					/>
				</label>

				<div class="block">
					<span class="mb-1 block text-xs font-medium text-muted-foreground">ディレクトリ</span>
					<div class="relative">
						<button
							type="button"
							onclick={() => (directoryMenuOpen = !directoryMenuOpen)}
							class={cn(
								'flex w-full items-center justify-between gap-2 rounded border bg-white px-2 py-1.5 text-left text-sm focus:border-primary focus:outline-none',
								!directory && 'text-muted-foreground'
							)}
							aria-expanded={directoryMenuOpen}
							aria-label="ディレクトリを選択"
						>
							<span class="min-w-0 flex-1 truncate">
								{directory || '例: 2年生/春/パターン認識'}
							</span>
							<ChevronDown class={cn('size-4 shrink-0 transition', directoryMenuOpen && 'rotate-180')} />
						</button>

						{#if directoryMenuOpen}
							<div class="mt-1 max-h-48 overflow-y-auto rounded border bg-white shadow-sm">
								{#if directories.length === 0}
									<div class="px-2 py-2 text-xs text-muted-foreground">
										対象の科目ディレクトリがありません
									</div>
								{:else}
									{#each directories as dir (dir)}
										<button
											type="button"
											onclick={() => pickDirectory(dir)}
											class={cn(
												'block w-full border-b px-2 py-2 text-left text-sm last:border-b-0 hover:bg-accent',
												directory === dir && 'bg-primary/10 text-primary'
											)}
										>
											<span class="block font-medium">{directoryName(dir)}</span>
											<span class="block truncate text-[11px] text-muted-foreground">{dir}</span>
										</button>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				</div>

				{#if orderedTerms.length > 0}
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						<label class="block">
							<span class="mb-1 block text-xs font-medium text-muted-foreground">対象学期 (開始)</span>
							<select
								bind:value={startTermId}
								class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
							>
								{#each orderedTerms as term (term.id)}
									<option value={term.id}>{term.label}</option>
								{/each}
							</select>
						</label>
						<label class="block">
							<span class="mb-1 block text-xs font-medium text-muted-foreground">適用する終了学期</span>
							<select
								bind:value={endTermId}
								class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
							>
								{#each applyUntilTerms as term (term.id)}
									<option value={term.id}>{term.label}</option>
								{/each}
							</select>
						</label>
					</div>
					{#if startTermId && viewedTerm && startTermId !== viewedTerm.id}
						<p class="text-[10px] text-muted-foreground">
							ヒント: 開始学期が表示中の学期と異なるため、画面の時間割表示は変化しません。
						</p>
					{/if}
				{/if}

				{#if errorMessage}
					<div class="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
						<AlertCircle class="mt-0.5 size-4 shrink-0" />
						<span>{errorMessage}</span>
					</div>
				{/if}
			</div>

			<div class="mt-4 flex shrink-0 items-center justify-between">
				{#if currentSlot && onDelete}
					<button
						type="button"
						onclick={remove}
						disabled={saving}
						class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
					>
						<Trash2 class="size-3.5" /> 削除
					</button>
				{:else}
					<span></span>
				{/if}
				<div class="flex items-center gap-2">
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
						class={cn(
							'inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground',
							saving && 'opacity-50'
						)}
					>
						<Save class="size-3.5" /> 保存
					</button>
				</div>
			</div>
		</form>
	</div>
{/if}
