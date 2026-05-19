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

function applySlotUpdate(base: Timetable, day: string, period: string, slot: TimetableSlot | null): Timetable {
	const next = cloneTimetable(base);
	if (!next[day]) next[day] = {};
	if (slot) next[day][period] = { ...slot };
	else {
		delete next[day][period];
		if (Object.keys(next[day]).length === 0) delete next[day];
	}
	return next;
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
	const slotUpdate = { day: args.day, period: args.period, slot: args.slot };
	const viewedTermId = args.viewedTerm?.id;
	let timetablePayload: Timetable;
	if (args.startTermId === viewedTermId) {
		timetablePayload = applySlotUpdate(args.viewedTimetable, args.day, args.period, args.slot);
	} else {
		const base = await fetchTimetableForTerm(args.startTermId);
		timetablePayload = applySlotUpdate(base, args.day, args.period, args.slot);
	}
	const res = await fetch('/api/timetable', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			timetable: timetablePayload,
			termId: args.startTermId,
			applyUntilTermId: args.endTermId,
			slotUpdate
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
