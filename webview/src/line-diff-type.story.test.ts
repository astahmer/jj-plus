import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { PersistState } from './commands.ts';
import { SelectedLineDiffType } from './messages.ts';
import { hostCommandResolvers, hydratedModel, makeEntry, makeTimelineData } from './test/fixture-model.ts';
import { update } from './update.ts';

test('lineDiffType preference persists and updates model', () => {
	const ready = hydratedModel(makeTimelineData([makeEntry({ index: 0 }), makeEntry({ index: 1 })]));
	expect(ready.lineDiffType).toBe('word-alt');

	Story.story(
		update,
		Story.with(ready),
		Story.message(SelectedLineDiffType({ value: 'char' })),
		Story.Command.expectHas(PersistState),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.lineDiffType).toBe('char');
		}),
	);
});
