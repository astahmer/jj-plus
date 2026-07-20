import assert from 'node:assert/strict';
import test from 'node:test';
import { createConcurrencyLimiter } from '../../src/extension/command-runner.ts';

test('createConcurrencyLimiter caps concurrent tasks', async () => {
	const runLimited = createConcurrencyLimiter(2);
	let active = 0;
	let peak = 0;

	const tasks = Array.from({ length: 8 }, async (_, index) =>
		runLimited(async () => {
			active += 1;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, 20));
			active -= 1;
			return index;
		}),
	);

	const results = await Promise.all(tasks);
	assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7]);
	assert.equal(peak, 2);
});
