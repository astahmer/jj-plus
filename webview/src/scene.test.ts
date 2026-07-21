import { test } from 'vitest';
import { Scene } from 'foldkit';
import { PersistState, SendHostCommand } from './commands.ts';
import { CompletedPersistState, CompletedSendHost } from './messages.ts';
import { hostCommandResolvers, hydratedModel } from './test/fixture-model.ts';
import { update } from './update.ts';
import { view } from './view/app.ts';

const program = { update, view };

test('toggle sidebar collapses the workspace chrome', () => {
	const ready = hydratedModel();

	Scene.scene(
		program,
		Scene.with(ready),
		Scene.expect(Scene.role('button', { name: 'Toggle sidebar (B)' })).toExist(),
		Scene.click(Scene.role('button', { name: 'Toggle sidebar (B)' })),
		Scene.Command.expectHas(PersistState),
		Scene.Command.resolve(PersistState, CompletedPersistState()),
		Scene.expect(Scene.selector('.workspace.is-collapsed')).toExist(),
	);
});

test('toggle intermediate keeps a stable label and flips pressed state', () => {
	const ready = hydratedModel();

	Scene.scene(
		program,
		Scene.with(ready),
		Scene.expect(Scene.role('button', { name: 'In-Between revisions' })).toBeEnabled(),
		Scene.expect(Scene.selector('#intermediateToggle')).toContainText('In-Between'),
		Scene.click(Scene.role('button', { name: 'In-Between revisions' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.selector('#intermediateToggle[aria-pressed="true"]')).toExist(),
		Scene.expect(Scene.selector('#intermediateToggle')).toContainText('In-Between'),
		Scene.click(Scene.role('button', { name: 'In-Between revisions' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.selector('#intermediateToggle[aria-pressed="false"]')).toExist(),
	);
});

test('hotkeys popover opens and closes from the toolbar', () => {
	const ready = hydratedModel();

	Scene.scene(
		program,
		Scene.with(ready),
		Scene.expect(Scene.text('Shortcuts')).toBeAbsent(),
		Scene.click(Scene.role('button', { name: 'Show hotkeys (?)' })),
		Scene.Command.expectNone(),
		Scene.expect(Scene.text('Shortcuts')).toExist(),
		Scene.click(Scene.role('button', { name: 'Show hotkeys (?)' })),
		Scene.expect(Scene.text('Shortcuts')).toBeAbsent(),
	);
});

test('step controls move the from/to handle labels', () => {
	const ready = hydratedModel();

	Scene.scene(
		program,
		Scene.with(ready),
		Scene.expect(Scene.selector('#fromHandleLabel')).toContainText('dddd0003'),
		Scene.expect(Scene.selector('#toHandleLabel')).toContainText('Current'),
		Scene.click(Scene.role('button', { name: 'Previous range' })),
		Scene.Command.resolveAll(
			...hostCommandResolvers(),
			[PersistState, CompletedPersistState()] as const,
			[SendHostCommand, CompletedSendHost()] as const,
		),
		Scene.expect(Scene.selector('#fromHandleLabel')).toContainText('cccc0002'),
		Scene.expect(Scene.selector('#toHandleLabel')).toContainText('dddd0003'),
		Scene.click(Scene.role('button', { name: 'Next range' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.selector('#fromHandleLabel')).toContainText('dddd0003'),
		Scene.expect(Scene.selector('#toHandleLabel')).toContainText('Current'),
	);
});

test('file switcher mode tabs switch workspace and overview', () => {
	const ready = hydratedModel();

	Scene.scene(
		program,
		Scene.with(ready),
		Scene.expect(Scene.role('tablist', { name: 'File switcher mode' })).toExist(),
		Scene.click(Scene.role('tab', { name: 'Top changed' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.selector('.file-switcher-summary')).toExist(),
		Scene.click(Scene.role('tab', { name: 'All files' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.selector('.file-switcher-summary')).toBeAbsent(),
		Scene.expect(Scene.selector('#rangeFileList')).toBeAbsent(),
	);
});

test('open editor diff from actions menu sends host command', () => {
	const ready = hydratedModel();

	Scene.scene(
		program,
		Scene.with(ready),
		Scene.click(Scene.selector('#actionsButton')),
		Scene.Command.expectNone(),
		Scene.expect(Scene.text('Open single-file diff')).toExist(),
		Scene.click(Scene.role('button', { name: 'Open single-file diff' })),
		Scene.Command.expectExact(
			SendHostCommand({
				command: {
					command: 'open-editor-diff',
					fromIndex: 3,
					toIndex: 4,
					comparisonSource: 'revision',
				},
			}),
		),
		Scene.Command.resolve(SendHostCommand, CompletedSendHost()),
	);
});
