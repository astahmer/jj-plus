import { test } from 'vitest';
import { Scene } from 'foldkit';
import { hostCommandResolvers, hydratedModel, makeEntry, makeTimelineData } from './test/fixture-model.ts';
import { update } from './update.ts';
import { view } from './view/app.ts';

const program = { update, view };

test('timeline track survives re-render when sibling entry ids collide', () => {
	const ready = hydratedModel(
		makeTimelineData([
			makeEntry({ index: 0, id: 'dup-id', shortRevision: 'aaaa0000', revision: 'aaaa0000'.padEnd(40, '0') }),
			makeEntry({ index: 1, id: 'dup-id', shortRevision: 'bbbb0001', revision: 'bbbb0001'.padEnd(40, '0') }),
			makeEntry({
				index: 2,
				id: 'unique-tip',
				shortRevision: 'Current',
				revision: 'cccc0002'.padEnd(40, '0'),
				isWorkingTree: true,
				relativeDate: 'now',
				shortDate: 'Today',
			}),
		]),
	);

	Scene.scene(
		program,
		Scene.with(ready),
		Scene.expect(Scene.selector('#track')).toExist(),
		Scene.click(Scene.role('button', { name: 'Previous range' })),
		Scene.Command.resolveAll(...hostCommandResolvers()),
		Scene.expect(Scene.selector('#track')).toExist(),
		Scene.expect(Scene.selector('#fromHandleLabel')).toContainText('aaaa0000'),
		Scene.expect(Scene.selector('#toHandleLabel')).toContainText('bbbb0001'),
	);
});
