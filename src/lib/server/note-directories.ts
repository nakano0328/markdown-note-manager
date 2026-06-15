import fs from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { resolveSafePath } from './notes-dir';
import type { Timetable, TimetableSlot } from '$lib/types';

function normalizeDirectoryPath(directory: string): string {
	const normalized = directory.trim().replace(/\\/g, '/');
	const parts = normalized.split('/').filter(Boolean);
	if (parts.length === 0) throw error(400, 'directory must not be empty');
	if (parts.some((part) => part === '.' || part === '..')) {
		throw error(400, 'directory contains invalid path segments');
	}
	if (parts.some((part) => part.includes('\0'))) {
		throw error(400, 'directory contains invalid characters');
	}
	return parts.join('/');
}

export function normalizeSlot(slot: TimetableSlot): TimetableSlot {
	return {
		subject: slot.subject.trim(),
		directory: normalizeDirectoryPath(slot.directory)
	};
}

export async function ensureNoteDirectory(directory: string): Promise<string> {
	const normalized = normalizeDirectoryPath(directory);
	const abs = resolveSafePath(normalized);
	try {
		const stat = await fs.stat(abs);
		if (!stat.isDirectory()) throw error(409, `directory path already exists as a file: ${normalized}`);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
		await fs.mkdir(abs, { recursive: true });
	}
	return normalized;
}

export async function ensureSlotDirectory(slot: TimetableSlot | null): Promise<TimetableSlot | null> {
	if (!slot) return null;
	const normalized = normalizeSlot(slot);
	await ensureNoteDirectory(normalized.directory);
	return normalized;
}

export async function ensureTimetableDirectories(timetable: Timetable): Promise<Timetable> {
	const next: Timetable = {};
	for (const [day, slots] of Object.entries(timetable)) {
		next[day] = {};
		for (const [period, slot] of Object.entries(slots)) {
			next[day][period] = normalizeSlot(slot);
			await ensureNoteDirectory(next[day][period].directory);
		}
	}
	return next;
}
