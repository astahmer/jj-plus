import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { PersistState, ScrollToEntry, SendHostCommand } from './commands.ts';
import { GotHostMessage, SubmittedHistorySearch, UpdatedHistorySearchQuery } from './messages.ts';
import { hostCommandResolvers, hydratedModel } from './test/fixture-model.ts';
import { update } from './update.ts';

test('history search submits query and jumps to introduction', () => {
	const ready = hydratedModel();
	const introducedAt = Math.max(0, ready.toIndex - 1);

	Story.story(
		update,
		Story.with(ready),
		Story.message(UpdatedHistorySearchQuery({ value: 'needle' })),
		Story.message(SubmittedHistorySearch()),
		Story.Command.expectHas(SendHostCommand),
		Story.model((model) => {
			expect(model.historySearchLoading).toBe(true);
			expect(model.historySearchQuery).toBe('needle');
		}),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.message(
			GotHostMessage({
				payload: {
					type: 'history-search',
					payload: {
						query: 'needle',
						introducedAt,
						removedAt: null,
						hits: [
							{ entryIndex: introducedAt, kind: 'introduced' },
							{ entryIndex: ready.toIndex, kind: 'present' },
						],
					},
				},
			}),
		),
		Story.Command.expectHas(PersistState, ScrollToEntry),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.historySearchLoading).toBe(false);
			expect(model.toIndex).toBe(introducedAt);
			expect(model.comparisonMode).toBe('step');
		}),
	);
});
