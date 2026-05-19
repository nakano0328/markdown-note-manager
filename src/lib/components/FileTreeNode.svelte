<script lang="ts">
	import {
		ChevronRight,
		ChevronDown,
		FileText,
		Folder,
		FolderOpen,
		Image as ImageIcon,
		Plus
	} from 'lucide-svelte';
	import type { TreeNode } from '$lib/types';
	import { page } from '$app/state';
	import { cn } from '$lib/utils';
	import { treeState } from '$lib/stores/tree-state.svelte';
	import { newNote } from '$lib/stores/new-note.svelte';
	import { isSubjectDirectory, directoryName } from '$lib/timetable-client';
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
	const canCreateNote = $derived(node.type === 'directory' && isSubjectDirectory(node.path));

	function requestNewNote(event: MouseEvent) {
		event.stopPropagation();
		newNote.request({
			directory: node.path,
			subject: directoryName(node.path)
		});
	}
</script>

{#if node.type === 'directory'}
	<div class="group flex w-full items-center gap-1">
		<button
			type="button"
			onclick={() => treeState.toggle(node.path, defaultOpen)}
			class={cn(
				'flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-sm hover:bg-accent'
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
		{#if canCreateNote}
			<button
				type="button"
				onclick={requestNewNote}
				class="mr-1 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100 focus:opacity-100"
				aria-label={`${node.name} に新規ノートを作成`}
				title="新規ノート作成"
			>
				<Plus class="size-3.5" />
			</button>
		{/if}
	</div>
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
