import { expect, test } from 'vitest';
import { Scene } from 'foldkit';
import { hostCommandResolvers, hydratedModel, makeEntry, makeTimelineData } from './test/fixture-model.ts';
import { update } from './update.ts';
import { view } from './view/app.ts';

const program = { update, view };

type VNodeLike = {
	key?: string | number | null;
	children?: Array<VNodeLike | string | null | undefined>;
};

function collectSiblingKeyGroups(node: VNodeLike | string | null | undefined, groups: string[][] = []): string[][] {
	if (!node || typeof node === 'string') {
		return groups;
	}

	const children = Array.isArray(node.children) ? node.children : [];
	const siblingKeys = children
		.map((child) => (child && typeof child === 'object' ? child.key : undefined))
		.filter((key): key is string | number => key !== undefined && key !== null)
		.map(String);

	if (siblingKeys.length > 1) {
		groups.push(siblingKeys);
	}

	for (const child of children) {
		collectSiblingKeyGroups(child, groups);
	}

	return groups;
}

function expectUniqueSiblingKeys(root: VNodeLike): void {
	for (const siblingKeys of collectSiblingKeyGroups(root)) {
		expect(new Set(siblingKeys).size, `duplicate sibling keys: ${siblingKeys.join(', ')}`).toBe(siblingKeys.length);
	}
}

test('keyed timeline siblings stay unique when entry ids collide', () => {
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

	expectUniqueSiblingKeys(view(ready) as VNodeLike);

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
