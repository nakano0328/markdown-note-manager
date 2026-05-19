import { WEEKDAYS, type Weekday } from '$lib/types';

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isDateOnly(value: unknown): value is string {
	return typeof value === 'string' && DATE_ONLY.test(value);
}

export function isWeekday(value: unknown): value is Weekday {
	return typeof value === 'string' && (WEEKDAYS as readonly string[]).includes(value);
}
