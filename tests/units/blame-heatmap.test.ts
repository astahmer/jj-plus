import assert from 'node:assert/strict';
import test from 'node:test';
import { computeBlameHeatLevels } from '../../src/shared/blame-heatmap.ts';

test('computeBlameHeatLevels maps oldest to 0 and newest to 4', () => {
	const heat = computeBlameHeatLevels(
		[
			{ line: 1, authorTimestamp: 100 },
			{ line: 2, authorTimestamp: 200 },
			{ line: 3, authorTimestamp: 300 },
			{ line: 4 },
		],
		300_000,
	);
	assert.equal(heat.get(1), 0);
	assert.equal(heat.get(3), 4);
	assert.equal(heat.get(4), 0);
	assert.ok((heat.get(2) ?? 0) > 0 && (heat.get(2) ?? 0) < 4);
});
