import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { SendHostCommand } from './commands.ts';
import { GotHostMessage, ToggledRangeStack } from './messages.ts';
import { defaultTimelineData, hostCommandResolvers, hydratedModel, makeDiffPreview } from './test/fixture-model.ts';
import { update } from './update.ts';

test('range stack toggle requests load-range-stack and stores previews', () => {
	const ready = hydratedModel();
	const fromIndex = ready.fromIndex;
	const toIndex = ready.toIndex;
	const currentPath = defaultTimelineData().relativePath;

	Story.story(
		update,
		Story.with(ready),
		Story.message(ToggledRangeStack()),
		Story.Command.expectHas(SendHostCommand),
		Story.model((model) => {
			expect(model.rangeStackOpen).toBe(true);
			expect(model.rangeStackByPath).toEqual({});
		}),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.message(
			GotHostMessage({
				payload: {
					type: 'range-stack-previews',
					payload: {
						fromIndex: Math.min(fromIndex, toIndex),
						toIndex: Math.max(fromIndex, toIndex),
						comparisonSource: 'revision',
						items: [
							{
								relativePath: currentPath,
								preview: makeDiffPreview(fromIndex, toIndex),
							},
							{
								relativePath: 'apps/backend/src/service.ts',
								preview: makeDiffPreview(fromIndex, toIndex, {
									beforePath: 'apps/backend/src/service.ts',
									afterPath: 'apps/backend/src/service.ts',
								}),
							},
						],
					},
				},
			}),
		),
		Story.model((model) => {
			expect(Object.keys(model.rangeStackByPath)).toEqual([currentPath, 'apps/backend/src/service.ts']);
		}),
	);
});
