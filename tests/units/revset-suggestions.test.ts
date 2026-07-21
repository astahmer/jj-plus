import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMON_REVSET_SUGGESTIONS } from '../../webview/src/domain/revset-suggestions.ts';

test('COMMON_REVSET_SUGGESTIONS covers bookmarks and useful jj filters', () => {
	const revsets = COMMON_REVSET_SUGGESTIONS.map((entry) => entry.revset);
	assert.ok(revsets.includes('bookmarks()'));
	assert.ok(revsets.includes('remote_bookmarks()'));
	assert.ok(revsets.includes('conflicts()'));
	assert.ok(revsets.includes('mutable()'));
	assert.ok(COMMON_REVSET_SUGGESTIONS.length >= 8);
	assert.equal(new Set(revsets).size, revsets.length);
});
