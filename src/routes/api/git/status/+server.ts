import { json, error } from '@sveltejs/kit';
import path from 'node:path';
import fs from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import { getNotesDir } from '$lib/server/notes-dir';
import { getPendingPushFiles, normalizePendingPath } from '$lib/server/pending-push';
import type { RequestHandler } from './$types';

function statusAhead(status: unknown): number {
	const ahead = (status as { ahead?: unknown }).ahead;
	return typeof ahead === 'number' && Number.isFinite(ahead) ? ahead : 0;
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
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(500, `NOTES_DIR is not accessible: ${path.resolve(root)}`);
	}

	const git = simpleGit({ baseDir: root });
	const isRepo = await git.checkIsRepo();
	if (!isRepo) {
		throw error(400, `NOTES_DIR is not a git repository: ${root}`);
	}

	const status = await git.status();
	const pendingFiles = await getPendingPushFiles(root);
	const pendingSet = new Set(pendingFiles);
	const changedFiles = status.files.map((file) => normalizePendingPath(file.path));
	const pendingChangedFiles = changedFiles.filter((file) => pendingSet.has(file)).length;
	const otherChangedFiles = changedFiles.length - pendingChangedFiles;
	const ahead = statusAhead(status);
	return json({
		ok: true,
		dirty: pendingChangedFiles > 0 || (pendingFiles.length > 0 && ahead > 0),
		changedFiles: pendingChangedFiles,
		pendingFiles: pendingChangedFiles,
		otherChangedFiles,
		ahead,
		branch: status.current ?? null
	});
};
