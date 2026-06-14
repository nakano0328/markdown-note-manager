import { json, error } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getNotesDir, resolveSafePath } from '$lib/server/notes-dir';
import { trackPendingPushFiles, toNotesRelativePath } from '$lib/server/pending-push';
import type { TaskItem, TaskPriority } from '$lib/types';
import type { RequestHandler } from './$types';

const IGNORED_DIRS = new Set(['.git', '.obsidian', 'node_modules', 'images']);
const TASK_LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.+?)(\s*)$/;
const DUE_DATE_TOKEN = /\s*(?:📅|due:)\s*(\d{4}-\d{2}-\d{2})/u;
const PRIORITY_TOKEN = /\s*([⏫🔼🔽])/u;

const PRIORITY_MAP: Record<string, TaskPriority> = {
	'⏫': 'high',
	'🔼': 'medium',
	'🔽': 'low'
};

interface ParsedMeta {
	displayContent: string;
	dueDate: string | null;
	priority: TaskPriority | null;
}

function parseTaskMeta(raw: string): ParsedMeta {
	let content = raw;
	let dueDate: string | null = null;
	let priority: TaskPriority | null = null;

	const dueMatch = content.match(DUE_DATE_TOKEN);
	if (dueMatch) {
		dueDate = dueMatch[1];
		content = content.replace(DUE_DATE_TOKEN, '');
	}

	const prioMatch = content.match(PRIORITY_TOKEN);
	if (prioMatch) {
		priority = PRIORITY_MAP[prioMatch[1]] ?? null;
		content = content.replace(PRIORITY_TOKEN, '');
	}

	return {
		displayContent: content.replace(/\s+/g, ' ').trim(),
		dueDate,
		priority
	};
}

async function walkMarkdown(absDir: string, root: string, out: string[]): Promise<void> {
	const entries = await fs.readdir(absDir, { withFileTypes: true });
	const subDirs: string[] = [];

	for (const entry of entries) {
		if (IGNORED_DIRS.has(entry.name)) continue;
		if (entry.name.startsWith('.')) continue;

		const abs = path.join(absDir, entry.name);
		if (entry.isDirectory()) {
			subDirs.push(abs);
		} else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
			out.push(path.relative(root, abs));
		}
	}

	await Promise.all(subDirs.map((dir) => walkMarkdown(dir, root, out)));
}

function deriveSubject(relPath: string): string {
	const parts = relPath.split(path.sep);
	if (parts.length >= 2) return parts[parts.length - 2];
	return parts[0]?.replace(/\.md$/i, '') ?? '';
}

function makeId(relPath: string, lineNumber: number, content: string): string {
	return createHash('sha1').update(`${relPath}:${lineNumber}:${content}`).digest('hex').slice(0, 16);
}

function toTaskItem(relPath: string, lineNumber: number, line: string): TaskItem | null {
	const match = line.match(TASK_LINE);
	if (!match) return null;

	const checked = match[2].toLowerCase() === 'x';
	const rawContent = match[4];
	const meta = parseTaskMeta(rawContent);
	return {
		id: makeId(relPath, lineNumber, rawContent),
		filePath: relPath.split(path.sep).join('/'),
		lineNumber,
		subject: deriveSubject(relPath),
		content: meta.displayContent || rawContent,
		isCompleted: checked,
		dueDate: meta.dueDate,
		priority: meta.priority
	};
}

async function extractTasks(absPath: string, relPath: string): Promise<TaskItem[]> {
	const text = await fs.readFile(absPath, 'utf-8');
	const items: TaskItem[] = [];
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const task = toTaskItem(relPath, i + 1, lines[i]);
		if (task) items.push(task);
	}
	return items;
}

export const GET: RequestHandler = async () => {
	let root: string;
	try {
		root = getNotesDir();
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'NOTES_DIR is not configured');
	}

	const files: string[] = [];
	try {
		await walkMarkdown(root, root, files);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			throw error(500, `NOTES_DIR does not exist: ${root}`);
		}
		throw e;
	}

	const perFileTasks = await Promise.all(
		files.map(async (rel) => {
			try {
				const abs = path.join(root, rel);
				return await extractTasks(abs, rel);
			} catch {
				// 単一ファイルの読込失敗は無視して続行
				return [];
			}
		})
	);
	const tasks = perFileTasks.flat();

	return json({ tasks });
};

export const PATCH: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		filePath?: unknown;
		lineNumber?: unknown;
		isCompleted?: unknown;
	};

	if (
		typeof body.filePath !== 'string' ||
		typeof body.lineNumber !== 'number' ||
		!Number.isInteger(body.lineNumber) ||
		body.lineNumber < 1 ||
		typeof body.isCompleted !== 'boolean'
	) {
		throw error(400, 'filePath, lineNumber and isCompleted are required');
	}

	const relPath = body.filePath.split('/').join(path.sep);
	let absPath: string;
	try {
		absPath = resolveSafePath(relPath);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid path');
	}

	if (!absPath.endsWith('.md')) {
		throw error(400, 'Only .md files are supported');
	}

	const text = await fs.readFile(absPath, 'utf-8');
	const newline = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(/\r?\n/);
	const index = body.lineNumber - 1;
	const line = lines[index];
	if (typeof line !== 'string') {
		throw error(404, 'Task line was not found');
	}

	const match = line.match(TASK_LINE);
	if (!match) {
		throw error(409, 'Task line is no longer a checkbox task');
	}

	const nextLine = `${match[1]}${body.isCompleted ? 'x' : ' '}${match[3]}${match[4]}${match[5]}`;
	lines[index] = nextLine;
	await fs.writeFile(absPath, lines.join(newline), 'utf-8');
	await trackPendingPushFiles([toNotesRelativePath(absPath)]);

	const task = toTaskItem(relPath, body.lineNumber, nextLine);
	return json({ task });
};
