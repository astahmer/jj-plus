import assert from 'node:assert/strict';
import test from 'node:test';

import { searchHistoryContents, searchHistoryDiffContents } from '../../src/shared/history-search.ts';

test('searchHistoryContents finds introduction and removal', () => {
	const contentsByIndex = new Map<number, string>([
		[0, 'alpha\n'],
		[1, 'alpha\nneedle\n'],
		[2, 'alpha\nneedle\nmore\n'],
		[3, 'alpha\nmore\n'],
	]);
	const result = searchHistoryContents({
		query: 'needle',
		orderedEntryIndexes: [0, 1, 2, 3],
		contentsByIndex,
	});
	assert.equal(result.introducedAt, 1);
	assert.equal(result.removedAt, 3);
	assert.deepEqual(
		result.hits.map((hit) => hit.kind),
		['introduced', 'present', 'removed'],
	);
});

test('empty query yields no hits', () => {
	const result = searchHistoryContents({
		query: '  ',
		orderedEntryIndexes: [0, 1],
		contentsByIndex: new Map([[0, 'x']]),
	});
	assert.equal(result.hits.length, 0);
	assert.equal(result.introducedAt, null);
});

test('searchHistoryDiffContents only hits revisions where the needle appears in the hunk', () => {
	const contentsByIndex = new Map<number, string>([
		[0, 'keep\n'],
		[1, 'keep\nneedle\n'],
		[2, 'keep\nneedle\n'],
		[3, 'keep\n'],
	]);
	const result = searchHistoryDiffContents({
		query: 'needle',
		orderedEntryIndexes: [0, 1, 2, 3],
		contentsByIndex,
	});
	assert.deepEqual(
		result.hits.map((hit) => hit.entryIndex),
		[1, 3],
	);
	assert.equal(result.purpose, 'sidebar');
});
