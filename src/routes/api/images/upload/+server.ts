import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveSafePath } from '$lib/server/notes-dir';
import type { RequestHandler } from './$types';

const IMAGE_EXTENSIONS_BY_TYPE: Record<string, string> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/gif': '.gif',
	'image/webp': '.webp',
	'image/avif': '.avif'
};

const SUPPORTED_EXTENSIONS = new Set(Object.values(IMAGE_EXTENSIONS_BY_TYPE));

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const targetPath = formData.get('targetPath');
	const image = formData.get('image');

	if (typeof targetPath !== 'string' || !targetPath) {
		throw error(400, 'targetPath is required');
	}

	if (!image || typeof image === 'string') {
		throw error(400, 'image file is required');
	}

	let noteAbs: string;
	try {
		noteAbs = resolveSafePath(targetPath);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid targetPath');
	}

	if (!noteAbs.endsWith('.md')) {
		throw error(400, 'targetPath must be a .md file');
	}

	try {
		const stat = await fs.stat(noteAbs);
		if (!stat.isFile()) throw error(404, 'Target note not found');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			throw error(404, 'Target note not found');
		}
		throw e;
	}

	const ext = getImageExtension(image);
	if (!ext) {
		throw error(400, 'Unsupported image type');
	}

	const normalizedTargetPath = normalizeRelativePath(targetPath);
	const noteDir = path.posix.dirname(normalizedTargetPath);
	const imagesDir = noteDir === '.' ? 'images' : path.posix.join(noteDir, 'images');
	const fileName = createImageFileName(ext);
	const imageRelPath = path.posix.join(imagesDir, fileName);
	const imageAbs = resolveSafePath(imageRelPath);
	const data = Buffer.from(await image.arrayBuffer());

	await fs.mkdir(path.dirname(imageAbs), { recursive: true });
	await fs.writeFile(imageAbs, data);

	return json({
		fileName,
		path: imageRelPath,
		markdown: `![image](./images/${fileName})`
	});
};

function getImageExtension(file: File): string | null {
	const type = file.type.toLowerCase();
	const extFromType = IMAGE_EXTENSIONS_BY_TYPE[type];
	if (extFromType) return extFromType;

	const extFromName = path.extname(file.name).toLowerCase();
	return SUPPORTED_EXTENSIONS.has(extFromName) ? extFromName : null;
}

function createImageFileName(ext: string): string {
	const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
	return `image-${timestamp}-${randomUUID().slice(0, 8)}${ext}`;
}

function normalizeRelativePath(value: string): string {
	return value.replace(/\\/g, '/').replace(/^\/+/, '');
}
