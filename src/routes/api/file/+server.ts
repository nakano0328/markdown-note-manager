import { json, error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveSafePath } from '$lib/server/notes-dir';
import type { RequestHandler } from './$types';

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
	return json({ path: body.path, ok: true });
};
