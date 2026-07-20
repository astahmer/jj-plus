import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { evo } from 'foldkit/struct';
import { PersistState, SendHostCommand } from './commands.ts';
import { GotHostMessage, SelectedComparisonSource, SelectedFileSwitcherMode } from './messages.ts';
import {
	hostCommandResolvers,
	hydratedModel,
	jjTimelineData,
	makeDiffPreview,
	makeEntry,
} from './test/fixture-model.ts';
import { update } from './update.ts';
import { buildEntryDiffCountKey, buildRangeOverviewKey } from './domain/timeline-selection.ts';

test('empty tip preview stays on the newest selection instead of jumping older', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(
			GotHostMessage({
				payload: {
					type: 'diff-preview',
					payload: makeDiffPreview(3, 4, { hasChanges: false, diffCount: 0, additions: 0 }),
				},
			}),
		),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.fromIndex).toBe(3);
			expect(model.toIndex).toBe(4);
			expect(model.pendingRangeResolutionKey).toBe('');
			const preview = model.previewByRange['revision:3:4'] as { hasChanges?: boolean } | undefined;
			expect(preview?.hasChanges).toBe(false);
		}),
	);
});

test('entry diff counts and range overview host replies land in the model', () => {
	const overviewKey = buildRangeOverviewKey(3, 4, 'revision', [4]);
	const ready = evo(hydratedModel(), {
		rangeOverviewLoadingKey: () => '',
		entryDiffCountLoadingKey: () => '',
		rangeOverviewByRange: () => ({}),
	});

	Story.story(
		update,
		Story.with(ready),
		Story.message(SelectedFileSwitcherMode({ value: 'overview' })),
		Story.Command.expectHas(SendHostCommand),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.fileSwitcherMode).toBe('overview');
			expect(model.rangeOverviewLoadingKey).toBe(overviewKey);
		}),
		Story.message(
			GotHostMessage({
				payload: {
					type: 'range-overview',
					payload: {
						fromIndex: 3,
						toIndex: 4,
						comparisonSource: 'revision',
						selectedEntryIndexes: [4],
						items: [
							{ relativePath: 'src/example.ts', changeCount: 3, isCurrentFile: true },
							{ relativePath: 'src/other.ts', changeCount: 1 },
						],
					},
				},
			}),
		),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.rangeOverviewByRange[overviewKey]).toEqual([
				{ relativePath: 'src/example.ts', changeCount: 3, isCurrentFile: true },
				{ relativePath: 'src/other.ts', changeCount: 1 },
			]);
			expect(model.rangeOverviewLoadingKey).toBe('');
		}),
		Story.message(
			GotHostMessage({
				payload: {
					type: 'entry-diff-counts',
					payload: {
						comparisonSource: 'revision',
						counts: [
							{ entryIndex: 3, diffCount: 5 },
							{ entryIndex: 4, diffCount: 2 },
						],
					},
				},
			}),
		),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.entryDiffCountByKey[buildEntryDiffCountKey(3, 'revision')]).toBe(5);
			expect(model.entryDiffCountByKey[buildEntryDiffCountKey(4, 'revision')]).toBe(2);
		}),
	);
});

test('git backend ignores snapshot comparison source switches', () => {
	const ready = hydratedModel();

	Story.story(
		update,
		Story.with(ready),
		Story.message(SelectedComparisonSource({ value: 'snapshot' })),
		Story.Command.expectNone(),
		Story.model((model) => {
			expect(model.comparisonSource).toBe('revision');
		}),
	);
});

test('jj snapshot source hydrates snapshot entries from the host', () => {
	const ready = hydratedModel(jjTimelineData());

	Story.story(
		update,
		Story.with(ready),
		Story.message(SelectedComparisonSource({ value: 'snapshot' })),
		Story.Command.expectHas(PersistState, SendHostCommand),
		Story.Command.resolveAll(...hostCommandResolvers(12)),
		Story.model((model) => {
			expect(model.comparisonSource).toBe('snapshot');
		}),
		Story.message(
			GotHostMessage({
				payload: {
					type: 'snapshot-entries',
					payload: {
						snapshotEntries: [
							makeEntry({
								index: 0,
								id: 'snapshot:change-d/0',
								shortRevision: 'change-d/0',
								changeId: 'change-d',
								operationId: 'op-d',
								operationKey: 'change-d/0',
							}),
							makeEntry({
								index: 1,
								id: 'snapshot:change-d/1',
								shortRevision: 'change-d/1',
								changeId: 'change-d',
								operationId: 'op-d-1',
								operationKey: 'change-d/1',
							}),
						],
						snapshotState: { loadedChangeIds: ['change-d'] },
					},
				},
			}),
		),
		Story.Command.resolveAll(...hostCommandResolvers(12)),
		Story.model((model) => {
			const data = model.data as {
				snapshotEntries: Array<{ id: string }>;
				snapshotState?: { loadedChangeIds: string[] };
			};
			expect(data.snapshotState?.loadedChangeIds).toEqual(['change-d']);
			expect(data.snapshotEntries.map((entry) => entry.id)).toEqual(['snapshot:change-d/0', 'snapshot:change-d/1']);
			expect(model.comparisonSource).toBe('snapshot');
		}),
	);
});
