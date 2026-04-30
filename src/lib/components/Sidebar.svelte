<script lang="ts">
	import { onMount } from 'svelte';
	import FileTreeNode from './FileTreeNode.svelte';
	import type { TreeNode } from '$lib/types';
	import { Loader2, RefreshCw, AlertCircle } from 'lucide-svelte';

	let tree = $state<TreeNode[]>([]);
	let root = $state<string>('');
	let loading = $state(true);
	let errorMessage = $state<string | null>(null);

	async function load() {
		loading = true;
		errorMessage = null;
		try {
			const res = await fetch('/api/tree');
			if (!res.ok) {
				const body = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(body.message ?? `Failed to load tree (${res.status})`);
			}
			const data = (await res.json()) as { root: string; tree: TreeNode[] };
			root = data.root;
			tree = data.tree;
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			loading = false;
		}
	}

	onMount(load);
</script>

<aside class="flex h-full flex-col border-r bg-sidebar-bg">
	<div class="flex items-center justify-between border-b px-3 py-2">
		<div class="min-w-0">
			<div class="text-xs font-semibold uppercase tracking-wide text-foreground">Notes</div>
			{#if root}
				<div class="truncate text-[11px] text-foreground/60" title={root}>{root}</div>
			{/if}
		</div>
		<button
			type="button"
			onclick={load}
			class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
			aria-label="Reload tree"
			title="Reload"
		>
			<RefreshCw class="size-4" />
		</button>
	</div>

	<div class="flex-1 overflow-auto p-2">
		{#if loading}
			<div class="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
				<Loader2 class="size-4 animate-spin" /> Loading…
			</div>
		{:else if errorMessage}
			<div class="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
				<AlertCircle class="mt-0.5 size-4 shrink-0" />
				<div>
					<div class="font-semibold">Failed to load notes</div>
					<div class="mt-1">{errorMessage}</div>
					<div class="mt-1 text-muted-foreground">
						Set <code>NOTES_DIR</code> in <code>.env</code> to an absolute path.
					</div>
				</div>
			</div>
		{:else if tree.length === 0}
			<div class="px-1 py-2 text-sm text-muted-foreground">No markdown files found.</div>
		{:else}
			<div class="flex flex-col">
				{#each tree as node (node.path)}
					<FileTreeNode {node} />
				{/each}
			</div>
		{/if}
	</div>
</aside>
