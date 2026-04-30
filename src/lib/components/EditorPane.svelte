<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorState, Prec, RangeSetBuilder } from '@codemirror/state';
	import {
		Decoration,
		EditorView,
		keymap,
		ViewPlugin,
		type DecorationSet,
		type ViewUpdate
	} from '@codemirror/view';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { markdown } from '@codemirror/lang-markdown';
	import { HighlightStyle, syntaxHighlighting, syntaxTree, indentUnit } from '@codemirror/language';
	import { tags } from '@lezer/highlight';
	import { AlertCircle, FileText, Loader2 } from 'lucide-svelte';

	interface Props {
		value?: string;
		filePath: string;
		loading?: boolean;
		errorMessage?: string | null;
	}

	let { value = $bindable(''), filePath, loading = false, errorMessage = null }: Props = $props();

	const lineCount = $derived(value.length === 0 ? 1 : value.split('\n').length);
	const characterCount = $derived(value.length);
	const INDENT = '  ';
	let caretIndentLevel = $state(0);
	let editorRoot = $state<HTMLDivElement | null>(null);
	let editorView = $state<EditorView | null>(null);

	const markdownHighlightStyle = HighlightStyle.define([
		{
			tag: [
				tags.heading,
				tags.heading1,
				tags.heading2,
				tags.heading3,
				tags.heading4,
				tags.heading5,
				tags.heading6
			],
			color: '#111827',
			fontWeight: '700'
		},
		{
			tag: [tags.punctuation, tags.processingInstruction, tags.contentSeparator],
			color: '#2563eb',
			fontWeight: '700'
		},
		{
			tag: tags.monospace,
			backgroundColor: '#f3f4f6',
			borderRadius: '4px',
			color: '#dc2626'
		},
		{
			tag: tags.quote,
			color: '#475569'
		}
	]);

	const editorTheme = EditorView.theme({
		'&': {
			height: '100%',
			background: '#ffffff',
			color: '#000000',
			fontSize: '13px'
		},
		'&.cm-focused': {
			outline: 'none'
		},
		'.cm-scroller': {
			fontFamily:
				'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
			lineHeight: '1.45',
			tabSize: '2'
		},
		'.cm-content': {
			minHeight: '100%',
			padding: '0.75rem 1rem'
		},
		'.cm-line': {
			padding: '0',
			position: 'relative'
		},
		'.cm-codeblock-bg': {
			backgroundColor: '#f3f4f6'
		},
		'.cm-list-indent-guide': {
			backgroundImage:
				'repeating-linear-gradient(to right, transparent 0 calc(2ch - 1px), #b7c0ca calc(2ch - 1px) 2ch)',
			backgroundRepeat: 'no-repeat',
			backgroundSize: 'calc(var(--list-indent-level) * 2ch) 100%'
		},
		'.cm-cursorLayer': {
			zIndex: '10'
		},
		'.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
			backgroundColor: 'rgb(147 197 253 / 0.45)'
		},
		'.cm-cursor': {
			borderLeftColor: '#000000'
		}
	});

	$effect(() => {
		if (!editorView) return;
		const current = editorView.state.doc.toString();
		if (current === value) return;
		editorView.dispatch({
			changes: { from: 0, to: current.length, insert: value }
		});
		updateCaretIndentLevelFromView(editorView);
	});

	onMount(() => {
		if (!editorRoot) return;
		editorView = new EditorView({
			parent: editorRoot,
			state: createEditorState(value)
		});
		updateCaretIndentLevelFromView(editorView);

		return () => {
			editorView?.destroy();
			editorView = null;
		};
	});

	function createEditorState(doc: string) {
		return EditorState.create({
			doc,
			extensions: [
				history(),
				indentUnit.of(INDENT),
				markdown(),
				syntaxHighlighting(markdownHighlightStyle),
				codeBlockBgPlugin,
				listIndentGuidePlugin,
				EditorView.lineWrapping,
				editorTheme,
				EditorView.updateListener.of((update) => {
					if (update.docChanged) {
						value = update.state.doc.toString();
					}
					if (update.docChanged || update.selectionSet) {
						updateCaretIndentLevelFromView(update.view);
					}
				}),
				Prec.high(
					keymap.of([
						{ key: 'Tab', run: addIndent },
						{ key: 'Shift-Tab', run: removeIndent },
						{ key: 'Enter', run: continueListInCodeMirror }
					])
				),
				keymap.of([...defaultKeymap, ...historyKeymap])
			]
		});
	}

	const codeBlockBgPlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildCodeBlockDecorations(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || update.startState.tree !== update.state.tree) {
					this.decorations = buildCodeBlockDecorations(update.view);
				}
			}
		},
		{
			decorations: (plugin) => plugin.decorations
		}
	);

	function buildCodeBlockDecorations(view: EditorView) {
		const builder = new RangeSetBuilder<Decoration>();
		const tree = syntaxTree(view.state);
		const codeBlockDeco = Decoration.line({ attributes: { class: 'cm-codeblock-bg' } });

		tree.iterate({
			enter(node) {
				if (node.name === 'FencedCode') {
					const from = node.from;
					const to = node.to;
					for (let pos = from; pos <= to; ) {
						const line = view.state.doc.lineAt(pos);
						builder.add(line.from, line.from, codeBlockDeco);
						if (line.to >= to) break;
						pos = line.to + 1;
					}
				}
			}
		});

		return builder.finish();
	}

	const listIndentGuidePlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildListIndentGuides(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = buildListIndentGuides(update.view);
				}
			}
		},
		{
			decorations: (plugin) => plugin.decorations
		}
	);

	function buildListIndentGuides(view: EditorView) {
		const builder = new RangeSetBuilder<Decoration>();

		for (const { from, to } of view.visibleRanges) {
			for (let pos = from; pos <= to; ) {
				const line = view.state.doc.lineAt(pos);
				const indent = line.text.match(/^[ \t]*/)?.[0] ?? '';
				const indentLevel = getIndentLevel(indent);

				if (indentLevel > 0) {
					builder.add(
						line.from,
						line.from,
						Decoration.line({
							attributes: {
								class: 'cm-list-indent-guide',
								style: `--list-indent-level: ${indentLevel}`
							}
						})
					);
				}

				if (line.to >= to) break;
				pos = line.to + 1;
			}
		}

		return builder.finish();
	}

	function continueListInCodeMirror(view: EditorView) {
		const selection = view.state.selection.main;
		if (!selection.empty) return false;

		const line = view.state.doc.lineAt(selection.head);
		const beforeCursor = line.text.slice(0, selection.head - line.from);
		const marker = getListContinuation(beforeCursor);
		if (!marker) return false;

		const trimmedContent = line.text.slice(marker.indent.length + marker.raw.length).trim();
		if (!trimmedContent) {
			const nextCursor = line.from + marker.indent.length;
			view.dispatch({
				changes: { from: line.from, to: selection.head, insert: marker.indent },
				selection: { anchor: nextCursor }
			});
			return true;
		}

		const insertion = `\n${marker.indent}${marker.next}`;
		const nextCursor = selection.head + insertion.length;
		view.dispatch({
			changes: { from: selection.head, insert: insertion },
			selection: { anchor: nextCursor }
		});
		return true;
	}

	function addIndent(view: EditorView) {
		const selection = view.state.selection.main;
		const startLine = view.state.doc.lineAt(selection.from);
		const endLine = view.state.doc.lineAt(selection.to);
		const changes = [];

		for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
			const line = view.state.doc.line(lineNumber);
			changes.push({ from: line.from, insert: INDENT });
		}

		view.dispatch({ changes });
		return true;
	}

	function removeIndent(view: EditorView) {
		const selection = view.state.selection.main;
		const startLine = view.state.doc.lineAt(selection.from);
		const endLine = view.state.doc.lineAt(selection.to);
		const changes = [];

		for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
			const line = view.state.doc.line(lineNumber);
			const removable = getRemovableIndent(line.text);
			if (removable === 0) continue;
			changes.push({ from: line.from, to: line.from + removable });
		}

		if (changes.length === 0) return true;

		view.dispatch({ changes });
		return true;
	}

	function getRemovableIndent(text: string) {
		if (text.startsWith(INDENT)) return INDENT.length;
		if (text.startsWith('\t')) return 1;
		if (text.startsWith(' ')) return 1;
		return 0;
	}

	function getListContinuation(textBeforeCursor: string) {
		const taskMatch = textBeforeCursor.match(/^([ \t]*)([-*+]\s+\[[ xX]\]\s+)(.*)$/);
		if (taskMatch) {
			return { indent: taskMatch[1], raw: taskMatch[2], next: taskMatch[2] };
		}

		const unorderedMatch = textBeforeCursor.match(/^([ \t]*)([-*+]\s+)(.*)$/);
		if (unorderedMatch) {
			return { indent: unorderedMatch[1], raw: unorderedMatch[2], next: unorderedMatch[2] };
		}

		const orderedMatch = textBeforeCursor.match(/^([ \t]*)(\d+)([.)]\s+)(.*)$/);
		if (orderedMatch) {
			const nextNumber = Number.parseInt(orderedMatch[2], 10) + 1;
			const raw = `${orderedMatch[2]}${orderedMatch[3]}`;
			return { indent: orderedMatch[1], raw, next: `${nextNumber}${orderedMatch[3]}` };
		}

		return null;
	}

	function updateCaretIndentLevelFromView(view: EditorView) {
		const line = view.state.doc.lineAt(view.state.selection.main.head);
		const indent = line.text.match(/^[ \t]*/)?.[0] ?? '';
		caretIndentLevel = getIndentLevel(indent);
	}

	function getIndentLevel(indent: string) {
		let level = 0;
		for (const char of indent) {
			level += char === '\t' ? 1 : 0.5;
		}
		return Math.floor(level);
	}

</script>

<section class="flex h-full min-h-0 flex-col bg-background">
	<div class="flex h-11 shrink-0 items-center justify-between border-b px-3">
		<div class="flex min-w-0 items-center gap-2">
			<FileText class="size-4 shrink-0 text-muted-foreground" />
			<div class="min-w-0 truncate text-sm font-medium" title={filePath}>編集</div>
		</div>
		<div class="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
			<span class="rounded border bg-white px-1.5 py-0.5 text-black">Tab {caretIndentLevel}</span>
			<span>{lineCount} 行 / {characterCount} 字</span>
		</div>
	</div>

	{#if errorMessage}
		<div class="m-3 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
			<AlertCircle class="mt-0.5 size-4 shrink-0" />
			<div>{errorMessage}</div>
		</div>
	{:else}
		<div class="relative min-h-0 flex-1">
			{#if loading}
				<div class="absolute inset-0 z-10 flex items-center justify-center bg-background/70 text-sm text-muted-foreground">
					<Loader2 class="mr-2 size-4 animate-spin" />
					読み込み中
				</div>
			{/if}
			<div bind:this={editorRoot} class="h-full w-full" aria-label="Markdown editor"></div>
		</div>
	{/if}
</section>
