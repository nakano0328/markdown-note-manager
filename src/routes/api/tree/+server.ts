import { json, error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getNotesDir } from '$lib/server/notes-dir';
import type { TreeNode } from '$lib/types';
import type { RequestHandler } from './$types';

const IGNORED = new Set(['.git', '.DS_Store', 'node_modules', '.obsidian']);
const VISIBLE_FILE_TYPES: Partial<Record<string, TreeNode['type']>> = {
	'.md': 'file',
	'.png': 'image'
};
const TREE_TYPE_ORDER: Record<TreeNode['type'], number> = {
	directory: 0,
	file: 1,
	image: 2
};

async function buildTree(absDir: string, root: string): Promise<TreeNode[]> {
	const entries = await fs.readdir(absDir, { withFileTypes: true });

	const results = await Promise.all(
		entries.map(async (entry): Promise<TreeNode | null> => {
			if (IGNORED.has(entry.name)) return null;
			if (entry.name.startsWith('.')) return null;

			const absPath = path.join(absDir, entry.name);
			const relPath = path.relative(root, absPath);

			if (entry.isDirectory()) {
				const children = await buildTree(absPath, root);
				return {
					name: entry.name,
					path: relPath,
					type: 'directory',
					children
				};
			}

			if (entry.isFile()) {
				const type = VISIBLE_FILE_TYPES[path.extname(entry.name).toLowerCase()];
				if (!type) return null;
				return { name: entry.name, path: relPath, type };
			}

			return null;
		})
	);

	const nodes = results.filter((node): node is TreeNode => node !== null);
	nodes.sort((a, b) => {
		if (a.type !== b.type) return TREE_TYPE_ORDER[a.type] - TREE_TYPE_ORDER[b.type];
		return a.name.localeCompare(b.name, 'ja');
	});

	return nodes;
}

export const GET: RequestHandler = async () => {
	let root: string;
	try {
		root = getNotesDir();
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'NOTES_DIR is not configured');
	}

	try {
		const stat = await fs.stat(root);
		if (!stat.isDirectory()) {
			throw error(500, `NOTES_DIR is not a directory: ${root}`);
		}
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			throw error(500, `NOTES_DIR does not exist: ${root}`);
		}
		throw e;
	}

	const tree = await buildTree(root, root);
	return json({ root, tree });
};
