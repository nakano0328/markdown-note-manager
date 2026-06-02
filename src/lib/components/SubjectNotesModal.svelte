<script lang="ts">
	import { AlertCircle, BookOpen, FilePlus, Loader2, X } from 'lucide-svelte';
	import type { SubjectNoteSummary } from '$lib/types';

	interface Props {
		open: boolean;
		directory: string;
		subject: string;
		onClose: () => void;
		onCreateNew: () => void;
		onOpenNote: (note: SubjectNoteSummary) => void;
	}

	let { open, directory, subject, onClose, onCreateNew, onOpenNote }: Props = $props();

	let notes = $state<SubjectNoteSummary[]>([]);
	let loading = $state(false);
	let errorMessage = $state<string | null>(null);
	let lastDirectory = $state('');

	$effect(() => {
		if (!open) {
			lastDirectory = '';
			return;
		}
		if (!directory || lastDirectory === directory) return;
		lastDirectory = directory;
		void loadNotes();
	});

	async function loadNotes() {
		loading = true;
		errorMessage = null;
		notes = [];
		try {
			const params = new URLSearchParams({ directory });
			const res = await fetch(`/api/notes?${params.toString()}`);
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(body.message ?? `Failed to load notes (${res.status})`);
			}
			const data = (await res.json()) as { notes?: SubjectNoteSummary[] };
			notes = data.notes ?? [];
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : 'ノート一覧の取得に失敗しました';
		} finally {
			loading = false;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
		<div class="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col rounded-lg border bg-white p-4 shadow-lg">
			<div class="mb-3 flex items-center justify-between">
				<div class="min-w-0">
					<h3 class="flex items-center gap-1.5 text-sm font-semibold">
						<BookOpen class="size-3.5" />
						ノートを開く
					</h3>
					<div class="mt-0.5 truncate text-[11px] text-muted-foreground" title={directory}>
						{subject || directory}
					</div>
				</div>
				<button
					type="button"
					onclick={onClose}
					class="rounded p-1 text-muted-foreground hover:bg-accent"
					aria-label="閉じる"
				>
					<X class="size-4" />
				</button>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto pr-1">
				{#if loading}
					<div class="flex items-center gap-2 py-4 text-sm text-muted-foreground">
						<Loader2 class="size-4 animate-spin" /> ノート一覧を読み込み中…
					</div>
				{:else if errorMessage}
					<div class="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
						<AlertCircle class="mt-0.5 size-4 shrink-0" />
						<div>
							<div class="font-semibold">ノート一覧の取得に失敗</div>
							<div class="mt-1">{errorMessage}</div>
						</div>
					</div>
				{:else if notes.length === 0}
					<div class="rounded border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
						この授業のノートはまだありません。
					</div>
				{:else}
					<div class="space-y-1">
						{#each notes as note (note.path)}
							<button
								type="button"
								onclick={() => onOpenNote(note)}
								class="flex w-full items-center gap-3 rounded border px-3 py-2 text-left text-sm hover:bg-accent"
								title={note.filename}
							>
								<span class="w-12 shrink-0 text-xs font-semibold tabular-nums text-primary">
									第{note.sequence}回
								</span>
								<span class="min-w-0 flex-1">
									<span class="block truncate font-medium">{note.title}</span>
									<span class="mt-0.5 block truncate text-[11px] text-muted-foreground">
										{#if note.date}
											{note.date} · {note.filename}
										{:else}
											{note.filename}
										{/if}
									</span>
								</span>
							</button>
						{/each}
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
					type="button"
					onclick={onCreateNew}
					class="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
				>
					<FilePlus class="size-3.5" />
					新規ノート
				</button>
			</div>
		</div>
	</div>
{/if}
