<script lang="ts">
	import {
		ChevronRight,
		ChevronDown,
		FileText,
		Folder,
		FolderOpen,
		Image as ImageIcon
	} from 'lucide-svelte';
	import type { TreeNode } from '$lib/types';
	import { page } from '$app/state';
	import { cn } from '$lib/utils';
	import { treeState } from '$lib/stores/tree-state.svelte';
	import Self from './FileTreeNode.svelte';

	interface Props {
		node: TreeNode;
		depth?: number;
	}

	let { node, depth = 0 }: Props = $props();

	const defaultOpen = $derived(depth < 1);
	const open = $derived(treeState.isOpen(node.path, defaultOpen));

	const encodedPath = $derived(node.path.split('/').map(encodeURIComponent).join('/'));
	const href = $derived(
		node.type === 'file'
			? `/note/${encodedPath}`
			: node.type === 'image'
				? `/api/images/${encodedPath}`
				: null
	);

	const isActive = $derived(node.type === 'file' && href !== null && page.url.pathname === href);
	const dirPad = $derived(depth * 12 + 4);
	const filePad = $derived(depth * 12 + 22);
	const childDepth = $derived(depth + 1);
</script>

{#if node.type === 'directory'}
	<button
		type="button"
		onclick={() => treeState.toggle(node.path, defaultOpen)}
		class={cn(
			'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm hover:bg-accent'
		)}
		style="padding-left: {dirPad}px"
	>
		{#if open}
			<ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
			<FolderOpen class="size-4 shrink-0 text-muted-foreground" />
		{:else}
			<ChevronRight class="size-3.5 shrink-0 text-muted-foreground" />
			<Folder class="size-4 shrink-0 text-muted-foreground" />
		{/if}
		<span class="truncate">{node.name}</span>
	</button>
	{#if open && node.children}
		{#each node.children as child (child.path)}
			<Self node={child} depth={childDepth} />
		{/each}
	{/if}
{:else}
	<a
		href={href ?? '#'}
		target={node.type === 'image' ? '_blank' : undefined}
		rel={node.type === 'image' ? 'noreferrer' : undefined}
		class={cn(
			'flex w-full items-center gap-1 rounded px-1 py-0.5 text-sm hover:bg-accent',
			isActive && 'bg-accent font-medium text-accent-foreground'
		)}
		style="padding-left: {filePad}px"
	>
		{#if node.type === 'image'}
			<ImageIcon class="size-4 shrink-0 text-muted-foreground" />
		{:else}
			<FileText class="size-4 shrink-0 text-muted-foreground" />
		{/if}
		<span class="truncate">{node.name}</span>
	</a>
{/if}
