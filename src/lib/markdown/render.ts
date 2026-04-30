import { Marked } from 'marked';
import type { RendererObject, Token, TokenizerAndRendererExtension, Tokens } from 'marked';
import katex from 'katex';
import { createHighlighter } from 'shiki/bundle/web';
import type { BundledLanguage, BundledTheme } from 'shiki/bundle/web';

interface RenderMarkdownOptions {
	filePath: string;
}

type ShikiHighlighter = Awaited<ReturnType<typeof createHighlighter>>;

type HighlightedCodeToken = Tokens.Code & {
	highlightedHtml?: string;
};

type MathToken = Tokens.Generic & {
	text: string;
	displayMode: boolean;
};

const SHIKI_THEMES: BundledTheme[] = ['github-light', 'github-dark'];
const SHIKI_LANGS: BundledLanguage[] = [
	'markdown',
	'typescript',
	'javascript',
	'svelte',
	'json',
	'bash',
	'html',
	'css',
	'python',
	'sql',
	'yaml'
] satisfies BundledLanguage[];

const LANGUAGE_ALIASES: Record<string, string> = {
	js: 'javascript',
	ts: 'typescript',
	sh: 'bash',
	shell: 'bash',
	zsh: 'bash',
	py: 'python',
	yml: 'yaml'
};

let highlighterPromise: Promise<ShikiHighlighter> | null = null;

const mathBlockExtension: TokenizerAndRendererExtension = {
	name: 'mathBlock',
	level: 'block',
	start(src) {
		const index = src.indexOf('$$');
		return index === -1 ? undefined : index;
	},
	tokenizer(src) {
		const match = src.match(/^\$\$\s*\n?([\s\S]+?)\n?\$\$(?:\n|$)/);
		if (!match) return undefined;
		return {
			type: 'mathBlock',
			raw: match[0],
			text: match[1].trim(),
			displayMode: true
		};
	},
	renderer(token) {
		return renderKatex(token as MathToken);
	}
};

const mathInlineExtension: TokenizerAndRendererExtension = {
	name: 'mathInline',
	level: 'inline',
	start(src) {
		const index = src.indexOf('$');
		return index === -1 ? undefined : index;
	},
	tokenizer(src) {
		const match = src.match(/^\$((?:\\.|[^\n$])+?)\$(?!\$)/);
		if (!match) return undefined;

		const text = match[1];
		if (!text.trim() || /^\s|\s$/.test(text)) return undefined;

		return {
			type: 'mathInline',
			raw: match[0],
			text,
			displayMode: false
		};
	},
	renderer(token) {
		return renderKatex(token as MathToken);
	}
};

export async function renderMarkdown(
	markdown: string,
	options: RenderMarkdownOptions
): Promise<string> {
	const parser = new Marked({
		async: true,
		gfm: true,
		breaks: false,
		extensions: [mathBlockExtension, mathInlineExtension],
		renderer: createRenderer(options.filePath),
		walkTokens: async (token: Token) => {
			if (token.type !== 'code') return;
			const codeToken = token as HighlightedCodeToken;
			codeToken.highlightedHtml = await highlightCode(codeToken.text, codeToken.lang);
		}
	});

	const html = await parser.parse(stripYamlFrontmatter(markdown), { async: true });
	return html;
}

function createRenderer(filePath: string): RendererObject<string, string> {
	return {
		html({ text }) {
			return escapeHtml(text);
		},
		code(token) {
			const highlighted = (token as HighlightedCodeToken).highlightedHtml;
			if (highlighted) return highlighted;
			return renderPlainCode(token.text, normalizeLanguage(token.lang));
		},
		link({ href, title, tokens }) {
			const safeHref = resolveLinkHref(href, filePath);
			const body = this.parser.parseInline(tokens);
			if (!safeHref) return body;
			const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
			return `<a href="${escapeAttribute(safeHref)}"${titleAttribute}>${body}</a>`;
		},
		image({ href, title, text }) {
			const src = resolveImageHref(href, filePath);
			if (!src) return `<span class="text-red-600">${escapeHtml(text || href)}</span>`;
			const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
			return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(text)}"${titleAttribute} loading="lazy" />`;
		}
	};
}

async function highlightCode(code: string, lang: string | undefined): Promise<string> {
	const language = normalizeLanguage(lang);

	try {
		const highlighter = await getHighlighter();
		await ensureLanguageLoaded(highlighter, language);
		return highlighter.codeToHtml(code, {
			lang: language as BundledLanguage,
			themes: {
				light: 'github-light',
				dark: 'github-dark'
			},
			defaultColor: false
		});
	} catch {
		return renderPlainCode(code, language);
	}
}

function getHighlighter(): Promise<ShikiHighlighter> {
	highlighterPromise ??= createHighlighter({
		themes: SHIKI_THEMES,
		langs: SHIKI_LANGS
	});
	return highlighterPromise;
}

async function ensureLanguageLoaded(highlighter: ShikiHighlighter, lang: string) {
	if (lang === 'text') return;
	if (highlighter.getLoadedLanguages().includes(lang)) return;
	await highlighter.loadLanguage(lang as BundledLanguage);
}

function renderKatex(token: MathToken): string {
	try {
		return katex.renderToString(token.text, {
			displayMode: token.displayMode,
			throwOnError: false,
			strict: 'warn',
			output: 'html'
		});
	} catch {
		return token.displayMode
			? `<pre><code>${escapeHtml(token.text)}</code></pre>`
			: `<code>${escapeHtml(token.text)}</code>`;
	}
}

function renderPlainCode(code: string, lang: string): string {
	const languageClass = lang ? ` class="language-${escapeAttribute(lang)}"` : '';
	return `<pre><code${languageClass}>${escapeHtml(code)}</code></pre>`;
}

function normalizeLanguage(lang: string | undefined): string {
	const raw = lang?.trim().split(/\s+/)[0]?.toLowerCase() || 'text';
	return LANGUAGE_ALIASES[raw] ?? raw;
}

function stripYamlFrontmatter(markdown: string): string {
	return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function resolveLinkHref(href: string, filePath: string): string | null {
	const trimmed = href.trim();
	if (!trimmed) return null;
	if (isExternalUrl(trimmed) || trimmed.startsWith('#')) return trimmed;
	if (hasUnsafeProtocol(trimmed)) return null;

	const reference = splitReference(trimmed);
	if (!reference.path.endsWith('.md')) return trimmed;

	const noteDir = dirname(filePath);
	const target = normalizeRelativePath(joinRelative(noteDir, reference.path));
	if (!target) return null;
	return `/note/${encodePathSegments(target)}${reference.query}${reference.hash}`;
}

function resolveImageHref(href: string, filePath: string): string | null {
	const trimmed = href.trim();
	if (!trimmed) return null;
	if (isExternalImageUrl(trimmed)) return trimmed;
	if (hasUnsafeProtocol(trimmed)) return null;

	const reference = splitReference(trimmed);
	const pathPart = reference.path.startsWith('/') ? reference.path.replace(/^\/+/, '') : reference.path;
	const noteDir = dirname(filePath);
	const target = normalizeRelativePath(
		reference.path.startsWith('/') ? pathPart : joinRelative(noteDir, pathPart)
	);
	if (!target) return null;

	return `/api/images/${encodePathSegments(target)}${reference.query}${reference.hash}`;
}

function splitReference(value: string): { path: string; query: string; hash: string } {
	const match = value.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
	return {
		path: match?.[1] ?? value,
		query: match?.[2] ?? '',
		hash: match?.[3] ?? ''
	};
}

function dirname(filePath: string): string {
	const normalized = filePath.replace(/\\/g, '/');
	const index = normalized.lastIndexOf('/');
	return index === -1 ? '' : normalized.slice(0, index);
}

function joinRelative(base: string, target: string): string {
	return [base, target].filter(Boolean).join('/');
}

function normalizeRelativePath(value: string): string | null {
	const parts: string[] = [];
	for (const part of value.replace(/\\/g, '/').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			if (parts.length === 0) return null;
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return parts.join('/');
}

function encodePathSegments(value: string): string {
	return value.split('/').map(encodeURIComponent).join('/');
}

function isExternalUrl(value: string): boolean {
	return /^(https?:|mailto:)/i.test(value);
}

function isExternalImageUrl(value: string): boolean {
	return /^(https?:|data:image\/|blob:)/i.test(value);
}

function hasUnsafeProtocol(value: string): boolean {
	return /^[a-z][a-z\d+.-]*:/i.test(value) && !isExternalUrl(value) && !isExternalImageUrl(value);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/`/g, '&#96;');
}
