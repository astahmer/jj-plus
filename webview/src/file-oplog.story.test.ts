import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { PersistState, ScrollToEntry } from './commands.ts';
import { ClickedFileOpLogEntry } from './messages.ts';
import { hostCommandResolvers, hydratedModel, makeEntry, makeTimelineData } from './test/fixture-model.ts';
import { update } from './update.ts';

test('file op-log strip click jumps to linked snapshot entry', () => {
	const data = makeTimelineData(
		[
			makeEntry({ index: 0, revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', shortRevision: 'aaaa', changeId: 'c1' }),
			makeEntry({ index: 1, revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', shortRevision: 'bbbb', changeId: 'c1' }),
		],
		{
			backend: 'jj',
			snapshotEntries: [
				makeEntry({
					index: 0,
					revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
					shortRevision: 'aaaa/0',
					changeId: 'c1',
					operationId: 'opaaaa1111',
					description: 'first snap',
				}),
				makeEntry({
					index: 1,
					revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
					shortRevision: 'bbbb/1',
					changeId: 'c1',
					operationId: 'opbbbb2222',
					description: 'second snap',
				}),
			],
		},
	);
	const ready = hydratedModel(data);

	Story.story(
		update,
		Story.with({
			...ready,
			fileOpLogEntries: [
				{ operationId: 'opbbbb2222', description: 'second snap', entryIndex: 1, changeId: 'c1' },
			],
		}),
		Story.message(ClickedFileOpLogEntry({ operationId: 'opbbbb2222' })),
		Story.Command.expectHas(PersistState, ScrollToEntry),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.comparisonSource).toBe('snapshot');
			expect(model.toIndex).toBe(1);
		}),
	);
});
