import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { evo } from 'foldkit/struct';
import { TimeLapseTick, ToggledTimeLapse } from './messages.ts';
import { hostCommandResolvers, hydratedModel } from './test/fixture-model.ts';
import { update } from './update.ts';

test('time-lapse toggles play and advances on tick', () => {
	const ready = evo(hydratedModel(), {
		comparisonMode: () => 'step' as const,
		fromIndex: () => 0,
		toIndex: () => 1,
		timeLapsePlaying: () => false,
	});

	Story.story(
		update,
		Story.with(ready),
		Story.message(ToggledTimeLapse()),
		Story.model((model) => {
			expect(model.timeLapsePlaying).toBe(true);
		}),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.message(TimeLapseTick()),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.timeLapsePlaying).toBe(true);
			expect(model.toIndex).toBeGreaterThan(1);
		}),
		Story.message(ToggledTimeLapse()),
		Story.model((model) => {
			expect(model.timeLapsePlaying).toBe(false);
		}),
	);
});
