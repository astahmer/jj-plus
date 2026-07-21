import assert from 'node:assert/strict';
import test from 'node:test';

import { searchHistoryContents } from '../../src/shared/history-search.ts';

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
