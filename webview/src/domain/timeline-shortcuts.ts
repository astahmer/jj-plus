export type TimelineShortcutCommand =
	| { type: 'toggleHotkeys' }
	| { type: 'toggleSidebar' }
	| { type: 'toggleDiffFocus' }
	| {
			type: 'focusInput';
			elementId: 'fromRevisionInput' | 'toRevisionInput' | 'fileSwitcher' | 'sidebarSearchInput';
			openSidebar?: boolean;
	  }
	| { type: 'closeOverlays' }
	| { type: 'exitDiffFocus' }
	| { type: 'openSelectionDiffs' }
	| { type: 'dockRange'; edge: 'start' | 'end' }
	| { type: 'adjustBoundary'; side: 'from' | 'to'; amount: number }
	| { type: 'stepSelection'; amount: number };

export type TimelineShortcutEvent = {
	key: string;
	shiftKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	hotkeysOpen: boolean;
	actionsMenuOpen: boolean;
	viewMenuOpen: boolean;
	diffFocusMode: boolean;
};

const TOGGLE_SHORTCUT_TOOLTIPS = {
	toggleHotkeys: 'Show hotkeys (?)',
	toggleSidebar: 'Toggle sidebar (B)',
	toggleDiffFocus: 'Focus diff (D)',
	exitDiffFocus: 'Exit focus (D)',
} as const;

export type ToggleShortcutId = keyof typeof TOGGLE_SHORTCUT_TOOLTIPS;

export function shortcutTooltip(id: ToggleShortcutId): string {
	return TOGGLE_SHORTCUT_TOOLTIPS[id];
}

export function resolveTimelineShortcut(event: TimelineShortcutEvent): TimelineShortcutCommand | null {
	const lowerKey = event.key.toLowerCase();
	const jumpAmount = event.shiftKey ? 5 : 1;

	if (event.key === '?' || (event.shiftKey && event.key === '/')) {
		return { type: 'toggleHotkeys' };
	}

	if (event.key === 'Escape' && (event.hotkeysOpen || event.actionsMenuOpen || event.viewMenuOpen)) {
		return { type: 'closeOverlays' };
	}

	if (event.key === 'Escape' && event.diffFocusMode) {
		return { type: 'exitDiffFocus' };
	}

	if (!event.metaKey && !event.ctrlKey && !event.altKey && lowerKey === 'b') {
		return { type: 'toggleSidebar' };
	}

	if (!event.metaKey && !event.ctrlKey && !event.altKey && lowerKey === 'd') {
		return { type: 'toggleDiffFocus' };
	}

	if (!event.metaKey && !event.ctrlKey && !event.altKey && lowerKey === 'f') {
		return { type: 'focusInput', elementId: 'fromRevisionInput' };
	}

	if (!event.metaKey && !event.ctrlKey && !event.altKey && lowerKey === 't') {
		return { type: 'focusInput', elementId: 'toRevisionInput' };
	}

	if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === '/') {
		return { type: 'focusInput', elementId: 'fileSwitcher' };
	}

	if (!event.metaKey && !event.ctrlKey && !event.altKey && lowerKey === 's') {
		return { type: 'focusInput', elementId: 'sidebarSearchInput', openSidebar: true };
	}

	if (event.key === ' ' && !event.metaKey && !event.ctrlKey && !event.altKey) {
		return { type: 'openSelectionDiffs' };
	}

	if (event.metaKey && event.key === 'ArrowLeft') {
		return { type: 'dockRange', edge: 'start' };
	}

	if (event.metaKey && event.key === 'ArrowRight') {
		return { type: 'dockRange', edge: 'end' };
	}

	if (event.key === 'ArrowLeft') {
		if (event.altKey) {
			return { type: 'adjustBoundary', side: 'to', amount: -jumpAmount };
		}

		if (event.ctrlKey) {
			return { type: 'adjustBoundary', side: 'from', amount: -jumpAmount };
		}

		return { type: 'stepSelection', amount: -jumpAmount };
	}

	if (event.key === 'ArrowRight') {
		if (event.altKey) {
			return { type: 'adjustBoundary', side: 'to', amount: jumpAmount };
		}

		if (event.ctrlKey) {
			return { type: 'adjustBoundary', side: 'from', amount: jumpAmount };
		}

		return { type: 'stepSelection', amount: jumpAmount };
	}

	if (event.key === 'ArrowUp') {
		return { type: 'stepSelection', amount: jumpAmount };
	}

	if (event.key === 'ArrowDown') {
		return { type: 'stepSelection', amount: -jumpAmount };
	}

	return null;
}

export function getEditableShortcutBehavior(args: {
	isEditableTarget: boolean;
	targetId: string | null;
	shortcutFocusedInputId: string | null;
	shortcut: TimelineShortcutCommand | null;
}): 'allow' | 'block' | 'clear' {
	if (!args.isEditableTarget) {
		return 'allow';
	}

	if (args.shortcut?.type === 'closeOverlays') {
		return 'allow';
	}

	if (args.targetId !== args.shortcutFocusedInputId) {
		return 'block';
	}

	return args.shortcut ? 'allow' : 'clear';
}
