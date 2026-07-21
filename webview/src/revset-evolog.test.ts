import { expect, test } from 'vitest';
import { getEvologStripEntries } from './selectors.ts';
import { hydratedModel, jjTimelineData, makeEntry, makeTimelineData } from './test/fixture-model.ts';

test('getEvologStripEntries returns snapshot siblings for the selected change', () => {
	const data = makeTimelineData(
		[
			makeEntry({ index: 0, changeId: 'c1', shortRevision: 'aaaa' }),
			makeEntry({ index: 1, changeId: 'c2', shortRevision: 'bbbb' }),
			makeEntry({ index: 2, changeId: 'c2', shortRevision: 'Current', isWorkingTree: true }),
		],
		{
			backend: 'jj',
			relativePath: 'app.ts',
			snapshotEntries: [
				makeEntry({ index: 0, changeId: 'c2', shortRevision: 'evo1', operationId: 'op1' }),
				makeEntry({ index: 1, changeId: 'c2', shortRevision: 'evo2', operationId: 'op2' }),
				makeEntry({ index: 2, changeId: 'c1', shortRevision: 'other', operationId: 'op3' }),
			],
		},
	);
	const model = { ...hydratedModel(jjTimelineData()), data, toIndex: 1 };
	const strip = getEvologStripEntries(model);
	expect(strip.map((entry) => entry.shortRevision)).toEqual(['evo1', 'evo2']);
});

test('getEvologStripEntries is empty without matching snapshots', () => {
	const model = hydratedModel();
	expect(getEvologStripEntries(model)).toEqual([]);
});
