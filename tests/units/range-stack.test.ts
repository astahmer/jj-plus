import assert from 'node:assert/strict';
import test from 'node:test';

import { pickRangeStackPaths, rangeStackPreviewKey } from '../../src/shared/range-stack.ts';

test('pickRangeStackPaths prefers current file then churn', () => {
	const paths = pickRangeStackPaths(
		[
			{ relativePath: 'b.ts', changeCount: 9 },
			{ relativePath: 'a.ts', changeCount: 2, isCurrentFile: true },
			{ relativePath: 'c.ts', changeCount: 4 },
		],
		'a.ts',
		2,
	);
	assert.deepEqual(paths, ['a.ts', 'b.ts']);
});

test('rangeStackPreviewKey normalizes from/to order', () => {
	assert.equal(rangeStackPreviewKey('x.ts', 3, 1), 'x.ts:1:3');
});
