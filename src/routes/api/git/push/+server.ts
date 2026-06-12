import { json, error } from '@sveltejs/kit';
import path from 'node:path';
import fs from 'node:fs/promises';
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';
import { getNotesDir } from '$lib/server/notes-dir';
import {
	clearPendingPushFiles,
	getPendingPushFiles,
	normalizePendingPath
} from '$lib/server/pending-push';
import type { RequestHandler } from './$types';

const FILENAME_PATTERN = /^(\d{2})_(.+)\.md$/;

interface ChangedNote {
	subject: string;
	sequence: string;
	title: string;
}

function buildCommitMessage(files: string[]): string {
	const candidates = new Set<string>();
	for (const file of files) {
		candidates.add(file);
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

function changedPathSet(status: StatusResult): Set<string> {
	const paths = new Set<string>();
	for (const file of status.files) {
		paths.add(normalizePendingPath(file.path));
		const renamedFrom = (file as { from?: string }).from;
		if (renamedFrom) paths.add(normalizePendingPath(renamedFrom));
	}
	return paths;
}

function aheadCount(status: StatusResult): number {
	const ahead = (status as { ahead?: unknown }).ahead;
	return typeof ahead === 'number' && Number.isFinite(ahead) ? ahead : 0;
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
		const pendingFiles = await getPendingPushFiles(root);
		const changedPaths = changedPathSet(status);
		const targetFiles = pendingFiles.filter((file) => changedPaths.has(file));
		const otherChangedFiles = status.files.filter(
			(file) => !pendingFiles.includes(normalizePendingPath(file.path))
		).length;
		const ahead = aheadCount(status);

		if (status.files.length === 0 && ahead === 0) {
			if (pendingFiles.length > 0) {
				await clearPendingPushFiles(pendingFiles, root);
			}
			return json({
				ok: true,
				pushed: false,
				message: 'No changes to commit',
				commitMessage: null,
				commit: null,
				branch: status.current ?? null,
				pendingFiles: 0,
				otherChangedFiles: 0,
				ahead: 0
			});
		}

		const branch = status.current ?? (await git.branch()).current;

		if (targetFiles.length === 0) {
			if (ahead > 0 && pendingFiles.length > 0) {
				const pushResult = branch ? await git.push('origin', branch) : await git.push();
				await clearPendingPushFiles(pendingFiles, root);
				return json({
					ok: true,
					pushed: true,
					message: 'Pushed existing local commits to remote',
					commitMessage: null,
					commit: null,
					branch,
					pushSummary: pushResult.update ?? null,
					pendingFiles: 0,
					otherChangedFiles,
					ahead
				});
			}

			return json({
				ok: true,
				pushed: false,
				message:
					otherChangedFiles > 0
						? `Push 対象の変更はありません。対象外の変更 ${otherChangedFiles} 件は残しました`
						: ahead > 0
							? `未 push commit ${ahead} 件は対象を確認できないため push しません`
						: 'No changes to commit',
				commitMessage: null,
				commit: null,
				branch,
				pendingFiles: 0,
				otherChangedFiles,
				ahead
			});
		}

		const commitMessage = buildCommitMessage(targetFiles);

		await git.raw(['add', '--', ...targetFiles]);
		await git.raw(['commit', '-m', commitMessage, '--', ...targetFiles]);
		const commitHash = (await git.raw(['rev-parse', 'HEAD'])).trim();

		const pushResult = branch ? await git.push('origin', branch) : await git.push();
		const remainingPendingFiles = await clearPendingPushFiles(targetFiles, root);

		return json({
			ok: true,
			pushed: true,
			message: 'Pushed to remote',
			commitMessage,
			commit: {
				hash: commitHash,
				branch,
				summary: {
					changes: targetFiles.length
				}
			},
			branch,
			pushSummary: pushResult.update ?? null,
			pendingFiles: remainingPendingFiles.length,
			otherChangedFiles,
			ahead
		});
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		const message = e instanceof Error ? e.message : 'git push failed';
		throw error(500, message);
	}
};
