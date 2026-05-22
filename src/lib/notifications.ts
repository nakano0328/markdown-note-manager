import { browser } from '$app/environment';
import type { NowSnapshot } from './calendar';
import type { TaskItem } from './types';

const SEEN_KEY = 'mnm:notifications:seen';
const PERMISSION_ASKED_KEY = 'mnm:notifications:asked';

type SeenMap = Record<string, number>;

function loadSeen(): SeenMap {
	if (!browser) return {};
	try {
		const raw = localStorage.getItem(SEEN_KEY);
		if (!raw) return {};
		return JSON.parse(raw) as SeenMap;
	} catch {
		return {};
	}
}

function saveSeen(seen: SeenMap): void {
	if (!browser) return;
	try {
		localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
	} catch {
		// 容量超過などは無視
	}
}

function isSupported(): boolean {
	return browser && typeof Notification !== 'undefined';
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
	if (!isSupported()) return 'unsupported';
	return Notification.permission;
}

export function shouldOfferPermissionPrompt(): boolean {
	if (!isSupported()) return false;
	if (Notification.permission !== 'default') return false;
	if (!browser) return false;
	return localStorage.getItem(PERMISSION_ASKED_KEY) !== '1';
}

export async function requestPermission(): Promise<NotificationPermission | 'unsupported'> {
	if (!isSupported()) return 'unsupported';
	if (browser) localStorage.setItem(PERMISSION_ASKED_KEY, '1');
	if (Notification.permission !== 'default') return Notification.permission;
	try {
		const result = await Notification.requestPermission();
		return result;
	} catch {
		return Notification.permission;
	}
}

function notifyOnce(key: string, title: string, body: string): void {
	if (!isSupported()) return;
	if (Notification.permission !== 'granted') return;
	const seen = loadSeen();
	if (seen[key]) return;
	try {
		new Notification(title, { body, tag: key });
	} catch {
		return;
	}
	seen[key] = Date.now();
	// 古いキーを掃除（30日以上前は削除）
	const cutoff = Date.now() - 30 * 86_400_000;
	for (const k of Object.keys(seen)) {
		if (seen[k] < cutoff) delete seen[k];
	}
	saveSeen(seen);
}

export function notifyDailyTaskSummary(today: string, tasks: TaskItem[]): void {
	const pending = tasks.filter((t) => !t.isCompleted);
	const overdue = pending.filter((t) => t.dueDate && t.dueDate < today);
	const dueToday = pending.filter((t) => t.dueDate === today);
	if (overdue.length === 0 && dueToday.length === 0) return;

	const parts: string[] = [];
	if (overdue.length > 0) parts.push(`期限切れ ${overdue.length} 件`);
	if (dueToday.length > 0) parts.push(`今日締切 ${dueToday.length} 件`);
	const sampleTitles = [...overdue, ...dueToday].slice(0, 3).map((t) => `・${t.content}`);

	notifyOnce(
		`daily-tasks:${today}`,
		`課題リマインド（${parts.join(' / ')}）`,
		sampleTitles.join('\n')
	);
}

export function notifyUpcomingClass(snapshot: NowSnapshot, today: string): void {
	const nxt = snapshot.next;
	if (!nxt) return;
	if (nxt.minutesUntil > 5 || nxt.minutesUntil < 0) return;
	notifyOnce(
		`upcoming-class:${today}:${nxt.period}`,
		`まもなく ${nxt.period}限 ${nxt.slot.subject}`,
		`あと ${nxt.minutesUntil} 分で開始します。`
	);
}
