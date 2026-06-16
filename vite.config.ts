import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { defineConfig, loadEnv, normalizePath } from 'vite';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const notesDir = process.env.NOTES_DIR ?? env.NOTES_DIR;
	const normalizedNotesDir = notesDir ? normalizePath(path.resolve(notesDir)) : null;

	return {
		plugins: [tailwindcss(), sveltekit()],
		resolve: {
			alias: [
				{
					find: /^lucide-svelte$/,
					replacement: path.resolve('src/lib/lucide-svelte.ts')
				}
			]
		},
		server: normalizedNotesDir
			? {
					watch: {
						ignored: (watchedPath) => {
							const normalized = normalizePath(path.resolve(watchedPath));
							return (
								normalized === normalizedNotesDir || normalized.startsWith(`${normalizedNotesDir}/`)
							);
						}
					}
				}
			: undefined,
		build: {
			rollupOptions: {
				output: {
					manualChunks(id) {
						if (!id.includes('node_modules')) return undefined;
						if (id.includes('/@codemirror/view/')) return 'codemirror-view';
						if (id.includes('/@codemirror/state/')) return 'codemirror-state';
						if (id.includes('/@codemirror/language/')) return 'codemirror-language';
						if (id.includes('/@codemirror/commands/')) return 'codemirror-commands';
						if (id.includes('/@codemirror/lang-markdown/')) return 'codemirror-markdown';
						if (id.includes('/codemirror/')) return 'codemirror-core';
						if (id.includes('/@lezer/')) return 'lezer';
						if (id.includes('/@shikijs/core/')) return 'shiki-core';
						if (id.includes('/@shikijs/engine-javascript/')) return 'shiki-engine';
						if (id.includes('/katex/') || id.includes('/marked/')) return 'markdown-renderer';
						return undefined;
					}
				}
			}
		}
	};
});
