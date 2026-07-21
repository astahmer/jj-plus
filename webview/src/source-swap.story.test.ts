import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { PersistState, ScrollToEntry } from './commands.ts';
import { ClickedHistorySearchHit, GotHostMessage, SelectedComparisonSource } from './messages.ts';
import { hostCommandResolvers, hydratedModel, makeEntry, makeTimelineData } from './test/fixture-model.ts';
import { mapSelectionAcrossSources } from './domain/timeline-selection.ts';
import { update } from './update.ts';

test('mapSelectionAcrossSources keeps the same changeId tip when possible', () => {
	const revisionEntries = [
		makeEntry({ index: 0, changeId: 'aaaa', shortRevision: 'r0' }),
		makeEntry({ index: 1, changeId: 'bbbb', shortRevision: 'r1' }),
		makeEntry({ index: 2, changeId: 'cccc', shortRevision: 'r2' }),
	];
	const snapshotEntries = [
		makeEntry({ index: 10, changeId: 'aaaa', shortRevision: 's0', operationId: 'op0' }),
		makeEntry({ index: 11, changeId: 'bbbb', shortRevision: 's1', operationId: 'op1' }),
		makeEntry({ index: 12, changeId: 'cccc', shortRevision: 's2', operationId: 'op2' }),
		makeEntry({ index: 13, changeId: 'cccc', shortRevision: 's3', operationId: 'op3' }),
	];

	expect(
		mapSelectionAcrossSources({
			previousEntries: revisionEntries,
			nextEntries: snapshotEntries,
			fromIndex: 1,
			toIndex: 2,
			comparisonMode: 'step',
		}),
	).toEqual({ fromIndex: 12, toIndex: 13 });
});

test('switching comparison source remaps selection and closes open menus', () => {
	const data = makeTimelineData(
		[
			makeEntry({ index: 0, changeId: 'c0', shortRevision: 'r0' }),
			makeEntry({ index: 1, changeId: 'c1', shortRevision: 'r1' }),
			makeEntry({ index: 2, changeId: 'c2', shortRevision: 'r2' }),
		],
		{
			backend: 'jj',
			snapshotEntries: [
				makeEntry({ index: 0, changeId: 'c0', shortRevision: 's0', operationId: 'op0' }),
				makeEntry({ index: 1, changeId: 'c1', shortRevision: 's1', operationId: 'op1' }),
				makeEntry({ index: 2, changeId: 'c2', shortRevision: 's2', operationId: 'op2' }),
				makeEntry({ index: 3, changeId: 'c2', shortRevision: 's3', operationId: 'op3' }),
			],
			snapshotState: { loadedChangeIds: ['c0', 'c1', 'c2'] },
		},
	);
	const ready = hydratedModel(data);

	Story.story(
		update,
		Story.with({
			...ready,
			fromIndex: 1,
			toIndex: 2,
			viewMenuOpen: true,
			comparisonSource: 'revision',
			comparisonMode: 'step',
			overlay: { _tag: 'ViewMenu' },
		}),
		Story.message(SelectedComparisonSource({ value: 'snapshot' })),
		Story.Command.expectHas(PersistState),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.comparisonSource).toBe('snapshot');
			expect(model.viewMenuOpen).toBe(false);
			expect(model.toIndex).toBe(3);
			expect(model.fromIndex).toBe(2);
		}),
	);
});

test('history search hit jumps into revision mode and closes overlays', () => {
	const data = makeTimelineData(
		[
			makeEntry({ index: 0, changeId: 'c0', shortRevision: 'r0' }),
			makeEntry({ index: 1, changeId: 'c1', shortRevision: 'r1' }),
			makeEntry({ index: 2, changeId: 'c2', shortRevision: 'r2' }),
		],
		{
			backend: 'jj',
			snapshotEntries: [
				makeEntry({ index: 0, changeId: 'c0', shortRevision: 's0', operationId: 'op0' }),
				makeEntry({ index: 1, changeId: 'c1', shortRevision: 's1', operationId: 'op1' }),
			],
			snapshotState: { loadedChangeIds: ['c0', 'c1'] },
		},
	);
	const ready = hydratedModel(data);

	Story.story(
		update,
		Story.with({
			...ready,
			comparisonSource: 'snapshot',
			viewMenuOpen: true,
			overlay: { _tag: 'ViewMenu' },
			fromIndex: 0,
			toIndex: 1,
			historySearchQuery: 'needle',
		}),
		Story.message(ClickedHistorySearchHit({ entryIndex: 2 })),
		Story.Command.expectHas(PersistState, ScrollToEntry),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.comparisonSource).toBe('revision');
			expect(model.comparisonMode).toBe('step');
			expect(model.viewMenuOpen).toBe(false);
			expect(model.toIndex).toBe(2);
			expect(model.fromIndex).toBe(1);
		}),
	);
});

test('history search result introduction jumps without leaving a pending selection', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with({ ...ready, historySearchQuery: 'needle', historySearchLoading: true }),
		Story.message(
			GotHostMessage({
				payload: {
					type: 'history-search',
					payload: {
						query: 'needle',
						hits: [{ entryIndex: 2, kind: 'introduced' }],
						introducedAt: 2,
						removedAt: null,
					},
				},
			}),
		),
		Story.Command.expectHas(PersistState, ScrollToEntry),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.comparisonMode).toBe('step');
			expect(model.selection._tag).toBe('IdlePick');
			expect(model.toIndex).toBe(2);
			expect(model.historySearchLoading).toBe(false);
		}),
	);
});
