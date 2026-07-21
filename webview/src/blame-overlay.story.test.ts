import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { PersistState, ScrollToEntry, SendHostCommand } from './commands.ts';
import { ClickedPierreBlameLine, ClickedStepForward, GotHostMessage, ToggledHeatmap } from './messages.ts';
import { hostCommandResolvers, hydratedModel, makeEntry, makeTimelineData } from './test/fixture-model.ts';
import { update } from './update.ts';

test('heatmap loads blame lines and click focuses matching revision', () => {
	const data = makeTimelineData([
		makeEntry({ index: 0, revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', shortRevision: 'aaaaaaa' }),
		makeEntry({ index: 1, revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', shortRevision: 'bbbbbbb' }),
		makeEntry({ index: 2, revision: 'cccccccccccccccccccccccccccccccccccccccc', shortRevision: 'ccccccc' }),
		makeEntry({
			index: 3,
			revision: 'dddddddddddddddddddddddddddddddddddddddd',
			shortRevision: 'ddddddd',
			isWorkingTree: true,
		}),
	]);
	const ready = hydratedModel(data);

	Story.story(
		update,
		Story.with(ready),
		Story.message(ToggledHeatmap()),
		Story.Command.expectHas(SendHostCommand),
		Story.model((model) => {
			expect(model.heatmapOpen).toBe(true);
			expect(model.blameOverlayOpen).toBe(false);
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
							{ line: 1, revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
							{ line: 2, revision: 'cccccccccccccccccccccccccccccccccccccccc' },
						],
					},
				},
			}),
		),
		Story.model((model) => {
			expect(model.blameLoading).toBe(false);
			expect(model.blameLines).toHaveLength(2);
			expect(model.blameRangeKey).toBeTruthy();
		}),
		Story.message(ClickedPierreBlameLine({ line: 1, revision: 'bbbbbbb' })),
		Story.Command.expectHas(PersistState, ScrollToEntry),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.comparisonMode).toBe('step');
			expect(model.toIndex).toBe(1);
		}),
	);
});

test('heatmap blame reloads when stepping to another revision', () => {
	const data = makeTimelineData([
		makeEntry({ index: 0, revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', shortRevision: 'aaaaaaa' }),
		makeEntry({ index: 1, revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', shortRevision: 'bbbbbbb' }),
		makeEntry({ index: 2, revision: 'cccccccccccccccccccccccccccccccccccccccc', shortRevision: 'ccccccc' }),
		makeEntry({
			index: 3,
			revision: 'dddddddddddddddddddddddddddddddddddddddd',
			shortRevision: 'ddddddd',
			isWorkingTree: true,
		}),
	]);
	const ready = { ...hydratedModel(data), comparisonMode: 'step' as const, fromIndex: 0, toIndex: 1 };

	Story.story(
		update,
		Story.with(ready),
		Story.message(ToggledHeatmap()),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.message(
			GotHostMessage({
				payload: {
					type: 'diff-blame',
					payload: {
						fromIndex: 0,
						toIndex: 1,
						comparisonSource: 'revision',
						relativePath: data.relativePath,
						lines: [{ line: 1, revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }],
					},
				},
			}),
		),
		Story.model((model) => {
			expect(model.blameLines).toHaveLength(1);
			expect(model.blameRangeKey).toContain('0:1');
		}),
		Story.message(ClickedStepForward()),
		Story.Command.expectHas(SendHostCommand),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.toIndex).toBe(2);
			expect(model.blameLoading).toBe(true);
			expect(model.blameLines).toHaveLength(0);
		}),
	);
});
