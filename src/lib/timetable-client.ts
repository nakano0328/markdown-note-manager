import type { Timetable, TimetableSettings, TimetableSlot, TimetableTerm, TreeNode } from './types';

export interface SlotPersistArgs {
	day: string;
	period: string;
	slot: TimetableSlot | null;
	startTermId: string;
	endTermId: string;
	viewedTerm: TimetableTerm | null;
	viewedTimetable: Timetable;
}

export interface SlotUpdate {
	day: string;
	period: string;
	slot: TimetableSlot | null;
}

export interface SlotPersistResult {
	timetable: Timetable;
	settings: TimetableSettings;
	activeTerm: TimetableTerm;
	viewedTerm: TimetableTerm;
}

export function cloneTimetable(value: Timetable): Timetable {
	const next: Timetable = {};
	for (const [day, slots] of Object.entries(value)) {
		next[day] = {};
		for (const [period, slot] of Object.entries(slots)) {
			next[day][period] = { ...slot };
		}
	}
	return next;
}

function applySlotUpdate(base: Timetable, update: SlotUpdate): Timetable {
	const next = cloneTimetable(base);
	if (!next[update.day]) next[update.day] = {};
	if (update.slot) next[update.day][update.period] = { ...update.slot };
	else {
		delete next[update.day][update.period];
		if (Object.keys(next[update.day]).length === 0) delete next[update.day];
	}
	return next;
}

function applySlotUpdates(base: Timetable, updates: SlotUpdate[]): Timetable {
	return updates.reduce((next, update) => applySlotUpdate(next, update), base);
}

async function fetchTimetableForTerm(termId: string): Promise<Timetable> {
	const res = await fetch(`/api/timetable?termId=${encodeURIComponent(termId)}`);
	if (!res.ok) {
		const body = await res.json().catch(() => ({ message: res.statusText }));
		throw new Error(body.message ?? `Failed to load timetable (${res.status})`);
	}
	const data = (await res.json()) as { timetable: Timetable };
	return data.timetable ?? {};
}

export async function persistTimetableSlot(args: SlotPersistArgs): Promise<SlotPersistResult> {
	return persistTimetableSlots({
		updates: [{ day: args.day, period: args.period, slot: args.slot }],
		startTermId: args.startTermId,
		endTermId: args.endTermId,
		viewedTerm: args.viewedTerm,
		viewedTimetable: args.viewedTimetable
	});
}

export async function persistTimetableSlots(args: {
	updates: SlotUpdate[];
	startTermId: string;
	endTermId: string;
	viewedTerm: TimetableTerm | null;
	viewedTimetable: Timetable;
}): Promise<SlotPersistResult> {
	if (args.updates.length === 0) throw new Error('保存するコマがありません');
	const viewedTermId = args.viewedTerm?.id;
	let timetablePayload: Timetable;
	if (args.startTermId === viewedTermId) {
		timetablePayload = applySlotUpdates(args.viewedTimetable, args.updates);
	} else {
		const base = await fetchTimetableForTerm(args.startTermId);
		timetablePayload = applySlotUpdates(base, args.updates);
	}
	const res = await fetch('/api/timetable', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			timetable: timetablePayload,
			termId: args.startTermId,
			applyUntilTermId: args.endTermId,
			slotUpdates: args.updates
		})
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({ message: res.statusText }));
		throw new Error(body.message ?? `Failed to save (${res.status})`);
	}
	const data = (await res.json()) as SlotPersistResult;
	return data;
}

export function isSubjectDirectory(directory: string): boolean {
	const parts = directory.split('/').filter(Boolean);
	return parts.length === 3 && (parts[1] === '春' || parts[1] === '秋');
}

export function directoryName(directory: string): string {
	return directory.split('/').filter(Boolean).at(-1) ?? directory;
}

export function collectSubjectDirectories(tree: TreeNode[]): string[] {
	const out: string[] = [];
	const visit = (nodes: TreeNode[]) => {
		for (const node of nodes) {
			if (node.type === 'directory') {
				out.push(node.path);
				if (node.children) visit(node.children);
			}
		}
	};
	visit(tree);
	return out.filter(isSubjectDirectory).sort((a, b) => a.localeCompare(b, 'ja'));
}
