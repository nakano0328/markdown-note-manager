import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
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
});
