import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { SendHostCommand } from './commands.ts';
import { CompletedSendHost, GotHostMessage, UpdatedSidebarSearchQuery } from './messages.ts';
import { getFilteredSidebarEntries } from './selectors.ts';
import { hydratedModel, makeEntry, makeTimelineData } from './test/fixture-model.ts';
import { update } from './update.ts';

test('content: sidebar search requests host matches and filters rows', () => {
	const data = makeTimelineData([
		makeEntry({ index: 0, description: 'alpha', shortRevision: 'aaaa' }),
		makeEntry({ index: 1, description: 'beta', shortRevision: 'bbbb' }),
		makeEntry({ index: 2, description: 'gamma', shortRevision: 'cccc' }),
	]);
	const ready = hydratedModel(data);

	Story.story(
		update,
		Story.with(ready),
		Story.message(UpdatedSidebarSearchQuery({ value: 'content:TODO' })),
		Story.Command.expectHas(SendHostCommand),
		Story.model((model) => {
			expect(model.sidebarContentNeedle).toBe('TODO');
			expect(model.sidebarContentLoading).toBe(true);
		}),
		Story.Command.resolve(SendHostCommand, CompletedSendHost()),
		Story.message(
			GotHostMessage({
				payload: {
					type: 'history-search',
					payload: {
						query: 'TODO',
						purpose: 'sidebar',
						introducedAt: 0,
						removedAt: null,
						hits: [
							{ entryIndex: 0, kind: 'introduced' },
							{ entryIndex: 2, kind: 'present' },
						],
					},
				},
			}),
		),
		Story.model((model) => {
			expect(model.sidebarContentLoading).toBe(false);
			expect(model.sidebarContentMatchIndexes).toEqual([0, 2]);
			expect(
				getFilteredSidebarEntries(model)
					.map((entry) => entry.index)
					.sort(),
			).toEqual([0, 2]);
		}),
	);
});
