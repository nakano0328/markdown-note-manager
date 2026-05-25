import { error } from '@sveltejs/kit';
import { addDays } from '$lib/calendar';
import type { TimetableSettings, TimetableTerm } from '$lib/types';
import { isObject, DATE_ONLY } from './validators';

export function isValidTerm(value: unknown): value is TimetableTerm {
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

const HHMM = /^\d{2}:\d{2}$/;

export function isValidPeriodTime(value: unknown): boolean {
	if (!isObject(value)) return false;
	return (
		typeof value.start === 'string' &&
		typeof value.end === 'string' &&
		HHMM.test(value.start) &&
		HHMM.test(value.end) &&
		value.start < value.end
	);
}

export function isValidSettings(value: unknown): value is TimetableSettings {
	if (!isObject(value)) return false;
	if (value.version !== 1 || typeof value.activeTermId !== 'string' || !Array.isArray(value.terms)) {
		return false;
	}
	if (!value.terms.every(isValidTerm)) return false;
	if (value.periodTimes !== undefined) {
		if (!Array.isArray(value.periodTimes)) return false;
		if (!value.periodTimes.every(isValidPeriodTime)) return false;
	}
	return true;
}

export function orderedTerms(terms: TimetableTerm[]): TimetableTerm[] {
	return [...terms].sort((a, b) => {
		const byStart = a.startsAt.localeCompare(b.startsAt);
		if (byStart !== 0) return byStart;
		return a.endsAt.localeCompare(b.endsAt);
	});
}

export function normalizeSettings(settings: TimetableSettings): TimetableSettings {
	return {
		...settings,
		terms: orderedTerms(settings.terms)
	};
}

export function defaultTermForDate(date: string): TimetableTerm {
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

export function nextTermAfter(term: TimetableTerm): TimetableTerm {
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

export function assertTermRangesValid(terms: TimetableTerm[]) {
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

export function ensureTermForDate(
	settings: TimetableSettings,
	date: string
): { termId: string; changed: boolean } {
	const containing = settings.terms.find((term) => term.startsAt <= date && date <= term.endsAt);
	if (containing) return { termId: containing.id, changed: false };

	const sorted = orderedTerms(settings.terms);
	const nearestPast = sorted.findLast((term) => term.startsAt <= date);
	const nearestFuture = sorted.find((term) => term.startsAt > date);
	const nearest = nearestPast && nearestFuture ? nearestFuture : (nearestPast ?? nearestFuture);
	if (nearest) return { termId: nearest.id, changed: false };

	const fallback = defaultTermForDate(date);
	settings.terms = orderedTerms([...settings.terms, fallback]);
	assertTermRangesValid(settings.terms);
	return { termId: fallback.id, changed: true };
}

export function resolveActiveTermId(settings: TimetableSettings, today: string): boolean {
	const containing = settings.terms.find((term) => term.startsAt <= today && today <= term.endsAt);
	if (containing) {
		if (settings.activeTermId === containing.id) return false;
		settings.activeTermId = containing.id;
		return true;
	}

	let sorted = orderedTerms(settings.terms);
	let changed = false;
	for (let i = 0; i < 20; i++) {
		const activeTerm = sorted.find((term) => term.id === settings.activeTermId);
		if (activeTerm && activeTerm.endsAt >= today) return changed;

		const nextExistingTerm = activeTerm
			? sorted.find((term) => term.startsAt > activeTerm.startsAt)
			: (sorted.find((term) => term.startsAt > today) ?? sorted.at(-1));
		if (nextExistingTerm) {
			settings.activeTermId = nextExistingTerm.id;
			changed = true;
			continue;
		}

		const nextTerm = activeTerm ? nextTermAfter(activeTerm) : defaultTermForDate(today);
		const existingTerm = settings.terms.find((term) => term.id === nextTerm.id);
		if (!existingTerm) {
			settings.terms = orderedTerms([...settings.terms, nextTerm]);
			sorted = settings.terms;
		}
		settings.activeTermId = existingTerm?.id ?? nextTerm.id;
		changed = true;
	}

	throw error(500, 'Failed to resolve active timetable term');
}

export function ensureTerm(settings: TimetableSettings, termId: string): TimetableTerm {
	const term = settings.terms.find((item) => item.id === termId);
	if (!term) throw error(400, `Unknown timetable term: ${termId}`);
	return term;
}

export function termRange(
	settings: TimetableSettings,
	fromTermId: string,
	toTermId: string
): TimetableTerm[] {
	const terms = orderedTerms(settings.terms);
	const fromIndex = terms.findIndex((term) => term.id === fromTermId);
	const toIndex = terms.findIndex((term) => term.id === toTermId);
	if (fromIndex < 0 || toIndex < 0) throw error(400, 'Unknown timetable term range');
	if (toIndex < fromIndex) throw error(400, 'applyUntilTermId must be after termId');
	return terms.slice(fromIndex, toIndex + 1);
}

export function generateTermId(terms: TimetableTerm[], startsAt: string): string {
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
