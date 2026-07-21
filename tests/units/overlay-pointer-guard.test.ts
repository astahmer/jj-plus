import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldPreventOverlayPointerDefault } from '../../src/shared/overlay-pointer-guard.ts';

test('shouldPreventOverlayPointerDefault allows typing in inputs', () => {
	assert.equal(shouldPreventOverlayPointerDefault(null), true);
	assert.equal(shouldPreventOverlayPointerDefault({ closest: () => null }), true);
	assert.equal(shouldPreventOverlayPointerDefault({ closest: () => ({}) }), false);
});
