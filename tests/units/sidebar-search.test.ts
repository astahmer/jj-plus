import assert from 'node:assert/strict';
import test from 'node:test';
import { filterEntriesBySidebarSearch, parseSidebarSearchQuery } from '../../src/shared/sidebar-search.ts';
import type { FileRevisionEntry } from '../../src/shared/timeline-types.ts';

function entry(overrides: Partial<FileRevisionEntry> & Pick<FileRevisionEntry, 'index'>): FileRevisionEntry {
	return {
		id: `e${overrides.index}`,
		revision: overrides.revision || `rev${overrides.index}`.padEnd(40, '0'),
		shortRevision: overrides.shortRevision || `r${overrides.index}`,
		changeId: overrides.changeId || `c${overrides.index}`,
		authorDate: overrides.authorDate || '2026-07-08T12:00:00+02:00',
		authorName: overrides.authorName || 'Alex',
		description: overrides.description || `entry ${overrides.index}`,
		isWorkingTree: false,
		touchesFile: true,
		timestamp: overrides.index,
		filePath: overrides.filePath || 'apps/web/src/main.ts',
		shortDate: overrides.shortDate || 'Jul 8',
		relativeDate: overrides.relativeDate || '1d ago',
		index: overrides.index,
		...overrides,
	};
}

test('parseSidebarSearchQuery understands fields, quotes, AND/OR, and grouping', () => {
	const node = parseSidebarSearchQuery('author:alex AND (path:main OR desc:"fix loading") -date:2025');
	assert.ok(node);
	assert.equal(node?.kind, 'group');
	if (node?.kind !== 'group') {
		return;
	}
	assert.equal(node.op, 'and');
	assert.equal(node.children.length, 3);
});

test('filterEntriesBySidebarSearch matches fielded queries and boolean ops', () => {
	const entries = [
		entry({ index: 0, authorName: 'Alex', description: 'fix loading', filePath: 'apps/web/src/main.ts' }),
		entry({ index: 1, authorName: 'Sam', description: 'add feature', filePath: 'apps/web/src/app.ts' }),
		entry({
			index: 2,
			authorName: 'Alex',
			description: 'rename path',
			filePath: 'packages/ui/button.ts',
			changeId: 'kqxz',
			shortRevision: 'kqxz/be2ffee3',
		}),
	];

	assert.deepEqual(
		filterEntriesBySidebarSearch(entries, 'author:Alex').map((item) => item.index),
		[0, 2],
	);
	assert.deepEqual(
		filterEntriesBySidebarSearch(entries, 'author:Alex AND path:main').map((item) => item.index),
		[0],
	);
	assert.deepEqual(
		filterEntriesBySidebarSearch(entries, 'desc:feature OR path:button').map((item) => item.index),
		[1, 2],
	);
	assert.deepEqual(
		filterEntriesBySidebarSearch(entries, 'revset:kqxz').map((item) => item.index),
		[2],
	);
	assert.deepEqual(
		filterEntriesBySidebarSearch(entries, 'author:Alex -path:packages').map((item) => item.index),
		[0],
	);
	assert.deepEqual(
		filterEntriesBySidebarSearch(entries, 'loading').map((item) => item.index),
		[0],
	);
});
