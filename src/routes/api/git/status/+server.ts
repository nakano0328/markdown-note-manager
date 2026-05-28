import { json, error } from '@sveltejs/kit';
import path from 'node:path';
import fs from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import { getNotesDir } from '$lib/server/notes-dir';
import type { RequestHandler } from './$types';

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
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(500, `NOTES_DIR is not accessible: ${path.resolve(root)}`);
	}

	const git = simpleGit({ baseDir: root });
	const isRepo = await git.checkIsRepo();
	if (!isRepo) {
		throw error(400, `NOTES_DIR is not a git repository: ${root}`);
	}

	const status = await git.status();
	return json({
		ok: true,
		dirty: status.files.length > 0,
		changedFiles: status.files.length,
		branch: status.current ?? null
	});
};
