<script lang="ts">
	import { AlertCircle, Save, Settings, X } from 'lucide-svelte';
	import type { TimetableSettings, TimetableTerm } from '$lib/types';

	interface Props {
		open: boolean;
		settings: TimetableSettings | null;
		activeTerm: TimetableTerm | null;
		viewedTerm: TimetableTerm | null;
		onClose: () => void;
		onSubmit: (term: Partial<TimetableTerm>) => Promise<void> | void;
	}

	let { open, settings, activeTerm, viewedTerm, onClose, onSubmit }: Props = $props();

	let saving = $state(false);
	let errorMessage = $state<string | null>(null);
	let selectedId = $state('');
	let label = $state('');
	let startsAt = $state('');
	let endsAt = $state('');
	let initialized = $state(false);

	const orderedTerms = $derived(
		[...(settings?.terms ?? [])].sort((a, b) => {
			const byStart = a.startsAt.localeCompare(b.startsAt);
			if (byStart !== 0) return byStart;
			return a.endsAt.localeCompare(b.endsAt);
		})
	);

	$effect(() => {
		if (!open) {
			initialized = false;
			errorMessage = null;
			return;
		}
		if (initialized) return;
		const term = viewedTerm ?? activeTerm;
		loadTerm(term);
		initialized = true;
	});

	function loadTerm(term: TimetableTerm | null | undefined) {
		selectedId = term?.id ?? '';
		label = term?.label ?? '';
		startsAt = term?.startsAt ?? '';
		endsAt = term?.endsAt ?? '';
		errorMessage = null;
	}

	function handleSelection(value: string) {
		const term = orderedTerms.find((item) => item.id === value);
		loadTerm(term ?? null);
	}

	function todayLocal(): string {
		const now = new Date();
		const y = now.getFullYear();
		const m = String(now.getMonth() + 1).padStart(2, '0');
		const d = String(now.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}

	function addDays(date: string, days: number): string {
		const [y, m, d] = date.split('-').map(Number);
		const next = new Date(y, m - 1, d + days);
		const yy = next.getFullYear();
		const mm = String(next.getMonth() + 1).padStart(2, '0');
		const dd = String(next.getDate()).padStart(2, '0');
		return `${yy}-${mm}-${dd}`;
	}

	function startDraft() {
		const last = orderedTerms.at(-1);
		const start = last ? addDays(last.endsAt, 1) : todayLocal();
		selectedId = '';
		label = '新しい学期';
		startsAt = start;
		endsAt = start;
		errorMessage = null;
	}

	async function submit() {
		if (saving) return;
		if (!startsAt || !/^\d{4}-\d{2}-\d{2}$/.test(startsAt)) {
			errorMessage = '開始日を YYYY-MM-DD 形式で指定してください';
			return;
		}
		if (!endsAt || !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) {
			errorMessage = '終了日を YYYY-MM-DD 形式で指定してください';
			return;
		}
		if (startsAt > endsAt) {
			errorMessage = '開始日は終了日以前にしてください';
			return;
		}
		saving = true;
		errorMessage = null;
		try {
			await onSubmit({
				id: selectedId || undefined,
				label: label.trim() || '新しい学期',
				startsAt,
				endsAt
			});
			onClose();
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : '学期設定の保存に失敗しました';
		} finally {
			saving = false;
		}
	}
</script>

{#if open && settings}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
			class="w-full max-w-md rounded-lg border bg-white p-4 shadow-lg"
		>
			<div class="mb-3 flex items-center justify-between">
				<h3 class="flex items-center gap-1.5 text-sm font-semibold">
					<Settings class="size-3.5" />
					学期設定
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

			<div class="space-y-3">
				<div class="flex items-end gap-2">
					<label class="block min-w-0 flex-1">
						<span class="mb-1 block text-xs font-medium text-muted-foreground">編集する学期</span>
						<select
							value={selectedId}
							onchange={(event) => handleSelection(event.currentTarget.value)}
							class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
						>
							{#each orderedTerms as term (term.id)}
								<option value={term.id}>{term.label}</option>
							{/each}
						</select>
					</label>
					<button
						type="button"
						onclick={startDraft}
						class="rounded border px-3 py-1.5 text-xs font-medium hover:bg-accent"
					>
						新規
					</button>
				</div>

				<label class="block">
					<span class="mb-1 block text-xs font-medium text-muted-foreground">学期名</span>
					<input
						type="text"
						bind:value={label}
						oninput={() => (errorMessage = null)}
						class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
					/>
				</label>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<label class="block">
						<span class="mb-1 block text-xs font-medium text-muted-foreground">開始日</span>
						<input
							type="date"
							bind:value={startsAt}
							oninput={() => (errorMessage = null)}
							class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
						/>
					</label>
					<label class="block">
						<span class="mb-1 block text-xs font-medium text-muted-foreground">終了日</span>
						<input
							type="date"
							bind:value={endsAt}
							oninput={() => (errorMessage = null)}
							class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
						/>
					</label>
				</div>

				{#if errorMessage}
					<div class="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
						<AlertCircle class="mt-0.5 size-4 shrink-0" />
						<span>{errorMessage}</span>
					</div>
				{/if}
			</div>

			<div class="mt-4 flex items-center justify-end gap-2">
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
