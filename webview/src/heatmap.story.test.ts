import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { PersistState, SendHostCommand } from './commands.ts';
import { GotHostMessage, ToggledHeatmap } from './messages.ts';
import { hostCommandResolvers, hydratedModel, makeEntry, makeTimelineData } from './test/fixture-model.ts';
import { update } from './update.ts';

test('heatmap toggle loads blame and persists preference', () => {
	const data = makeTimelineData([
		makeEntry({ index: 0, revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', shortRevision: 'aaaaaaa' }),
		makeEntry({ index: 1, revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', shortRevision: 'bbbbbbb' }),
	]);
	const ready = hydratedModel(data);

	Story.story(
		update,
		Story.with(ready),
		Story.message(ToggledHeatmap()),
		Story.Command.expectHas(PersistState, SendHostCommand),
		Story.model((model) => {
			expect(model.heatmapOpen).toBe(true);
			expect(model.blameLoading).toBe(true);
		}),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.message(
			GotHostMessage({
				payload: {
					type: 'diff-blame',
					payload: {
						fromIndex: Math.min(ready.fromIndex, ready.toIndex),
						toIndex: Math.max(ready.fromIndex, ready.toIndex),
						comparisonSource: 'revision',
						relativePath: data.relativePath,
						lines: [
							{ line: 1, revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', authorTimestamp: 100 },
							{ line: 2, revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', authorTimestamp: 200 },
						],
					},
				},
			}),
		),
		Story.model((model) => {
			expect(model.blameLoading).toBe(false);
			expect(model.heatmapOpen).toBe(true);
			expect(model.blameLines).toHaveLength(2);
		}),
	);
});
