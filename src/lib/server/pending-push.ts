import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getNotesDir } from './notes-dir';

interface PendingPushState {
	version: 1;
	files: string[];
	updatedAt: string;
}

function normalizeRelativePath(value: string): string {
	const normalized = path.posix.normalize(value.replace(/\\/g, '/').replace(/^\/+/, ''));
	if (!normalized || normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
		throw new Error('Invalid pending push path');
	}
	return normalized;
}

function queueFilePath(root: string): string {
	const hash = createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 24);
	return path.join(process.cwd(), '.svelte-kit', 'notes-push-queue', `${hash}.json`);
}

async function readState(root = getNotesDir()): Promise<PendingPushState> {
	const filePath = queueFilePath(root);
	try {
		const raw = await fs.readFile(filePath, 'utf-8');
		const parsed = JSON.parse(raw) as Partial<PendingPushState>;
		const files = Array.isArray(parsed.files)
			? parsed.files.filter((item): item is string => typeof item === 'string')
			: [];
		return {
			version: 1,
			files: files.map(normalizeRelativePath),
			updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
		};
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			return { version: 1, files: [], updatedAt: new Date().toISOString() };
		}
		// 壊れたキューは、誤ったファイルを push 対象にしないため空として扱う。
		return { version: 1, files: [], updatedAt: new Date().toISOString() };
	}
}

async function writeState(state: PendingPushState, root = getNotesDir()): Promise<void> {
	const filePath = queueFilePath(root);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

export function toNotesRelativePath(absPath: string, root = getNotesDir()): string {
	return normalizeRelativePath(path.relative(root, absPath));
}

export function normalizePendingPath(relPath: string): string {
	return normalizeRelativePath(relPath);
}

export async function getPendingPushFiles(root = getNotesDir()): Promise<string[]> {
	const state = await readState(root);
	return state.files;
}

export async function trackPendingPushFiles(paths: string[], root = getNotesDir()): Promise<string[]> {
	const state = await readState(root);
	const files = new Set(state.files);
	for (const item of paths) {
		files.add(normalizeRelativePath(item));
	}
	const next = {
		version: 1 as const,
		files: Array.from(files).sort((a, b) => a.localeCompare(b)),
		updatedAt: new Date().toISOString()
	};
	await writeState(next, root);
	return next.files;
}

export async function clearPendingPushFiles(paths: string[], root = getNotesDir()): Promise<string[]> {
	const state = await readState(root);
	const pushed = new Set(paths.map(normalizeRelativePath));
	const next = {
		version: 1 as const,
		files: state.files.filter((file) => !pushed.has(file)),
		updatedAt: new Date().toISOString()
	};
	await writeState(next, root);
	return next.files;
}
