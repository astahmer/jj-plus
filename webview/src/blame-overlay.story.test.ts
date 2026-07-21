import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { PersistState, ScrollToEntry, SendHostCommand } from './commands.ts';
import { GotHostMessage, ToggledBlameOverlay, ClickedPierreBlameLine } from './messages.ts';
import { hostCommandResolvers, hydratedModel, makeEntry, makeTimelineData } from './test/fixture-model.ts';
import { update } from './update.ts';

test('blame overlay loads annotations and click focuses matching revision', () => {
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
		Story.message(ToggledBlameOverlay()),
		Story.Command.expectHas(SendHostCommand),
		Story.model((model) => {
			expect(model.blameOverlayOpen).toBe(true);
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
