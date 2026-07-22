import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldPreventOverlayPointerDefault } from '../../src/shared/overlay-pointer-guard.ts';

test('shouldPreventOverlayPointerDefault allows typing in inputs', () => {
	assert.equal(shouldPreventOverlayPointerDefault(null), true);
	assert.equal(shouldPreventOverlayPointerDefault({ closest: () => null }), true);
	assert.equal(shouldPreventOverlayPointerDefault({ closest: () => ({}) }), false);
});

test('shouldPreventOverlayPointerDefault queries interactive selectors', () => {
	const seen: string[] = [];
	shouldPreventOverlayPointerDefault({
		closest: (selectors) => {
			seen.push(selectors);
			return null;
		},
	});
	assert.deepEqual(seen, ['input, textarea, select, [contenteditable="true"]']);
});

test('shouldPreventOverlayPointerDefault blocks preventDefault for history search input', () => {
	assert.equal(
		shouldPreventOverlayPointerDefault({
			closest: (selectors) => (selectors.includes('input') ? { id: 'historySearchInput' } : null),
		}),
		false,
	);
});
