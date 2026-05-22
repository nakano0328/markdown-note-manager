export interface NoteFrontmatter {
	title: string;
	date: string;
	location?: string;
	slide_url?: string;
	tags?: string[];
}

export interface Timetable {
	[dayOfWeek: string]: {
		[period: string]: {
			subject: string;
			directory: string;
		};
	};
}

export interface TimetableTerm {
	id: string;
	label: string;
	startsAt: string;
	endsAt: string;
}

export interface PeriodTime {
	start: string;
	end: string;
}

export interface TimetableSettings {
	version: 1;
	activeTermId: string;
	terms: TimetableTerm[];
	periodTimes?: PeriodTime[];
}

export type TaskPriority = 'high' | 'medium' | 'low';

export interface TaskItem {
	id: string;
	filePath: string;
	lineNumber: number;
	subject: string;
	content: string;
	isCompleted: boolean;
	dueDate: string | null;
	priority: TaskPriority | null;
}

export const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface TimetableSlot {
	subject: string;
	directory: string;
}

export interface SchoolHolidayEvent {
	id: string;
	date: string;
	type: 'school_holiday';
	title: string;
	note?: string;
}

export interface DaySwapEvent {
	id: string;
	date: string;
	type: 'day_swap';
	followsDay: Weekday;
	title?: string;
	note?: string;
}

export interface DateMoveEvent {
	id: string;
	date: string;
	type: 'date_move';
	fromDate: string;
	title?: string;
	note?: string;
}

export interface PeriodOverrideEvent {
	id: string;
	date: string;
	type: 'period_override';
	period: string;
	slot: TimetableSlot | null;
	title?: string;
	note?: string;
}

export type CalendarEvent =
	| SchoolHolidayEvent
	| DaySwapEvent
	| DateMoveEvent
	| PeriodOverrideEvent;
export type CalendarEventType = CalendarEvent['type'];

export interface PublicHoliday {
	date: string;
	name: string;
}

export interface DaySchedule {
	date: string;
	weekday: Weekday | null;
	isWeekend: boolean;
	publicHoliday: PublicHoliday | null;
	schoolHoliday: SchoolHolidayEvent | null;
	followsDay: Weekday | null;
	swapEvent: DaySwapEvent | null;
	inboundMove: DateMoveEvent | null;
	outboundMoves: DateMoveEvent[];
	overrides: PeriodOverrideEvent[];
	periods: Array<{
		period: string;
		slot: TimetableSlot | null;
		source: 'timetable' | 'override' | 'canceled';
	}>;
	isClassDay: boolean;
}

export type TreeNodeType = 'file' | 'image' | 'directory';

export interface TreeNode {
	name: string;
	path: string;
	type: TreeNodeType;
	children?: TreeNode[];
}
