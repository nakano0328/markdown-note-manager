import { json, error } from '@sveltejs/kit';
import path from 'node:path';
import fs from 'node:fs/promises';
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';
import { getNotesDir } from '$lib/server/notes-dir';
import type { RequestHandler } from './$types';

const FILENAME_PATTERN = /^(\d{2})_(.+)\.md$/;

interface ChangedNote {
	subject: string;
	sequence: string;
	title: string;
}

function buildCommitMessage(status: StatusResult): string {
	const candidates = new Set<string>();
	for (const file of status.files) {
		candidates.add(file.path);
	}

	const notes: ChangedNote[] = [];
	for (const rel of candidates) {
		if (!rel.toLowerCase().endsWith('.md')) continue;
		const parts = rel.split(/[/\\]/);
		const filename = parts.at(-1) ?? '';
		const match = filename.match(FILENAME_PATTERN);
		if (!match) continue;
		const subject = parts.length >= 2 ? parts[parts.length - 2] : '';
		notes.push({ subject, sequence: match[1], title: match[2] });
	}

	if (notes.length === 1) {
		const note = notes[0];
		return `${note.subject}_${note.sequence}_${note.title}`;
	}

	if (notes.length > 1) {
		const subjects = Array.from(new Set(notes.map((n) => n.subject).filter(Boolean)));
		const subjectLabel = subjects.length === 1 ? subjects[0] : 'multiple';
		return `${subjectLabel}_${notes.length}notes_update`;
	}

	const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
	return `notes update ${stamp}`;
}

async function ensureGitRepo(git: SimpleGit, root: string) {
	const isRepo = await git.checkIsRepo();
	if (!isRepo) {
		throw error(400, `NOTES_DIR is not a git repository: ${root}`);
	}
}

async function ensureRemote(git: SimpleGit) {
	const remotes = await git.getRemotes(true);
	if (remotes.length === 0) {
		throw error(400, 'No git remote configured in NOTES_DIR');
	}
}

export const POST: RequestHandler = async () => {
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
	try {
		await ensureGitRepo(git, root);
		await ensureRemote(git);

		const status = await git.status();
		if (status.files.length === 0) {
			return json({
				ok: true,
				pushed: false,
				message: 'No changes to commit',
				commitMessage: null,
				commit: null,
				branch: status.current ?? null
			});
		}

		const commitMessage = buildCommitMessage(status);

		await git.add(['-A']);
		const commit = await git.commit(commitMessage);

		const branch = status.current ?? (await git.branch()).current;
		const pushResult = branch ? await git.push('origin', branch) : await git.push();

		return json({
			ok: true,
			pushed: true,
			message: 'Pushed to remote',
			commitMessage,
			commit: {
				hash: commit.commit,
				branch: commit.branch,
				summary: commit.summary
			},
			branch,
			pushSummary: pushResult.update ?? null
		});
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		const message = e instanceof Error ? e.message : 'git push failed';
		throw error(500, message);
	}
};
