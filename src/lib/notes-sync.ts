export const NOTES_DIRTY_EVENT = 'mnm:notes-dirty';

export function markNotesDirty() {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent(NOTES_DIRTY_EVENT));
}
