import { error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveSafePath } from '$lib/server/notes-dir';
import type { RequestHandler } from './$types';

const MIME_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.avif': 'image/avif'
};

export const GET: RequestHandler = async ({ params }) => {
	const relPath = params.path;
	if (!relPath) {
		throw error(400, 'Image path is required');
	}

	const ext = path.extname(relPath).toLowerCase();
	const contentType = MIME_TYPES[ext];
	if (!contentType) {
		throw error(400, 'Unsupported image type');
	}

	let abs: string;
	try {
		abs = resolveSafePath(relPath);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid path');
	}

	try {
		const stat = await fs.stat(abs);
		if (!stat.isFile()) {
			throw error(404, 'Image not found');
		}
		const data = await fs.readFile(abs);
		return new Response(new Uint8Array(data), {
			headers: {
				'content-type': contentType,
				'cache-control': 'public, max-age=300',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			throw error(404, 'Image not found');
		}
		throw e;
	}
};
