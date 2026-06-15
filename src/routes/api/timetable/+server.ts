import { json, error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getNotesDir } from '$lib/server/notes-dir';
import { formatLocalDate } from '$lib/calendar';
import { DATE_ONLY, isObject } from '$lib/server/validators';
import { ensureSlotDirectory, ensureTimetableDirectories } from '$lib/server/note-directories';
import {
	assertTermRangesValid,
	defaultTermForDate,
	ensureTerm,
	ensureTermForDate,
	generateTermId,
	isValidPeriodTime,
	isValidSettings,
	isValidTerm,
	normalizeSettings,
	orderedTerms,
	resolveActiveTermId,
	termRange
} from '$lib/server/timetable-terms';
import { MAX_PERIODS } from '$lib/period-times';
import type { PeriodTime, Timetable, TimetableSettings, TimetableTerm } from '$lib/types';
import type { RequestHandler } from './$types';

const TIMETABLE_FILE = 'timetable.json';
const SETTINGS_FILE = 'timetable-settings.json';

interface TimetableStore {
	version: 2;
	terms: Record<string, Timetable>;
}

interface TimetableResponse {
	timetable: Timetable;
	settings: TimetableSettings;
	activeTerm: TimetableTerm;
	viewedTerm: TimetableTerm;
}

interface SlotUpdate {
	day: string;
	period: string;
	slot: {
		subject: string;
		directory: string;
	} | null;
}

function timetablePath(): string {
	return path.join(getNotesDir(), TIMETABLE_FILE);
}

function settingsPath(): string {
	return path.join(getNotesDir(), SETTINGS_FILE);
}

function isValidTimetable(value: unknown): value is Timetable {
	if (!isObject(value)) return false;
	for (const day of Object.values(value)) {
		if (!isObject(day)) return false;
		for (const slot of Object.values(day)) {
			if (!isObject(slot)) return false;
			if (typeof slot.subject !== 'string' || typeof slot.directory !== 'string') return false;
		}
	}
	return true;
}

function isValidStore(value: unknown): value is TimetableStore {
	if (!isObject(value)) return false;
	if (value.version !== 2 || !isObject(value.terms)) return false;
	return Object.values(value.terms).every(isValidTimetable);
}

function isValidSlotUpdate(value: unknown): value is SlotUpdate {
	if (!isObject(value)) return false;
	if (typeof value.day !== 'string' || typeof value.period !== 'string') return false;
	if (value.slot === null) return true;
	if (!isObject(value.slot)) return false;
	return typeof value.slot.subject === 'string' && typeof value.slot.directory === 'string';
}

function localToday(): string {
	return formatLocalDate(new Date());
}

function cloneTimetable(value: Timetable): Timetable {
	const next: Timetable = {};
	for (const [day, slots] of Object.entries(value)) {
		next[day] = {};
		for (const [period, slot] of Object.entries(slots)) {
			next[day][period] = { ...slot };
		}
	}
	return next;
}

function applySlotUpdate(timetable: Timetable, update: SlotUpdate): Timetable {
	const next = cloneTimetable(timetable);
	if (!next[update.day]) next[update.day] = {};

	if (update.slot) {
		next[update.day][update.period] = { ...update.slot };
		return next;
	}

	delete next[update.day][update.period];
	if (Object.keys(next[update.day]).length === 0) delete next[update.day];
	return next;
}

async function writeSettings(abs: string, settings: TimetableSettings) {
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, JSON.stringify(normalizeSettings(settings), null, 2) + '\n', 'utf-8');
}

async function readSettings(): Promise<TimetableSettings> {
	const abs = settingsPath();
	const today = localToday();
	let settings: TimetableSettings;
	let shouldWrite = false;

	try {
		const raw = await fs.readFile(abs, 'utf-8');
		const parsed = JSON.parse(raw) as unknown;
		if (!isValidSettings(parsed)) {
			throw error(500, `${SETTINGS_FILE} has invalid shape`);
		}
		settings = normalizeSettings(parsed);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
			if (e instanceof SyntaxError) throw error(500, `Failed to parse ${SETTINGS_FILE}`);
			throw e;
		}

		const term = defaultTermForDate(today);
		settings = {
			version: 1,
			activeTermId: term.id,
			terms: [term]
		};
		shouldWrite = true;
	}

	shouldWrite = resolveActiveTermId(settings, today) || shouldWrite;
	assertTermRangesValid(settings.terms);

	if (shouldWrite) await writeSettings(abs, settings);
	return normalizeSettings(settings);
}

async function writeStore(abs: string, store: TimetableStore) {
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

async function readStore(activeTermId: string): Promise<TimetableStore> {
	const abs = timetablePath();
	try {
		const raw = await fs.readFile(abs, 'utf-8');
		const parsed = JSON.parse(raw) as unknown;
		if (isValidStore(parsed)) return parsed;

		if (isValidTimetable(parsed)) {
			return {
				version: 2,
				terms: {
					[activeTermId]: parsed
				}
			};
		}

		throw error(500, `${TIMETABLE_FILE} has invalid shape`);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			return { version: 2, terms: {} };
		}
		if (e instanceof SyntaxError) throw error(500, `Failed to parse ${TIMETABLE_FILE}`);
		throw e;
	}
}

function responseFor(
	settings: TimetableSettings,
	store: TimetableStore,
	viewedTermId = settings.activeTermId
): TimetableResponse {
	const activeTerm = ensureTerm(settings, settings.activeTermId);
	const viewedTerm = ensureTerm(settings, viewedTermId);
	return {
		timetable: store.terms[viewedTerm.id] ?? {},
		settings,
		activeTerm,
		viewedTerm
	};
}

export const GET: RequestHandler = async ({ url }) => {
	try {
		const settings = await readSettings();
		const termId = url.searchParams.get('termId');
		const date = url.searchParams.get('date');
		let viewedTermId = termId ?? settings.activeTermId;

		if (termId) {
			ensureTerm(settings, termId);
		} else if (date) {
			if (!DATE_ONLY.test(date)) throw error(400, 'date must be YYYY-MM-DD');
			const resolved = ensureTermForDate(settings, date);
			viewedTermId = resolved.termId;
			if (resolved.changed) await writeSettings(settingsPath(), settings);
		}

		const store = await readStore(settings.activeTermId);
		return json(responseFor(settings, store, viewedTermId));
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(500, e instanceof Error ? e.message : 'Failed to load timetable');
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		timetable?: unknown;
		termId?: unknown;
		applyUntilTermId?: unknown;
		slotUpdate?: unknown;
		slotUpdates?: unknown;
	};

	if (!isValidTimetable(body.timetable)) {
		throw error(400, 'timetable payload is invalid');
	}

	try {
		const settings = await readSettings();
		const termId = typeof body.termId === 'string' ? body.termId : settings.activeTermId;
		const applyUntilTermId =
			typeof body.applyUntilTermId === 'string' ? body.applyUntilTermId : termId;
		ensureTerm(settings, termId);
		ensureTerm(settings, applyUntilTermId);

		const store = await readStore(settings.activeTermId);
		let rawSlotUpdates: SlotUpdate[] = [];
		if (Array.isArray(body.slotUpdates)) {
			if (!body.slotUpdates.every(isValidSlotUpdate)) {
				throw error(400, 'slotUpdates payload is invalid');
			}
			rawSlotUpdates = body.slotUpdates;
		} else if (isValidSlotUpdate(body.slotUpdate)) {
			rawSlotUpdates = [body.slotUpdate];
		}

		const timetablePayload = await ensureTimetableDirectories(body.timetable);
		const slotUpdates = await Promise.all(
			rawSlotUpdates.map(async (update) => ({
				...update,
				slot: await ensureSlotDirectory(update.slot)
			}))
		);
		if (slotUpdates.length > 0) {
			const range = termRange(settings, termId, applyUntilTermId);
			for (const term of range) {
				if (term.id === termId) {
					store.terms[term.id] = timetablePayload;
					continue;
				}

				let next = store.terms[term.id] ?? {};
				for (const slotUpdate of slotUpdates) {
					next = applySlotUpdate(next, slotUpdate);
				}
				store.terms[term.id] = next;
			}
		} else {
			store.terms[termId] = timetablePayload;
		}

		await writeStore(timetablePath(), store);
		return json(responseFor(settings, store, termId));
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(500, e instanceof Error ? e.message : 'Failed to save timetable');
	}
};

function sanitizePeriodTimes(input: unknown): PeriodTime[] {
	if (!Array.isArray(input)) throw error(400, 'periodTimes must be an array');
	if (input.length === 0) throw error(400, 'periodTimes must include at least 1 period');
	if (input.length > MAX_PERIODS) {
		throw error(400, `periodTimes must include at most ${MAX_PERIODS} periods`);
	}
	const result: PeriodTime[] = [];
	for (const entry of input) {
		if (!isValidPeriodTime(entry)) throw error(400, 'periodTimes entry is invalid');
		const e = entry as { start: string; end: string };
		result.push({ start: e.start, end: e.end });
	}
	return result;
}

export const PATCH: RequestHandler = async ({ request }) => {
	type TermPayload = {
		id?: unknown;
		label?: unknown;
		startsAt?: unknown;
		endsAt?: unknown;
	};
	const body = (await request.json()) as {
		term?: TermPayload;
		activeTerm?: TermPayload;
		periodTimes?: unknown;
	};

	const hasTerm = isObject(body.term) || isObject(body.activeTerm);
	const hasPeriodTimes = body.periodTimes !== undefined;
	if (!hasTerm && !hasPeriodTimes) {
		throw error(400, 'term or periodTimes is required');
	}

	try {
		const settings = await readSettings();
		let viewedTermId = settings.activeTermId;

		if (hasTerm) {
			const termBody = (isObject(body.term) ? body.term : body.activeTerm) as TermPayload;
			const id = typeof termBody.id === 'string' && termBody.id ? termBody.id : null;
			const existingIndex = id ? settings.terms.findIndex((term) => term.id === id) : -1;
			const existing = existingIndex >= 0 ? settings.terms[existingIndex] : null;

			const startsAt =
				typeof termBody.startsAt === 'string' ? termBody.startsAt : existing?.startsAt;
			const endsAt = typeof termBody.endsAt === 'string' ? termBody.endsAt : existing?.endsAt;
			if (!startsAt || !endsAt) throw error(400, 'startsAt and endsAt are required');

			const next: TimetableTerm = {
				id: existing?.id ?? generateTermId(settings.terms, startsAt),
				label:
					typeof termBody.label === 'string' && termBody.label.trim()
						? termBody.label.trim()
						: (existing?.label ?? '新しい学期'),
				startsAt,
				endsAt
			};

			if (!isValidTerm(next)) throw error(400, 'term has invalid values');

			const nextTerms =
				existingIndex >= 0
					? settings.terms.map((term, index) => (index === existingIndex ? next : term))
					: [...settings.terms, next];
			assertTermRangesValid(nextTerms);

			settings.terms = orderedTerms(nextTerms);
			resolveActiveTermId(settings, localToday());
			viewedTermId = next.id;
		}

		if (hasPeriodTimes) {
			settings.periodTimes = sanitizePeriodTimes(body.periodTimes);
		}

		await writeSettings(settingsPath(), settings);

		const store = await readStore(settings.activeTermId);
		return json(responseFor(settings, store, viewedTermId));
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(500, e instanceof Error ? e.message : 'Failed to update timetable settings');
	}
};
