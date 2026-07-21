import assert from 'node:assert/strict';
import test from 'node:test';
import { diffHunkContainsNeedle } from '../../src/shared/diff-content-search.ts';
import { searchHistoryContents, searchHistoryDiffContents } from '../../src/shared/history-search.ts';
import { resolveNonEmptyRevisionPair } from '../../src/shared/revision-diff-pair.ts';

test('diffHunkContainsNeedle matches added or removed lines only', () => {
	assert.equal(
		diffHunkContainsNeedle({
			before: 'const a = 1\nconst keep = true\n',
			after: 'const a = 1\nconst keep = true\nconst TODO = 2\n',
			needle: 'TODO',
		}),
		true,
	);
	assert.equal(
		diffHunkContainsNeedle({
			before: 'const TODO = 1\nconst keep = true\n',
			after: 'const TODO = 1\nconst keep = true\n',
			needle: 'TODO',
		}),
		false,
	);
	assert.equal(
		diffHunkContainsNeedle({
			before: 'const TODO = 1\nconst keep = true\n',
			after: 'const keep = true\n',
			needle: 'TODO',
		}),
		true,
	);
});

test('searchHistoryDiffContents ignores unchanged file presence', () => {
	const contentsByIndex = new Map<number, string>([
		[0, 'alpha\nTODO once\n'],
		[1, 'alpha\nTODO once\nbeta\n'],
		[2, 'alpha\nTODO once\nbeta\ngamma\n'],
	]);
	const result = searchHistoryDiffContents({
		query: 'TODO',
		orderedEntryIndexes: [0, 1, 2],
		contentsByIndex,
	});
	assert.deepEqual(
		result.hits.map((hit) => hit.entryIndex),
		[0],
	);
});

test('searchHistoryContents still tracks full-file introduction', () => {
	const contentsByIndex = new Map<number, string>([
		[0, 'alpha'],
		[1, 'alpha TODO'],
		[2, 'alpha TODO'],
	]);
	const result = searchHistoryContents({
		query: 'TODO',
		orderedEntryIndexes: [0, 1, 2],
		contentsByIndex,
	});
	assert.equal(result.introducedAt, 1);
	assert.equal(result.hits.length, 2);
});

test('resolveNonEmptyRevisionPair skips identical tip pairs like @ twin of parent', async () => {
	const files = new Map<string, string>([
		['aaa', 'v1'],
		['bbb', 'v2'],
		['@', 'v2'],
	]);
	const pair = await resolveNonEmptyRevisionPair({
		revisions: ['aaa', 'bbb', '@'],
		tipIndex: 2,
		showFile: async (rev) => files.get(rev) ?? '',
	});
	assert.ok(pair);
	assert.equal(pair!.tipIndex, 1);
	assert.equal(pair!.base, 'aaa');
	assert.equal(pair!.tip, 'bbb');
	assert.equal(pair!.originalContent, 'v1');
	assert.equal(pair!.modifiedContent, 'v2');
});
