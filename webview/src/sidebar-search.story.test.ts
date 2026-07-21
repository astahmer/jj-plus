import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { UpdatedSidebarSearchQuery } from './messages.ts';
import { getFilteredSidebarEntries } from './selectors.ts';
import { hydratedModel, makeEntry, makeTimelineData } from './test/fixture-model.ts';
import { update } from './update.ts';

test('structured sidebar search filters by author/path/desc and boolean ops', () => {
	const data = makeTimelineData([
		makeEntry({
			index: 0,
			authorName: 'Alex',
			description: 'fix loading',
			filePath: 'apps/web/src/main.ts',
			shortRevision: 'aaaa',
		}),
		makeEntry({
			index: 1,
			authorName: 'Sam',
			description: 'add feature',
			filePath: 'apps/web/src/app.ts',
			shortRevision: 'bbbb',
		}),
		makeEntry({
			index: 2,
			authorName: 'Alex',
			description: 'docs',
			filePath: 'packages/ui/button.ts',
			shortRevision: 'cccc',
			changeId: 'kqxz',
		}),
	]);
	const ready = hydratedModel(data);

	Story.story(
		update,
		Story.with(ready),
		Story.message(UpdatedSidebarSearchQuery({ value: 'author:Alex AND path:main' })),
		Story.model((model) => {
			expect(getFilteredSidebarEntries(model).map((entry) => entry.index)).toEqual([0]);
		}),
		Story.message(UpdatedSidebarSearchQuery({ value: 'revset:kqxz OR desc:feature' })),
		Story.model((model) => {
			expect(
				getFilteredSidebarEntries(model)
					.map((entry) => entry.index)
					.sort(),
			).toEqual([1, 2]);
		}),
	);
});
