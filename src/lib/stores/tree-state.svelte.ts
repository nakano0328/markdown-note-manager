/**
 * サイドバーのフォルダ開閉状態を保持するストア。
 *
 * - モジュールレベルの $state として持つので、Sidebar が unmount/remount
 *   されても（例: ヘッダーのトグルで非表示→再表示）状態は失われない。
 * - localStorage にも保存し、リロード後も復元する。
 */

const STORAGE_KEY = 'mnm:tree-expanded:v1';

class TreeState {
	private expanded = $state<Record<string, boolean>>({});
	private loaded = false;

	private ensureLoaded() {
		if (this.loaded) return;
		this.loaded = true;
		if (typeof localStorage === 'undefined') return;
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
			// ignore corrupted storage
		}
	}

	private persist() {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.expanded));
		} catch {
			// ignore quota / disabled storage
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
}

export const treeState = new TreeState();
