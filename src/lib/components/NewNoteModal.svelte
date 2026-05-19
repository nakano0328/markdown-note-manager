<script lang="ts">
	import { AlertCircle, FilePlus, Loader2, Save, X } from 'lucide-svelte';
	import { cn } from '$lib/utils';

	interface CreatedNote {
		path: string;
		filename: string;
		sequence: string;
	}

	interface Props {
		open: boolean;
		directory: string;
		subject?: string;
		titleHint?: string;
		onClose: () => void;
		onCreated?: (note: CreatedNote) => void;
	}

	interface PreviewState {
		nextSequence: string;
		suggestedTitle: string;
		date: string;
		location: string;
		tags: string[];
		previousFile: string | null;
	}

	let { open, directory, subject = '', titleHint = '', onClose, onCreated }: Props = $props();

	let title = $state('');
	let date = $state('');
	let location = $state('');
	let slideUrl = $state('');
	let tagsInput = $state('');
	let preview = $state<PreviewState | null>(null);
	let loadingPreview = $state(false);
	let creating = $state(false);
	let errorMessage = $state<string | null>(null);
	let initialized = $state(false);
	let lastKey = $state<string>('');

	const key = $derived(`${directory}::${titleHint}`);

	$effect(() => {
		if (!open) {
			initialized = false;
			lastKey = '';
			return;
		}
		if (initialized && lastKey === key) return;
		initialized = true;
		lastKey = key;
		title = titleHint;
		date = '';
		location = '';
		slideUrl = '';
		tagsInput = '';
		errorMessage = null;
		preview = null;
		void loadPreview();
	});

	async function loadPreview() {
		if (!directory) return;
		loadingPreview = true;
		try {
			const params = new URLSearchParams({ directory });
			if (titleHint) params.set('title', titleHint);
			const res = await fetch(`/api/notes?${params.toString()}`);
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(body.message ?? `Failed to load preview (${res.status})`);
			}
			const data = (await res.json()) as PreviewState;
			preview = data;
			if (!date) date = data.date;
			if (!location) location = data.location;
			if (!tagsInput && data.tags.length > 0) tagsInput = data.tags.join(', ');
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : 'プレビューの取得に失敗しました';
		} finally {
			loadingPreview = false;
		}
	}

	async function submit() {
		if (creating) return;
		const trimmed = title.trim();
		if (!trimmed) {
			errorMessage = 'タイトルを入力してください';
			return;
		}
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			errorMessage = '日付は YYYY-MM-DD 形式で入力してください';
			return;
		}
		creating = true;
		errorMessage = null;
		try {
			const tags = tagsInput
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);
			const res = await fetch('/api/notes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					directory,
					title: trimmed,
					date,
					location: location.trim() || undefined,
					slideUrl: slideUrl.trim() || undefined,
					tags: tags.length > 0 ? tags : undefined
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(body.message ?? `作成に失敗しました (${res.status})`);
			}
			const data = (await res.json()) as CreatedNote;
			onCreated?.(data);
			onClose();
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : '作成に失敗しました';
		} finally {
			creating = false;
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
					<FilePlus class="size-3.5" />
					新規ノート作成
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
				<div class="rounded border bg-muted/40 p-2 text-[11px] text-muted-foreground">
					<div class="flex justify-between gap-2">
						<span>保存先</span>
						<span class="truncate font-medium text-foreground" title={directory}>{directory}</span>
					</div>
					{#if subject}
						<div class="mt-1 flex justify-between gap-2">
							<span>科目</span>
							<span class="font-medium text-foreground">{subject}</span>
						</div>
					{/if}
					{#if loadingPreview}
						<div class="mt-1 flex items-center gap-1">
							<Loader2 class="size-3 animate-spin" /> 連番情報を取得中…
						</div>
					{:else if preview}
						<div class="mt-1 flex justify-between gap-2">
							<span>次の連番</span>
							<span class="font-mono text-foreground">{preview.nextSequence}</span>
						</div>
						{#if preview.previousFile}
							<div class="mt-1 flex justify-between gap-2">
								<span>前回ファイル</span>
								<span class="truncate text-foreground" title={preview.previousFile}>
									{preview.previousFile}
								</span>
							</div>
						{/if}
					{/if}
				</div>

				<label class="block">
					<span class="mb-1 block text-xs font-medium text-muted-foreground">タイトル</span>
					<input
						type="text"
						bind:value={title}
						oninput={() => (errorMessage = null)}
						placeholder="例: 探索アルゴリズム"
						class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
					/>
				</label>

				<label class="block">
					<span class="mb-1 block text-xs font-medium text-muted-foreground">日付</span>
					<input
						type="date"
						bind:value={date}
						class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
					/>
				</label>

				<label class="block">
					<span class="mb-1 block text-xs font-medium text-muted-foreground">教室 (location)</span>
					<input
						type="text"
						bind:value={location}
						placeholder="例: B201"
						class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
					/>
					{#if preview && preview.location && location === preview.location}
						<span class="mt-0.5 block text-[10px] text-muted-foreground">前回ノートから引き継ぎ</span>
					{/if}
				</label>

				<label class="block">
					<span class="mb-1 block text-xs font-medium text-muted-foreground">スライドURL</span>
					<input
						type="url"
						bind:value={slideUrl}
						placeholder="https://…"
						class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
					/>
					<span class="mt-0.5 block text-[10px] text-muted-foreground">毎回入力 (前回ノートからは引き継ぎません)</span>
				</label>

				<label class="block">
					<span class="mb-1 block text-xs font-medium text-muted-foreground">タグ (カンマ区切り)</span>
					<input
						type="text"
						bind:value={tagsInput}
						placeholder="例: AI, グラフ"
						class="w-full rounded border bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
					/>
				</label>

				{#if errorMessage}
					<div class="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
						<AlertCircle class="mt-0.5 size-4 shrink-0" />
						<span>{errorMessage}</span>
					</div>
				{/if}
			</div>

			<div class="mt-4 flex shrink-0 items-center justify-end gap-2">
				<button
					type="button"
					onclick={onClose}
					class="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
				>
					キャンセル
				</button>
				<button
					type="submit"
					disabled={creating || loadingPreview}
					class={cn(
						'inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground',
						(creating || loadingPreview) && 'opacity-50'
					)}
				>
					{#if creating}
						<Loader2 class="size-3.5 animate-spin" />
					{:else}
						<Save class="size-3.5" />
					{/if}
					作成
				</button>
			</div>
		</form>
	</div>
{/if}
