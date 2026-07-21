import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { PersistState, ScrollToEntry } from './commands.ts';
import { ClickedEvologEntry, CompletedPersistState, CompletedScrollToEntry } from './messages.ts';
import { getEvologStripEntries } from './selectors.ts';
import {
	hostCommandResolvers,
	hydratedModel,
	jjTimelineData,
	makeEntry,
	makeTimelineData,
} from './test/fixture-model.ts';
import { update } from './update.ts';

test('getEvologStripEntries returns snapshot-source siblings for the selected change', () => {
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
				makeEntry({ index: 10, changeId: 'c2', shortRevision: 'evo1', operationId: 'op1' }),
				makeEntry({ index: 11, changeId: 'c2', shortRevision: 'evo2', operationId: 'op2' }),
				makeEntry({ index: 12, changeId: 'c1', shortRevision: 'other', operationId: 'op3' }),
			],
			snapshotState: { loadedChangeIds: ['c1', 'c2'] },
		},
	);
	const model = { ...hydratedModel(jjTimelineData()), data, toIndex: 1, comparisonSource: 'revision' as const };
	const strip = getEvologStripEntries(model);
	expect(strip.some((entry) => entry.shortRevision === 'evo1')).toBe(true);
	expect(strip.some((entry) => entry.shortRevision === 'evo2')).toBe(true);
});

test('ClickedEvologEntry switches to snapshot and selects the evolution entry', () => {
	const data = makeTimelineData(
		[
			makeEntry({ index: 0, changeId: 'c2', shortRevision: 'bbbb' }),
			makeEntry({ index: 1, changeId: 'c2', shortRevision: 'Current', isWorkingTree: true }),
		],
		{
			backend: 'jj',
			relativePath: 'app.ts',
			snapshotEntries: [
				makeEntry({ index: 0, changeId: 'c2', shortRevision: 'evo1', operationId: 'op1' }),
				makeEntry({ index: 1, changeId: 'c2', shortRevision: 'evo2', operationId: 'op2' }),
			],
			snapshotState: { loadedChangeIds: ['c2'] },
		},
	);
	const ready = { ...hydratedModel(data), data, toIndex: 1, comparisonSource: 'revision' as const };

	Story.story(
		update,
		Story.with(ready),
		Story.message(ClickedEvologEntry({ entryIndex: 1 })),
		Story.Command.resolveAll(
			...hostCommandResolvers(),
			[PersistState, CompletedPersistState()] as const,
			[ScrollToEntry, CompletedScrollToEntry()] as const,
		),
		Story.model((model) => {
			expect(model.comparisonSource).toBe('snapshot');
			expect(model.toIndex).toBe(1);
			expect(model.fromIndex).toBe(0);
		}),
	);
});
