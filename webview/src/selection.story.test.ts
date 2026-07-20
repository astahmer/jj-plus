import { Option } from 'effect';
import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { evo } from 'foldkit/struct';
import { PersistState, SendHostCommand } from './commands.ts';
import {
	ClickedHistoryEntry,
	ClickedRefreshTimeline,
	ClickedResetPreferences,
	CompletedSendHost,
	HoveredEntry,
	PressedShortcut,
	SelectedLayoutMode,
	SubmittedFileSwitcher,
} from './messages.ts';
import { hostCommandResolvers, hydratedModel } from './test/fixture-model.ts';
import { getSelectionMeta } from './selectors.ts';
import { update } from './update.ts';

test('pending sidebar selection commits, cancels, and updates selection meta', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(ClickedHistoryEntry({ entryIndex: 4 })),
		Story.Command.expectNone(),
		Story.model((model) => {
			expect(model.selection._tag).toBe('PendingAnchor');
			expect(getSelectionMeta(model)).toContain('Pick another revision');
		}),
		Story.message(HoveredEntry({ entryIndex: 2 })),
		Story.model((model) => {
			expect(getSelectionMeta(model)).toContain('Selecting');
		}),
		Story.message(ClickedHistoryEntry({ entryIndex: 4 })),
		Story.Command.expectNone(),
		Story.model((model) => {
			expect(model.selection._tag).toBe('IdlePick');
			expect(getSelectionMeta(model)).toContain('Click an anchor');
		}),
		Story.message(ClickedHistoryEntry({ entryIndex: 2 })),
		Story.message(ClickedHistoryEntry({ entryIndex: 4 })),
		Story.Command.expectHas(PersistState),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.fromIndex).toBe(2);
			expect(model.toIndex).toBe(4);
			expect(model.selection._tag).toBe('IdlePick');
		}),
	);
});

test('editable inputs block letter hotkeys and clear focus on plain typing', () => {
	const ready = hydratedModel();
	const focused = evo(ready, {
		shortcutFocusedInputId: () => Option.some('fromRevisionInput'),
	});

	Story.story(
		update,
		Story.with(ready),
		Story.message(
			PressedShortcut({
				key: 'b',
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
				altKey: false,
				targetId: 'sidebarSearchInput',
				isEditableTarget: true,
			}),
		),
		Story.Command.expectNone(),
		Story.model((model) => {
			expect(model.sidebarCollapsed).toBe(false);
		}),
		Story.message(
			PressedShortcut({
				key: 'ArrowLeft',
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
				altKey: false,
				targetId: 'fromRevisionInput',
				isEditableTarget: true,
			}),
		),
		Story.Command.expectNone(),
		Story.model((model) => {
			expect(model.fromIndex).toBe(3);
			expect(model.toIndex).toBe(4);
		}),
	);

	Story.story(
		update,
		Story.with(focused),
		Story.message(
			PressedShortcut({
				key: 'ArrowLeft',
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
				altKey: false,
				targetId: 'fromRevisionInput',
				isEditableTarget: true,
			}),
		),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.fromIndex).toBe(2);
			expect(model.toIndex).toBe(3);
			expect(model.shortcutFocusedInputId._tag).toBe('Some');
		}),
		Story.message(
			PressedShortcut({
				key: 'x',
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
				altKey: false,
				targetId: 'fromRevisionInput',
				isEditableTarget: true,
			}),
		),
		Story.Command.expectNone(),
		Story.model((model) => {
			expect(model.shortcutFocusedInputId._tag).toBe('None');
		}),
	);
});

test('file switch and refresh put the session back into Loading with host commands', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(SubmittedFileSwitcher({ value: 'src/other.ts' })),
		Story.Command.expectExact(
			SendHostCommand({
				command: { command: 'switch-file', relativePath: 'src/other.ts' },
			}),
		),
		Story.Command.resolve(SendHostCommand, CompletedSendHost()),
		Story.model((model) => {
			expect(model.session._tag).toBe('Loading');
			expect(model.sessionKey).toBe(ready.sessionKey + 1);
		}),
	);

	Story.story(
		update,
		Story.with(ready),
		Story.message(ClickedRefreshTimeline()),
		Story.Command.expectExact(SendHostCommand({ command: { command: 'refresh' } })),
		Story.Command.resolve(SendHostCommand, CompletedSendHost()),
		Story.model((model) => {
			expect(model.session._tag).toBe('Loading');
		}),
	);
});

test('reset preferences restores default chrome and selection window', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(SelectedLayoutMode({ value: 'unified' })),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.layoutMode).toBe('unified');
		}),
		Story.message(ClickedResetPreferences()),
		Story.Command.expectHas(PersistState),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.layoutMode).toBe('split');
			expect(model.contentMode).toBe('diffs');
			expect(model.preset).toBe('year');
			expect(model.showIntermediateRevisions).toBe(false);
			expect(model.comparisonMode).toBe('range');
			expect(model.fromIndex).toBe(3);
			expect(model.toIndex).toBe(4);
		}),
	);
});
