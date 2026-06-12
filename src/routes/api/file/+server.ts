import { json, error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { getNotesDir, resolveSafePath } from '$lib/server/notes-dir';
import { trackPendingPushFiles, toNotesRelativePath } from '$lib/server/pending-push';
import type { RequestHandler } from './$types';

const NOTE_FILENAME_PATTERN = /^(\d{2})_(.+)\.md$/;

function toPosixPath(value: string): string {
	return value.split(path.sep).join('/');
}

function sanitizeTitleForFilename(title: string): string {
	return title.replace(/[\\/:*?"<>|]/g, '').trim();
}

function titleFromFilename(filename: string): string {
	const match = filename.match(NOTE_FILENAME_PATTERN);
	if (match) return match[2];
	return filename.replace(/\.md$/i, '');
}

function buildRenamedFilename(filename: string, title: string): string {
	const safeTitle = sanitizeTitleForFilename(title) || 'untitled';
	const match = filename.match(NOTE_FILENAME_PATTERN);
	if (match) return `${match[1]}_${safeTitle}.md`;
	return `${safeTitle}.md`;
}

function updateLeadingHeading(content: string, oldTitles: string[], nextTitle: string): string {
	const lines = content.split('\n');
	const titleSet = new Set(oldTitles.map((title) => title.trim()).filter(Boolean));
	for (let i = 0; i < lines.length; i += 1) {
		if (!lines[i].trim()) continue;
		const match = lines[i].match(/^#\s+(.+?)\s*$/);
		if (!match) return content;
		if (!titleSet.has(match[1].trim())) return content;
		lines[i] = `# ${nextTitle}`;
		return lines.join('\n');
	}
	return content;
}

async function exists(abs: string): Promise<boolean> {
	try {
		await fs.access(abs);
		return true;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw e;
	}
}

export const GET: RequestHandler = async ({ url }) => {
	const relPath = url.searchParams.get('path');
	if (!relPath) {
		throw error(400, 'path query parameter is required');
	}

	let abs: string;
	try {
		abs = resolveSafePath(relPath);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid path');
	}

	if (!abs.endsWith('.md')) {
		throw error(400, 'Only .md files are supported');
	}

	try {
		const content = await fs.readFile(abs, 'utf-8');
		return json({ path: relPath, content });
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			throw error(404, 'File not found');
		}
		throw e;
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { path?: string; content?: string };
	if (!body.path || typeof body.content !== 'string') {
		throw error(400, 'path and content are required');
	}

	let abs: string;
	try {
		abs = resolveSafePath(body.path);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid path');
	}

	if (!abs.endsWith('.md')) {
		throw error(400, 'Only .md files are supported');
	}

	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, body.content, 'utf-8');
	await trackPendingPushFiles([toNotesRelativePath(abs)]);
	return json({ path: body.path, ok: true });
};

export const PATCH: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { path?: string; title?: string };
	if (!body.path || typeof body.title !== 'string') {
		throw error(400, 'path and title are required');
	}

	let abs: string;
	try {
		abs = resolveSafePath(body.path);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid path');
	}

	if (!abs.endsWith('.md')) {
		throw error(400, 'Only .md files are supported');
	}

	const title = body.title.trim();
	if (!title) {
		throw error(400, 'title must not be empty');
	}

	const safeTitle = sanitizeTitleForFilename(title);
	if (!safeTitle) {
		throw error(400, 'title must contain valid filename characters');
	}

	const directory = path.dirname(abs);
	const oldFilename = path.basename(abs);
	const nextFilename = buildRenamedFilename(oldFilename, title);
	const nextAbs = path.join(directory, nextFilename);
	const raw = await fs.readFile(abs, 'utf-8').catch((e) => {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			throw error(404, 'File not found');
		}
		throw e;
	});

	const parsed = matter(raw);
	const oldFrontmatterTitle =
		typeof parsed.data.title === 'string' && parsed.data.title.trim() ? parsed.data.title : null;
	const oldFilenameTitle = titleFromFilename(oldFilename);
	const nextBody = updateLeadingHeading(
		parsed.content,
		[oldFrontmatterTitle ?? '', oldFilenameTitle],
		title
	);
	const nextContent = matter.stringify(nextBody, { ...parsed.data, title });

	if (nextAbs !== abs && (await exists(nextAbs))) {
		throw error(409, `File already exists: ${nextFilename}`);
	}

	if (nextAbs === abs) {
		await fs.writeFile(abs, nextContent, 'utf-8');
		await trackPendingPushFiles([toNotesRelativePath(abs)]);
	} else {
		await fs.writeFile(nextAbs, nextContent, 'utf-8');
		await fs.unlink(abs);
		await trackPendingPushFiles([toNotesRelativePath(abs), toNotesRelativePath(nextAbs)]);
	}

	return json({
		path: toPosixPath(path.relative(getNotesDir(), nextAbs)),
		filename: nextFilename,
		content: nextContent,
		ok: true
	});
};
