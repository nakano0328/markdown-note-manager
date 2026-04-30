<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import { page } from '$app/state';
	import { PanelLeftClose, PanelLeft, UploadCloud } from 'lucide-svelte';

	let { children } = $props();

	let sidebarOpen = $state(true);

	const breadcrumbs = $derived.by(() => {
		const url = page.url.pathname;
		if (url === '/') return ['Home'];
		if (url.startsWith('/note/')) {
			const rest = decodeURIComponent(url.replace(/^\/note\//, ''));
			return ['Notes', ...rest.split('/')];
		}
		return [url];
	});
</script>

<div class="flex h-screen w-screen flex-col overflow-hidden">
	<header class="flex h-12 shrink-0 items-center justify-between border-b bg-sidebar-bg px-3">
		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={() => (sidebarOpen = !sidebarOpen)}
				class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
				aria-label="Toggle sidebar"
				title="Toggle sidebar"
			>
				{#if sidebarOpen}
					<PanelLeftClose class="size-4" />
				{:else}
					<PanelLeft class="size-4" />
				{/if}
			</button>
			<nav class="flex items-center gap-1 text-sm">
				{#each breadcrumbs as crumb, i (i)}
					{#if i > 0}
						<span class="text-muted-foreground">/</span>
					{/if}
					<span class={i === breadcrumbs.length - 1 ? 'font-medium' : 'text-muted-foreground'}>
						{crumb}
					</span>
				{/each}
			</nav>
		</div>
		<button
			type="button"
			class="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground opacity-50"
			disabled
			title="Phase 5 で実装予定"
		>
			<UploadCloud class="size-3.5" />
			Push
		</button>
	</header>

	<div class="flex min-h-0 flex-1">
		{#if sidebarOpen}
			<div class="w-[14rem] shrink-0 md:w-[16rem]">
				<Sidebar />
			</div>
		{/if}
		<main class="min-w-0 flex-1 overflow-auto">
			{@render children()}
		</main>
	</div>
</div>
