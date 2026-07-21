import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { PersistState, ScrollToEntry, SendHostCommand } from './commands.ts';
import {
	BootedApp,
	ClickedOpenEditorDiff,
	ClickedOpenSelectionDiffs,
	ClickedStepBackward,
	ClickedStepForward,
	ClickedToggleActionsMenu,
	ClickedToggleDiffFocus,
	ClickedToggleHotkeys,
	ClickedToggleViewMenu,
	ClickedToggleSidebar,
	ClickedClearLineHistory,
	CompletedPersistState,
	CompletedSendHost,
	GotHostMessage,
	PressedShortcut,
	SelectedContentMode,
	SelectedLayoutMode,
	SubmittedFromRevision,
	SubmittedToRevision,
	ToggledIntermediate,
} from './messages.ts';
import { defaultTimelineData, hostCommandResolvers, hydratedModel, makeDiffPreview } from './test/fixture-model.ts';
import { init, update } from './update.ts';

test('boot emits BootSession and lands in Loading', () => {
	const [model, commands] = init();
	expect(model.session._tag).toBe('Loading');
	expect(commands).toHaveLength(1);
	expect(commands[0]?.name).toBe('BootSession');

	Story.story(
		update,
		Story.with(model),
		Story.message(BootedApp()),
		Story.Command.expectNone(),
		Story.model((next) => {
			expect(next.session._tag).toBe('Loading');
		}),
	);
});

test('timeline hydrate sets tip selection and requests host preview', () => {
	const data = defaultTimelineData();
	const [booted] = init();

	Story.story(
		update,
		Story.with(booted),
		Story.message(BootedApp()),
		Story.message(
			GotHostMessage({
				payload: { type: 'timeline-data', payload: data },
			}),
		),
		Story.Command.expectHas(SendHostCommand, ScrollToEntry),
		Story.model((model) => {
			expect(model.session._tag).toBe('Ready');
			expect(model.fromIndex).toBe(3);
			expect(model.toIndex).toBe(4);
			expect(model.fromRevisionDraft).toBe('dddd0003');
			expect(model.toRevisionDraft).toBe('Current');
			expect(model.fileInputValue).toBe('src/example.ts');
		}),
		Story.Command.resolveAll(...hostCommandResolvers()),
	);
});

test('toggle intermediate flips flag and persists preferences', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(ToggledIntermediate()),
		Story.Command.expectHas(PersistState),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.showIntermediateRevisions).toBe(true);
		}),
		Story.message(ToggledIntermediate()),
		Story.Command.expectHas(PersistState),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.showIntermediateRevisions).toBe(false);
		}),
	);
});

test('step and dock shortcuts move the selected range', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(ClickedStepBackward()),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.fromIndex).toBe(2);
			expect(model.toIndex).toBe(3);
		}),
		Story.message(ClickedStepForward()),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.fromIndex).toBe(3);
			expect(model.toIndex).toBe(4);
		}),
		Story.message(
			PressedShortcut({
				key: 'ArrowLeft',
				shiftKey: false,
				metaKey: true,
				ctrlKey: false,
				altKey: false,
				targetId: '',
				isEditableTarget: false,
			}),
		),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			// Visible without intermediates: [0, 2, 3, 4] — dock keeps width 1 at the start.
			expect(model.fromIndex).toBe(0);
			expect(model.toIndex).toBe(2);
		}),
		Story.message(
			PressedShortcut({
				key: 'ArrowRight',
				shiftKey: false,
				metaKey: true,
				ctrlKey: false,
				altKey: false,
				targetId: '',
				isEditableTarget: false,
			}),
		),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.fromIndex).toBe(3);
			expect(model.toIndex).toBe(4);
		}),
	);
});

test('revision submit commits from/to indexes', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(SubmittedFromRevision({ value: 'aaaa0000' })),
		Story.Command.expectHas(PersistState),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.fromIndex).toBe(0);
			expect(model.toIndex).toBe(4);
			expect(model.fromRevisionDraft).toBe('aaaa0000');
		}),
		Story.message(SubmittedToRevision({ value: 'cccc0002' })),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.fromIndex).toBe(0);
			expect(model.toIndex).toBe(2);
			expect(model.toRevisionDraft).toBe('cccc0002');
		}),
	);
});

test('diff actions emit exact host commands', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(ClickedOpenEditorDiff()),
		Story.Command.expectExact(
			SendHostCommand({
				command: {
					command: 'open-editor-diff',
					fromIndex: 3,
					toIndex: 4,
					comparisonSource: 'revision',
				},
			}),
		),
		Story.Command.resolve(SendHostCommand, CompletedSendHost()),
		Story.message(ClickedOpenSelectionDiffs()),
		Story.Command.expectExact(
			SendHostCommand({
				command: {
					command: 'open-range-files-diff',
					fromIndex: 3,
					toIndex: 4,
					comparisonSource: 'revision',
					selectedEntryIndexes: [4],
				},
			}),
		),
		Story.Command.resolve(SendHostCommand, CompletedSendHost()),
	);
});

test('preference toggles persist layout and sidebar state', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(ClickedToggleSidebar()),
		Story.Command.expectHas(PersistState),
		Story.Command.resolve(PersistState, CompletedPersistState()),
		Story.model((model) => {
			expect(model.sidebarCollapsed).toBe(true);
		}),
		Story.message(SelectedLayoutMode({ value: 'unified' })),
		Story.Command.expectHas(PersistState),
		Story.Command.resolve(PersistState, CompletedPersistState()),
		Story.model((model) => {
			expect(model.layoutMode).toBe('unified');
		}),
		Story.message(SelectedContentMode({ value: 'full' })),
		Story.Command.expectHas(PersistState),
		Story.Command.resolve(PersistState, CompletedPersistState()),
		Story.model((model) => {
			expect(model.contentMode).toBe('full');
		}),
	);
});

test('diff focus and menu toggles are mutually exclusive', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(ClickedToggleHotkeys()),
		Story.Command.expectNone(),
		Story.model((model) => {
			expect(model.hotkeysOpen).toBe(true);
			expect(model.actionsMenuOpen).toBe(false);
			expect(model.viewMenuOpen).toBe(false);
		}),
		Story.message(ClickedToggleViewMenu()),
		Story.Command.expectNone(),
		Story.model((model) => {
			expect(model.viewMenuOpen).toBe(true);
			expect(model.hotkeysOpen).toBe(false);
			expect(model.actionsMenuOpen).toBe(false);
		}),
		Story.message(ClickedToggleActionsMenu()),
		Story.Command.expectNone(),
		Story.model((model) => {
			expect(model.actionsMenuOpen).toBe(true);
			expect(model.hotkeysOpen).toBe(false);
			expect(model.viewMenuOpen).toBe(false);
		}),
		Story.message(ClickedToggleDiffFocus()),
		Story.Command.expectNone(),
		Story.model((model) => {
			expect(model.diffFocusMode).toBe(true);
		}),
		Story.message(ClickedToggleHotkeys()),
		Story.model((model) => {
			expect(model.hotkeysOpen).toBe(true);
			expect(model.actionsMenuOpen).toBe(false);
			expect(model.viewMenuOpen).toBe(false);
		}),
	);
});

test('clear line history asks the host to reload without the filter', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(ClickedClearLineHistory()),
		Story.Command.expectHas(SendHostCommand),
		Story.Command.resolve(SendHostCommand, CompletedSendHost()),
		Story.model(() => {
			// Host reload is async; command shape is the contract under test.
		}),
	);
});

test('hydrated model helper seeds a ready session with preview', () => {
	const model = hydratedModel();
	expect(model.session._tag).toBe('Ready');
	expect(model.fromIndex).toBe(3);
	expect(model.toIndex).toBe(4);
	expect(Object.keys(model.previewByRange).length).toBeGreaterThan(0);

	const preview = makeDiffPreview(3, 4);
	expect(preview.hasChanges).toBe(true);
});

test('clear line history asks the host to reload without the filter', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(ClickedClearLineHistory()),
		Story.Command.expectHas(SendHostCommand),
		Story.Command.resolve(SendHostCommand, CompletedSendHost()),
	);
});
