import { json, error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import path from 'node:path';
import holiday_jp from '@holiday-jp/holiday_jp';
import { getNotesDir } from '$lib/server/notes-dir';
import { ensureSlotDirectory } from '$lib/server/note-directories';
import type {
	CalendarEvent,
	DateMoveEvent,
	DaySwapEvent,
	PeriodOverrideEvent,
	PublicHoliday,
	SchoolHolidayEvent
} from '$lib/types';
import { generateEventId, parseDate, weekdayFromDate } from '$lib/calendar';
import { DATE_ONLY, isObject, isWeekday } from '$lib/server/validators';
import type { RequestHandler } from './$types';

const CALENDAR_FILE = 'calendar.json';

interface CalendarStore {
	version: 1;
	events: CalendarEvent[];
}

function calendarPath(): string {
	return path.join(getNotesDir(), CALENDAR_FILE);
}

function isValidEvent(value: unknown): value is CalendarEvent {
	if (!isObject(value)) return false;
	if (typeof value.id !== 'string' || !value.id) return false;
	if (typeof value.date !== 'string' || !DATE_ONLY.test(value.date)) return false;

	if (value.type === 'school_holiday') {
		return typeof value.title === 'string' && value.title.trim().length > 0;
	}
	if (value.type === 'day_swap') {
		return isWeekday((value as { followsDay?: unknown }).followsDay);
	}
	if (value.type === 'date_move') {
		const e = value as { fromDate?: unknown };
		if (typeof e.fromDate !== 'string' || !DATE_ONLY.test(e.fromDate)) return false;
		if (e.fromDate === value.date) return false;
		return weekdayFromDate(e.fromDate) !== null;
	}
	if (value.type === 'period_override') {
		const e = value as { period?: unknown; slot?: unknown };
		if (typeof e.period !== 'string' || !e.period) return false;
		if (e.slot === null) return true;
		return (
			isObject(e.slot) &&
			typeof (e.slot as { subject?: unknown }).subject === 'string' &&
			typeof (e.slot as { directory?: unknown }).directory === 'string'
		);
	}
	return false;
}

function isValidStore(value: unknown): value is CalendarStore {
	if (!isObject(value)) return false;
	if (value.version !== 1 || !Array.isArray(value.events)) return false;
	return value.events.every(isValidEvent);
}

async function readStore(): Promise<CalendarStore> {
	const abs = calendarPath();
	try {
		const raw = await fs.readFile(abs, 'utf-8');
		const parsed = JSON.parse(raw) as unknown;
		if (!isValidStore(parsed)) throw error(500, `${CALENDAR_FILE} has invalid shape`);
		return parsed;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			return { version: 1, events: [] };
		}
		if (e instanceof SyntaxError) throw error(500, `Failed to parse ${CALENDAR_FILE}`);
		throw e;
	}
}

async function writeStore(store: CalendarStore) {
	const abs = calendarPath();
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

function holidaysBetween(from: string, to: string): PublicHoliday[] {
	const start = parseDate(from);
	const end = parseDate(to);
	const raw = holiday_jp.between(start, end);
	return raw.map((entry) => {
		const dateObj = entry.date instanceof Date ? entry.date : parseDate(String(entry.date));
		const year = dateObj.getFullYear();
		const month = String(dateObj.getMonth() + 1).padStart(2, '0');
		const day = String(dateObj.getDate()).padStart(2, '0');
		return { date: `${year}-${month}-${day}`, name: entry.name };
	});
}

function uniqueEventId(store: CalendarStore): string {
	let id = generateEventId();
	const ids = new Set(store.events.map((event) => event.id));
	while (ids.has(id)) id = generateEventId();
	return id;
}

function normalizeIncoming(body: unknown, fallbackId: string): CalendarEvent | null {
	if (!isObject(body)) return null;
	const date = typeof body.date === 'string' && DATE_ONLY.test(body.date) ? body.date : null;
	if (!date) return null;
	const id = typeof body.id === 'string' && body.id ? body.id : fallbackId;
	const note = typeof body.note === 'string' ? body.note : undefined;
	const title = typeof body.title === 'string' ? body.title : undefined;

	if (body.type === 'school_holiday') {
		if (!title || !title.trim()) return null;
		const event: SchoolHolidayEvent = { id, date, type: 'school_holiday', title: title.trim() };
		if (note) event.note = note;
		return event;
	}
	if (body.type === 'day_swap') {
		if (!isWeekday(body.followsDay)) return null;
		const event: DaySwapEvent = { id, date, type: 'day_swap', followsDay: body.followsDay };
		if (title) event.title = title;
		if (note) event.note = note;
		return event;
	}
	if (body.type === 'date_move') {
		const fromDate = body.fromDate;
		if (typeof fromDate !== 'string' || !DATE_ONLY.test(fromDate)) return null;
		if (fromDate === date) return null;
		if (weekdayFromDate(fromDate) === null) return null;
		const event: DateMoveEvent = { id, date, type: 'date_move', fromDate };
		if (title) event.title = title;
		if (note) event.note = note;
		return event;
	}
	if (body.type === 'period_override') {
		if (typeof body.period !== 'string' || !body.period) return null;
		let slot: PeriodOverrideEvent['slot'] = null;
		if (isObject(body.slot)) {
			const subject = (body.slot as { subject?: unknown }).subject;
			const directory = (body.slot as { directory?: unknown }).directory;
			if (typeof subject !== 'string' || typeof directory !== 'string') return null;
			if (subject.trim() && directory.trim()) slot = { subject: subject.trim(), directory: directory.trim() };
		} else if (body.slot !== null && body.slot !== undefined) {
			return null;
		}
		const event: PeriodOverrideEvent = {
			id,
			date,
			type: 'period_override',
			period: body.period,
			slot
		};
		if (title) event.title = title;
		if (note) event.note = note;
		return event;
	}
	return null;
}

async function ensureEventDirectory(event: CalendarEvent): Promise<CalendarEvent> {
	if (event.type !== 'period_override') return event;
	return {
		...event,
		slot: await ensureSlotDirectory(event.slot)
	};
}

export const GET: RequestHandler = async ({ url }) => {
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	if (!from || !to || !DATE_ONLY.test(from) || !DATE_ONLY.test(to)) {
		throw error(400, 'from and to are required (YYYY-MM-DD)');
	}
	if (from > to) throw error(400, 'from must be on or before to');

	const store = await readStore();
	const events = store.events.filter((event) => event.date >= from && event.date <= to);
	const holidays = holidaysBetween(from, to);
	return json({ events, holidays });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as unknown;
	const store = await readStore();
	const candidate = normalizeIncoming(body, uniqueEventId(store));
	if (!candidate) throw error(400, 'Invalid calendar event payload');
	const event = await ensureEventDirectory(candidate);

	store.events = [...store.events, event];
	await writeStore(store);
	return json({ event });
};

export const PATCH: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { id?: unknown } & Record<string, unknown>;
	if (typeof body.id !== 'string' || !body.id) throw error(400, 'id is required');

	const store = await readStore();
	const index = store.events.findIndex((event) => event.id === body.id);
	if (index < 0) throw error(404, 'event not found');

	const updated = normalizeIncoming(body, body.id);
	if (!updated) throw error(400, 'Invalid calendar event payload');
	const event = await ensureEventDirectory(updated);

	store.events = store.events.map((existing, i) => (i === index ? event : existing));
	await writeStore(store);
	return json({ event });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	if (!id) throw error(400, 'id is required');

	const store = await readStore();
	const before = store.events.length;
	store.events = store.events.filter((event) => event.id !== id);
	if (store.events.length === before) throw error(404, 'event not found');

	await writeStore(store);
	return json({ ok: true });
};
