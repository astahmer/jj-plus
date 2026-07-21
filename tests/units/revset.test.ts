import assert from 'node:assert/strict';
import test from 'node:test';

import { composeJjHistoryRevset, isCustomRevsetActive, normalizeCustomRevset } from '../../src/shared/revset.ts';

test('normalizeCustomRevset trims and treats blank as empty', () => {
	assert.equal(normalizeCustomRevset('  bookmarks()  '), 'bookmarks()');
	assert.equal(normalizeCustomRevset('   '), '');
	assert.equal(isCustomRevsetActive(''), false);
	assert.equal(isCustomRevsetActive('all()'), true);
});

test('composeJjHistoryRevset intersects custom with default', () => {
	assert.equal(composeJjHistoryRevset({ defaultRevset: 'ancestors(@)' }), 'ancestors(@)');
	assert.equal(
		composeJjHistoryRevset({ defaultRevset: 'ancestors(@)', customRevset: 'bookmarks()' }),
		'(bookmarks()) & (ancestors(@))',
	);
});
