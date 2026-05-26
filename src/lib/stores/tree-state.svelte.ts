/**
 * サイドバーのフォルダ開閉状態を保持するストア。
 *
 * - モジュールレベルの $state として持つので、Sidebar が unmount/remount
 *   されても（例: ヘッダーのトグルで非表示→再表示）状態は失われない。
 * - localStorage にも保存し、リロード後も復元する。
 */

import { browser } from '$app/environment';

const STORAGE_KEY = 'mnm:tree-expanded:v1';

class TreeState {
	private expanded = $state<Record<string, boolean>>({});
	private reloadVersion = $state(0);
	private loaded = false;

	get version() {
		return this.reloadVersion;
	}

	loadFromStorage() {
		if (this.loaded) return;
		if (!browser) return;
		this.loaded = true;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed: unknown = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') {
				const next: Record<string, boolean> = {};
				for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
					if (typeof v === 'boolean') next[k] = v;
				}
				this.expanded = next;
			}
		} catch {
			// 壊れた保存データは無視する。
		}
	}

	private ensureLoaded() {
		this.loadFromStorage();
	}

	private persist() {
		if (!browser) return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.expanded));
		} catch {
			// 容量超過や localStorage 無効化時は永続化だけ諦める。
		}
	}

	isOpen(path: string, defaultOpen: boolean): boolean {
		this.ensureLoaded();
		const explicit = this.expanded[path];
		return explicit ?? defaultOpen;
	}

	toggle(path: string, defaultOpen: boolean) {
		this.ensureLoaded();
		const next = !this.isOpen(path, defaultOpen);
		this.expanded = { ...this.expanded, [path]: next };
		this.persist();
	}

	set(path: string, value: boolean) {
		this.ensureLoaded();
		this.expanded = { ...this.expanded, [path]: value };
		this.persist();
	}

	requestReload() {
		this.reloadVersion += 1;
	}

	revealFile(path: string) {
		this.ensureLoaded();
		const parts = path.split('/').filter(Boolean);
		const next = { ...this.expanded };
		for (let i = 1; i < parts.length; i++) {
			next[parts.slice(0, i).join('/')] = true;
		}
		this.expanded = next;
		this.persist();
		this.requestReload();
	}
}

export const treeState = new TreeState();
