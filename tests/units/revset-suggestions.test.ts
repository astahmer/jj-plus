import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMON_REVSET_SUGGESTIONS } from '../../webview/src/domain/revset-suggestions.ts';
import {
	JJ_COMPARE_TARGET_SUGGESTIONS,
	JJ_TIMELINE_REVSET_SUGGESTIONS,
	mergeCompareQuickPickValues,
} from '../../src/shared/jj-revset-suggestions.ts';

test('COMMON_REVSET_SUGGESTIONS covers useful jj aliases and avoids fragile tags/heads', () => {
	const revsets = COMMON_REVSET_SUGGESTIONS.map((entry) => entry.revset);
	assert.ok(revsets.includes('bookmarks()'));
	assert.ok(revsets.includes('remote_bookmarks()'));
	assert.ok(revsets.includes('trunk()..closest_bookmark(@)'));
	assert.ok(revsets.includes('trunk()..closest_pushable(@)'));
	assert.ok(revsets.includes('slice()'));
	assert.ok(revsets.includes('mine()'));
	assert.equal(revsets.includes('tags()'), false);
	assert.equal(revsets.includes('heads(all())'), false);
	assert.ok(COMMON_REVSET_SUGGESTIONS.length >= 8);
	assert.equal(new Set(revsets).size, revsets.length);
	assert.deepEqual(COMMON_REVSET_SUGGESTIONS, JJ_TIMELINE_REVSET_SUGGESTIONS);
});

test('mergeCompareQuickPickValues seeds common targets then bookmarks', () => {
	const picks = mergeCompareQuickPickValues(['feature', 'trunk()', 'main']);
	assert.ok(picks.includes('@-'));
	assert.ok(picks.includes('closest_bookmark(@)'));
	assert.ok(picks.includes('closest_pushable(@)'));
	assert.ok(picks.includes('feature'));
	assert.ok(picks.includes('main'));
	assert.equal(picks.filter((value) => value === 'trunk()').length, 1);
	assert.ok(JJ_COMPARE_TARGET_SUGGESTIONS.every((entry) => picks.includes(entry.revset)));
});
