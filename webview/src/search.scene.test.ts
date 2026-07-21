import { test } from 'vitest';
import { Scene } from 'foldkit';
import { hostCommandResolvers, hydratedModel } from './test/fixture-model.ts';
import { update } from './update.ts';
import { view } from './view/app.ts';

const program = { update, view };

test('sidebar search filters revisions and clearing restores the list', () => {
	const ready = hydratedModel();

	Scene.scene(
		program,
		Scene.with(ready),
		Scene.expect(Scene.text('aaaa0000')).toExist(),
		Scene.expect(Scene.text('cccc0002')).toExist(),
		Scene.type(Scene.placeholder('Search: author:alex OR path:src AND desc:fix'), 'cccc'),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.text('cccc0002')).toExist(),
		Scene.expect(Scene.text('aaaa0000')).toBeAbsent(),
		Scene.type(Scene.placeholder('Search: author:alex OR path:src AND desc:fix'), 'zzzz-no-match'),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.text('No revisions match the current search.')).toExist(),
		Scene.type(Scene.placeholder('Search: author:alex OR path:src AND desc:fix'), ''),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.text('aaaa0000')).toExist(),
		Scene.expect(Scene.text('cccc0002')).toExist(),
	);
});

test('from-revision combobox opens options and commits a selected revision', () => {
	const ready = hydratedModel();

	Scene.scene(
		program,
		Scene.with(ready),
		Scene.expect(Scene.selector('#fromHandleLabel')).toContainText('dddd0003'),
		Scene.focus(Scene.selector('#fromRevisionInput')),
		Scene.Command.expectNone(),
		Scene.expect(Scene.selector('#fromRevisionInput')).toHaveAttr('aria-expanded', 'true'),
		// Draft still holds the current from revision while open, so clear/filter first.
		Scene.type(Scene.selector('#fromRevisionInput'), 'aaaa'),
		Scene.expect(Scene.role('option', { name: /aaaa0000/ })).toExist(),
		Scene.click(Scene.role('option', { name: /aaaa0000/ })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.selector('#fromHandleLabel')).toContainText('aaaa0000'),
		Scene.expect(Scene.selector('#toHandleLabel')).toContainText('Current'),
	);
});

test('to-revision combobox commits after widening the from boundary', () => {
	const ready = hydratedModel();

	Scene.scene(
		program,
		Scene.with(ready),
		Scene.focus(Scene.selector('#fromRevisionInput')),
		Scene.type(Scene.selector('#fromRevisionInput'), 'aaaa'),
		Scene.click(Scene.role('option', { name: /aaaa0000/ })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.focus(Scene.selector('#toRevisionInput')),
		Scene.type(Scene.selector('#toRevisionInput'), 'cccc'),
		Scene.click(Scene.role('option', { name: /cccc0002/ })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.selector('#fromHandleLabel')).toContainText('aaaa0000'),
		Scene.expect(Scene.selector('#toHandleLabel')).toContainText('cccc0002'),
	);
});
