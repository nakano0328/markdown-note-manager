import path from 'node:path';
import { env } from '$env/dynamic/private';

export function getNotesDir(): string {
	const dir = env.NOTES_DIR;
	if (!dir) {
		throw new Error('NOTES_DIR is not set in .env');
	}
	if (!path.isAbsolute(dir)) {
		throw new Error('NOTES_DIR must be an absolute path');
	}
	return dir;
}

export function resolveSafePath(relPath: string): string {
	const root = getNotesDir();
	const normalized = path.normalize(relPath).replace(/^([/\\])+/, '');
	const abs = path.resolve(root, normalized);
	const rootResolved = path.resolve(root);
	if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
		throw new Error('Path traversal detected');
	}
	return abs;
}
