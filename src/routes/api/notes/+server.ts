import { json, error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { getNotesDir, resolveSafePath } from '$lib/server/notes-dir';
import type { NoteFrontmatter } from '$lib/types';
import type { RequestHandler } from './$types';

const FILENAME_PATTERN = /^(\d{2})_(.+)\.md$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

interface NotePreviewBody {
	directory?: unknown;
	title?: unknown;
}

interface NoteCreateBody extends NotePreviewBody {
	date?: unknown;
	location?: unknown;
	slideUrl?: unknown;
	tags?: unknown;
}

interface NotePreviewResult {
	nextSequence: string;
	suggestedTitle: string;
	date: string;
	location: string;
	tags: string[];
	previousFile: string | null;
}

function localToday(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function pickString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function pickStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

interface ExistingNote {
	filename: string;
	sequence: number;
	title: string;
	frontmatter: Partial<NoteFrontmatter>;
}

async function readExistingNotes(absDir: string): Promise<ExistingNote[]> {
	let entries;
	try {
		entries = await fs.readdir(absDir, { withFileTypes: true });
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw e;
	}

	const notes: ExistingNote[] = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const match = entry.name.match(FILENAME_PATTERN);
		if (!match) continue;
		const sequence = Number.parseInt(match[1], 10);
		if (!Number.isFinite(sequence)) continue;
		const titleFromName = match[2];
		const abs = path.join(absDir, entry.name);
		let frontmatter: Partial<NoteFrontmatter> = {};
		try {
			const raw = await fs.readFile(abs, 'utf-8');
			const parsed = matter(raw);
			if (isStringRecord(parsed.data)) {
				frontmatter = parsed.data as Partial<NoteFrontmatter>;
			}
		} catch {
			// 継承候補の探索では、壊れた Frontmatter は無視する。
		}
		notes.push({
			filename: entry.name,
			sequence,
			title: typeof frontmatter.title === 'string' && frontmatter.title ? frontmatter.title : titleFromName,
			frontmatter
		});
	}
	notes.sort((a, b) => a.sequence - b.sequence);
	return notes;
}

function buildFilename(sequence: string, title: string): string {
	const safeTitle = title.replace(/[\\/:*?"<>|]/g, '').trim() || 'untitled';
	return `${sequence}_${safeTitle}.md`;
}

function buildFrontmatter(data: NoteFrontmatter): string {
	const lines: string[] = ['---'];
	lines.push(`title: ${data.title}`);
	lines.push(`date: ${data.date}`);
	if (data.location) lines.push(`location: ${data.location}`);
	if (data.slide_url) lines.push(`slide_url: ${data.slide_url}`);
	if (data.tags && data.tags.length > 0) {
		lines.push('tags:');
		for (const tag of data.tags) lines.push(`  - ${tag}`);
	}
	lines.push('---', '', `# ${data.title}`, '');
	return lines.join('\n');
}

async function buildPreview(directory: string, title: string | undefined): Promise<NotePreviewResult> {
	const absDir = resolveSafePath(directory);
	const notes = await readExistingNotes(absDir);
	const latest = notes.at(-1) ?? null;
	const nextSeq = latest ? latest.sequence + 1 : 1;
	const nextSequence = String(nextSeq).padStart(2, '0');
	const suggestedTitle =
		title && title.trim()
			? title.trim()
			: latest
				? `${latest.title}`
				: '';
	const inherited = latest?.frontmatter ?? {};
	return {
		nextSequence,
		suggestedTitle,
		date: localToday(),
		location: typeof inherited.location === 'string' ? inherited.location : '',
		tags: pickStringArray(inherited.tags),
		previousFile: latest?.filename ?? null
	};
}

export const GET: RequestHandler = async ({ url }) => {
	const directory = url.searchParams.get('directory');
	if (!directory) {
		throw error(400, 'directory query parameter is required');
	}
	const title = url.searchParams.get('title') ?? undefined;
	try {
		const preview = await buildPreview(directory, title ?? undefined);
		return json(preview);
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(500, e instanceof Error ? e.message : 'Failed to build note preview');
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as NoteCreateBody;
	const directory = pickString(body.directory);
	const title = pickString(body.title);
	if (!directory || !title) {
		throw error(400, 'directory and title are required');
	}

	let absDir: string;
	try {
		absDir = resolveSafePath(directory);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid directory');
	}

	const trimmedTitle = title.trim();
	if (!trimmedTitle) {
		throw error(400, 'title must not be empty');
	}

	const location = pickString(body.location);
	const slideUrl = pickString(body.slideUrl);
	const tags = pickStringArray(body.tags);
	const date = pickString(body.date) ?? localToday();
	if (!DATE_ONLY.test(date)) {
		throw error(400, 'date must be YYYY-MM-DD');
	}

	const notes = await readExistingNotes(absDir);
	const latest = notes.at(-1) ?? null;
	const nextSeq = latest ? latest.sequence + 1 : 1;
	const nextSequence = String(nextSeq).padStart(2, '0');
	const filename = buildFilename(nextSequence, trimmedTitle);
	const absPath = path.join(absDir, filename);
	const relPath = path.relative(getNotesDir(), absPath).split(path.sep).join('/');

	try {
		await fs.access(absPath);
		throw error(409, `File already exists: ${filename}`);
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
	}

	const frontmatter: NoteFrontmatter = {
		title: trimmedTitle,
		date,
		...(location ? { location } : {}),
		...(slideUrl ? { slide_url: slideUrl } : {}),
		...(tags.length > 0 ? { tags } : {})
	};

	const fileContent = buildFrontmatter(frontmatter);
	await fs.mkdir(absDir, { recursive: true });
	await fs.writeFile(absPath, fileContent, 'utf-8');

	return json({
		path: relPath,
		filename,
		sequence: nextSequence,
		frontmatter
	});
};
