<script lang="ts">
	import { page } from '$app/state';

	const filePath = $derived(decodeURIComponent(page.params.path ?? ''));
</script>

<div class="p-6">
	<h1 class="text-lg font-semibold">{filePath}</h1>
	<p class="mt-2 text-sm text-muted-foreground">
		Phase 2 でエディタとプレビューを実装します。Phase 1 ではサイドバーからファイルを選択できることのみ確認します。
	</p>
</div>
