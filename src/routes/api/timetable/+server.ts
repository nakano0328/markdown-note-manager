import { json, error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getNotesDir } from '$lib/server/notes-dir';
import type { Timetable, TimetableSettings, TimetableTerm } from '$lib/types';
import type { RequestHandler } from './$types';

const TIMETABLE_FILE = 'timetable.json';
const SETTINGS_FILE = 'timetable-settings.json';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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

function isObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
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

function isValidTerm(value: unknown): value is TimetableTerm {
	if (!isObject(value)) return false;
	return (
		typeof value.id === 'string' &&
		typeof value.label === 'string' &&
		typeof value.startsAt === 'string' &&
		typeof value.endsAt === 'string' &&
		DATE_ONLY.test(value.startsAt) &&
		DATE_ONLY.test(value.endsAt) &&
		value.startsAt <= value.endsAt
	);
}

function isValidSettings(value: unknown): value is TimetableSettings {
	if (!isObject(value)) return false;
	if (value.version !== 1 || typeof value.activeTermId !== 'string' || !Array.isArray(value.terms)) {
		return false;
	}
	return value.terms.every(isValidTerm);
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

function formatLocalDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function addDays(date: string, days: number): string {
	const [year, month, day] = date.split('-').map(Number);
	return formatLocalDate(new Date(year, month - 1, day + days));
}

function defaultTermForDate(date: string): TimetableTerm {
	const [yearText, monthText] = date.split('-');
	const year = Number(yearText);
	const month = Number(monthText);

	if (month >= 4 && month <= 9) {
		return {
			id: `${year}-spring`,
			label: `${year}年 春学期`,
			startsAt: `${year}-04-01`,
			endsAt: `${year}-09-30`
		};
	}

	const autumnYear = month >= 10 ? year : year - 1;
	return {
		id: `${autumnYear}-autumn`,
		label: `${autumnYear}年 秋学期`,
		startsAt: `${autumnYear}-10-01`,
		endsAt: `${autumnYear + 1}-03-31`
	};
}

function nextTermAfter(term: TimetableTerm): TimetableTerm {
	const [yearText, season] = term.id.split('-');
	const yearFromId = Number(yearText);
	const year = Number.isFinite(yearFromId) ? yearFromId : Number(term.endsAt.slice(0, 4));

	if (season === 'spring') {
		return {
			id: `${year}-autumn`,
			label: `${year}年 秋学期`,
			startsAt: addDays(term.endsAt, 1),
			endsAt: `${year + 1}-03-31`
		};
	}

	return {
		id: `${year + 1}-spring`,
		label: `${year + 1}年 春学期`,
		startsAt: addDays(term.endsAt, 1),
		endsAt: `${year + 1}-09-30`
	};
}

function orderedTerms(terms: TimetableTerm[]): TimetableTerm[] {
	return [...terms].sort((a, b) => {
		const byStart = a.startsAt.localeCompare(b.startsAt);
		if (byStart !== 0) return byStart;
		return a.endsAt.localeCompare(b.endsAt);
	});
}

function normalizeSettings(settings: TimetableSettings): TimetableSettings {
	return {
		...settings,
		terms: orderedTerms(settings.terms)
	};
}

function assertTermRangesValid(terms: TimetableTerm[]) {
	const ids = new Set<string>();
	const sorted = orderedTerms(terms);
	for (const term of sorted) {
		if (ids.has(term.id)) throw error(400, 'term id is duplicated');
		ids.add(term.id);
	}

	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i - 1].endsAt >= sorted[i].startsAt) {
			throw error(400, 'term ranges must not overlap');
		}
	}
}

function resolveActiveTermId(settings: TimetableSettings, today: string): boolean {
	const containing = settings.terms.find((term) => term.startsAt <= today && today <= term.endsAt);
	if (containing) {
		if (settings.activeTermId === containing.id) return false;
		settings.activeTermId = containing.id;
		return true;
	}

	let changed = false;
	for (let i = 0; i < 20; i++) {
		const activeTerm = settings.terms.find((term) => term.id === settings.activeTermId);
		if (activeTerm && activeTerm.endsAt >= today) return changed;

		const nextTerm = activeTerm ? nextTermAfter(activeTerm) : defaultTermForDate(today);
		const existingTerm = settings.terms.find((term) => term.id === nextTerm.id);
		if (!existingTerm) settings.terms = orderedTerms([...settings.terms, nextTerm]);
		settings.activeTermId = existingTerm?.id ?? nextTerm.id;
		changed = true;
	}

	throw error(500, 'Failed to resolve active timetable term');
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

function ensureTerm(settings: TimetableSettings, termId: string): TimetableTerm {
	const term = settings.terms.find((item) => item.id === termId);
	if (!term) throw error(400, `Unknown timetable term: ${termId}`);
	return term;
}

function termRange(settings: TimetableSettings, fromTermId: string, toTermId: string): TimetableTerm[] {
	const terms = orderedTerms(settings.terms);
	const fromIndex = terms.findIndex((term) => term.id === fromTermId);
	const toIndex = terms.findIndex((term) => term.id === toTermId);
	if (fromIndex < 0 || toIndex < 0) throw error(400, 'Unknown timetable term range');
	if (toIndex < fromIndex) throw error(400, 'applyUntilTermId must be after termId');
	return terms.slice(fromIndex, toIndex + 1);
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

function generateTermId(terms: TimetableTerm[], startsAt: string): string {
	const base = `term-${startsAt}`;
	let candidate = base;
	let index = 2;
	const ids = new Set(terms.map((term) => term.id));
	while (ids.has(candidate)) {
		candidate = `${base}-${index}`;
		index += 1;
	}
	return candidate;
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
		const viewedTermId = url.searchParams.get('termId') ?? settings.activeTermId;
		ensureTerm(settings, viewedTermId);
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
		if (isValidSlotUpdate(body.slotUpdate)) {
			const range = termRange(settings, termId, applyUntilTermId);
			for (const term of range) {
				store.terms[term.id] =
					term.id === termId
						? body.timetable
						: applySlotUpdate(store.terms[term.id] ?? {}, body.slotUpdate);
			}
		} else {
			store.terms[termId] = body.timetable;
		}

		await writeStore(timetablePath(), store);
		return json(responseFor(settings, store, termId));
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(500, e instanceof Error ? e.message : 'Failed to save timetable');
	}
};

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
	};

	const termBody = isObject(body.term) ? body.term : body.activeTerm;
	if (!isObject(termBody)) {
		throw error(400, 'term is required');
	}

	try {
		const settings = await readSettings();
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
		await writeSettings(settingsPath(), settings);

		const store = await readStore(settings.activeTermId);
		return json(responseFor(settings, store, next.id));
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(500, e instanceof Error ? e.message : 'Failed to update timetable settings');
	}
};
