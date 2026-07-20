import { test } from 'vitest';
import { Scene } from 'foldkit';
import { hostCommandResolvers, hydratedModel } from './test/fixture-model.ts';
import { update } from './update.ts';
import { view } from './view/app.ts';

const program = { update, view };

test('single comparison mode exposes step status and next-step navigation', () => {
	const ready = hydratedModel();

	Scene.scene(
		program,
		Scene.with(ready),
		Scene.expect(Scene.selector('#stepStatus')).toBeAbsent(),
		Scene.click(Scene.role('button', { name: 'Single' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.role('button', { name: 'Single', pressed: true })).toExist(),
		Scene.expect(Scene.selector('#stepStatus')).toContainText('diffs'),
		Scene.expect(Scene.selector('#fromHandleLabel')).toContainText('dddd0003'),
		Scene.expect(Scene.selector('#toHandleLabel')).toContainText('Current'),
		Scene.click(Scene.role('button', { name: 'Previous range' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.selector('#toHandleLabel')).toContainText('dddd0003'),
		Scene.click(Scene.role('button', { name: 'Range' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.role('button', { name: 'Range', pressed: true })).toExist(),
		Scene.expect(Scene.selector('#stepStatus')).toBeAbsent(),
	);
});

test('layout and content mode toggles update pressed segment state', () => {
	const ready = hydratedModel();

	Scene.scene(
		program,
		Scene.with(ready),
		Scene.click(Scene.role('button', { name: 'View options' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.click(Scene.role('button', { name: 'Unified' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.role('button', { name: 'Unified', pressed: true })).toExist(),
		Scene.click(Scene.role('button', { name: 'Whole file' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.role('button', { name: 'Whole file', pressed: true })).toExist(),
		Scene.click(Scene.role('button', { name: 'Split' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.role('button', { name: 'Split', pressed: true })).toExist(),
		Scene.click(Scene.role('button', { name: 'Diffs' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.role('button', { name: 'Diffs', pressed: true })).toExist(),
	);
});
