import { PERIODS } from './calendar';
import type { PeriodTime, TimetableSettings } from './types';

export type { PeriodTime };

export const DEFAULT_PERIOD_TIMES: PeriodTime[] = [
	{ start: '08:50', end: '10:20' },
	{ start: '10:30', end: '12:00' },
	{ start: '12:50', end: '14:20' },
	{ start: '14:30', end: '16:00' },
	{ start: '16:10', end: '17:40' },
	{ start: '17:50', end: '19:20' },
	{ start: '19:30', end: '21:00' },
	{ start: '21:10', end: '22:40' }
];

export const MAX_PERIODS = 10;

export function parseHHMM(value: string): number {
	const [h, m] = value.split(':').map(Number);
	return h * 60 + m;
}

export function nowMinutes(now: Date): number {
	return now.getHours() * 60 + now.getMinutes();
}

export function effectivePeriodTimes(
	settings: TimetableSettings | null | undefined
): PeriodTime[] {
	const configured = settings?.periodTimes;
	if (configured && configured.length > 0) return configured;
	return DEFAULT_PERIOD_TIMES;
}

export function enabledPeriods(settings: TimetableSettings | null | undefined): string[] {
	const list = effectivePeriodTimes(settings);
	return Array.from({ length: list.length }, (_, i) => String(i + 1));
}

export function getPeriodTime(
	period: string,
	settings: TimetableSettings | null | undefined
): PeriodTime | null {
	const list = effectivePeriodTimes(settings);
	const idx = Number(period) - 1;
	return Number.isFinite(idx) ? (list[idx] ?? null) : null;
}

export function buildPeriodWindow(
	settings: TimetableSettings | null | undefined
): (period: string) => { startMin: number; endMin: number } | null {
	const list = effectivePeriodTimes(settings);
	return (period) => {
		const idx = Number(period) - 1;
		const entry = list[idx];
		if (!entry) return null;
		return { startMin: parseHHMM(entry.start), endMin: parseHHMM(entry.end) };
	};
}

export { PERIODS };
