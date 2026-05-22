import type {
	CalendarEvent,
	DateMoveEvent,
	DaySchedule,
	DaySwapEvent,
	PeriodOverrideEvent,
	PublicHoliday,
	SchoolHolidayEvent,
	TimetableSlot,
	Timetable,
	Weekday
} from './types';
import { WEEKDAYS } from './types';

export const PERIODS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

export function formatLocalDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function parseDate(value: string): Date {
	const [year, month, day] = value.split('-').map(Number);
	return new Date(year, month - 1, day);
}

export function addDays(date: string, days: number): string {
	const base = parseDate(date);
	base.setDate(base.getDate() + days);
	return formatLocalDate(base);
}

export function weekdayFromDate(date: string): Weekday | null {
	const idx = parseDate(date).getDay();
	return WEEKDAYS[(idx + 6) % 7] ?? null;
}

export function startOfWeekMonday(date: string): string {
	const d = parseDate(date);
	const day = d.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	d.setDate(d.getDate() + diff);
	return formatLocalDate(d);
}

export function startOfWeekSunday(date: string): string {
	const d = parseDate(date);
	const day = d.getDay();
	d.setDate(d.getDate() - day);
	return formatLocalDate(d);
}

export function startOfMonth(date: string): string {
	const d = parseDate(date);
	d.setDate(1);
	return formatLocalDate(d);
}

export function endOfMonth(date: string): string {
	const d = parseDate(date);
	d.setMonth(d.getMonth() + 1, 0);
	return formatLocalDate(d);
}

export function buildMonthGrid(monthAnchor: string): string[] {
	const first = startOfMonth(monthAnchor);
	const start = startOfWeekSunday(first);
	const last = endOfMonth(monthAnchor);
	const days: string[] = [];
	let cursor = start;
	while (cursor <= last || days.length % 7 !== 0) {
		days.push(cursor);
		cursor = addDays(cursor, 1);
	}
	return days;
}

export function buildWeekDates(date: string): string[] {
	const start = startOfWeekSunday(date);
	return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function isSameMonth(date: string, anchor: string): boolean {
	return date.slice(0, 7) === anchor.slice(0, 7);
}

export function resolveDaySchedule(
	date: string,
	timetable: Timetable,
	events: CalendarEvent[],
	holidays: PublicHoliday[]
): DaySchedule {
	const weekday = weekdayFromDate(date);
	const dayIndex = parseDate(date).getDay();
	const isWeekend = dayIndex === 0 || dayIndex === 6;
	const dayEvents = events.filter((event) => event.date === date);
	const schoolHoliday =
		(dayEvents.find((event) => event.type === 'school_holiday') as SchoolHolidayEvent | undefined) ??
		null;
	const swapEvent =
		(dayEvents.find((event) => event.type === 'day_swap') as DaySwapEvent | undefined) ?? null;
	const inboundMove =
		(dayEvents.find((event) => event.type === 'date_move') as DateMoveEvent | undefined) ?? null;
	const outboundMoves = events.filter(
		(event): event is DateMoveEvent => event.type === 'date_move' && event.fromDate === date
	);
	const overrides = dayEvents.filter(
		(event): event is PeriodOverrideEvent => event.type === 'period_override'
	);
	const publicHoliday = holidays.find((h) => h.date === date) ?? null;

	const moveFollowsDay = inboundMove ? weekdayFromDate(inboundMove.fromDate) : null;
	const followsDay = moveFollowsDay ?? swapEvent?.followsDay ?? weekday;
	const baseSlots = followsDay ? (timetable[followsDay] ?? {}) : {};
	const isHoliday = Boolean(publicHoliday || schoolHoliday);

	const periods = PERIODS.map((period) => {
		const override = overrides.find((event) => event.period === period);
		if (override) {
			return {
				period,
				slot: override.slot,
				source: override.slot ? ('override' as const) : ('canceled' as const)
			};
		}
		if (isHoliday) {
			return { period, slot: null, source: 'canceled' as const };
		}
		const slot = baseSlots[period] ?? null;
		return { period, slot, source: 'timetable' as const };
	});

	const isClassDay = periods.some((p) => p.slot !== null);

	const effectiveFollowsDay = moveFollowsDay ?? swapEvent?.followsDay ?? null;

	return {
		date,
		weekday,
		isWeekend,
		publicHoliday,
		schoolHoliday,
		followsDay: effectiveFollowsDay,
		swapEvent,
		inboundMove,
		outboundMoves,
		overrides,
		periods,
		isClassDay
	};
}

export function generateEventId(): string {
	const random = Math.random().toString(36).slice(2, 10);
	const stamp = Date.now().toString(36);
	return `evt-${stamp}-${random}`;
}

export type NowStatus = 'in_class' | 'break' | 'before_first' | 'after_last' | 'no_class';

export interface PeriodEntry {
	period: string;
	slot: TimetableSlot;
	startMin: number;
	endMin: number;
}

export interface NowSnapshot {
	status: NowStatus;
	current: (PeriodEntry & { minutesLeft: number }) | null;
	next: (PeriodEntry & { minutesUntil: number }) | null;
}

export function resolveCurrentPeriod(
	now: Date,
	schedule: DaySchedule,
	periodWindow: (period: string) => { startMin: number; endMin: number } | null
): NowSnapshot {
	const nowMin = now.getHours() * 60 + now.getMinutes();

	const entries: PeriodEntry[] = [];
	for (const p of schedule.periods) {
		if (!p.slot) continue;
		const win = periodWindow(p.period);
		if (!win) continue;
		entries.push({ period: p.period, slot: p.slot, startMin: win.startMin, endMin: win.endMin });
	}
	entries.sort((a, b) => a.startMin - b.startMin);

	if (entries.length === 0) {
		return { status: 'no_class', current: null, next: null };
	}

	const inClass = entries.find((e) => nowMin >= e.startMin && nowMin < e.endMin) ?? null;
	const upcoming = entries.find((e) => e.startMin > nowMin) ?? null;
	const last = entries[entries.length - 1];

	if (inClass) {
		return {
			status: 'in_class',
			current: { ...inClass, minutesLeft: inClass.endMin - nowMin },
			next: upcoming ? { ...upcoming, minutesUntil: upcoming.startMin - nowMin } : null
		};
	}

	if (upcoming && nowMin < entries[0].startMin) {
		return {
			status: 'before_first',
			current: null,
			next: { ...upcoming, minutesUntil: upcoming.startMin - nowMin }
		};
	}

	if (upcoming) {
		return {
			status: 'break',
			current: null,
			next: { ...upcoming, minutesUntil: upcoming.startMin - nowMin }
		};
	}

	if (nowMin >= last.endMin) {
		return { status: 'after_last', current: null, next: null };
	}

	return { status: 'no_class', current: null, next: null };
}
