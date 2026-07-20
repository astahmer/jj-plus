import assert from 'node:assert/strict';
import test from 'node:test';

import { getEditableShortcutBehavior, resolveTimelineShortcut } from '../../webview/src/domain/timeline-shortcuts.ts';

function makeShortcutEvent(
	overrides: Partial<{
		key: string;
		shiftKey: boolean;
		metaKey: boolean;
		ctrlKey: boolean;
		altKey: boolean;
		hotkeysOpen: boolean;
		actionsMenuOpen: boolean;
		viewMenuOpen: boolean;
		diffFocusMode: boolean;
	}> = {},
) {
	return {
		key: 'a',
		shiftKey: false,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		hotkeysOpen: false,
		actionsMenuOpen: false,
		viewMenuOpen: false,
		diffFocusMode: false,
		...overrides,
	};
}

test('resolveTimelineShortcut maps focus, overlay, and range commands', () => {
	assert.deepEqual(resolveTimelineShortcut(makeShortcutEvent({ key: '/' })), {
		type: 'focusInput',
		elementId: 'fileSwitcher',
	});
	assert.deepEqual(resolveTimelineShortcut(makeShortcutEvent({ key: 'f' })), {
		type: 'focusInput',
		elementId: 'fromRevisionInput',
	});
	assert.deepEqual(resolveTimelineShortcut(makeShortcutEvent({ key: 'ArrowRight', altKey: true })), {
		type: 'adjustBoundary',
		side: 'to',
		amount: 1,
	});
	assert.deepEqual(resolveTimelineShortcut(makeShortcutEvent({ key: 'ArrowLeft', ctrlKey: true, shiftKey: true })), {
		type: 'adjustBoundary',
		side: 'from',
		amount: -5,
	});
	assert.deepEqual(resolveTimelineShortcut(makeShortcutEvent({ key: 'Escape', actionsMenuOpen: true })), {
		type: 'closeOverlays',
	});
	assert.deepEqual(resolveTimelineShortcut(makeShortcutEvent({ key: 'Escape', diffFocusMode: true })), {
		type: 'exitDiffFocus',
	});
});

test('editable shortcut behavior only chains commands from shortcut-focused inputs', () => {
	const focusShortcut = resolveTimelineShortcut(makeShortcutEvent({ key: 'f' }));
	const closeShortcut = resolveTimelineShortcut(makeShortcutEvent({ key: 'Escape', hotkeysOpen: true }));

	assert.equal(
		getEditableShortcutBehavior({
			isEditableTarget: true,
			targetId: 'fileSwitcher',
			shortcutFocusedInputId: 'fileSwitcher',
			shortcut: focusShortcut,
		}),
		'allow',
	);
	assert.equal(
		getEditableShortcutBehavior({
			isEditableTarget: true,
			targetId: 'fileSwitcher',
			shortcutFocusedInputId: 'fileSwitcher',
			shortcut: null,
		}),
		'clear',
	);
	assert.equal(
		getEditableShortcutBehavior({
			isEditableTarget: true,
			targetId: 'fileSwitcher',
			shortcutFocusedInputId: null,
			shortcut: focusShortcut,
		}),
		'block',
	);
	assert.equal(
		getEditableShortcutBehavior({
			isEditableTarget: true,
			targetId: 'fileSwitcher',
			shortcutFocusedInputId: null,
			shortcut: closeShortcut,
		}),
		'allow',
	);
	assert.equal(
		getEditableShortcutBehavior({
			isEditableTarget: false,
			targetId: null,
			shortcutFocusedInputId: null,
			shortcut: focusShortcut,
		}),
		'allow',
	);
});
