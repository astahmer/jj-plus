import assert from 'node:assert/strict';
import test from 'node:test';
import { listFileRevisionIds } from '../../src/shared/list-file-revisions.ts';
import { getRevisionDiffNavAvailability } from '../../src/shared/revision-diff-availability.ts';

test('listFileRevisionIds orders git commits oldest to newest', async () => {
	const ids = await listFileRevisionIds({
		runner: {
			runGit: async () => ({ stdout: 'ccc\nbbb\naaa\n' }),
			runJj: async () => ({ stdout: '' }),
		},
		workspacePath: '/tmp/repo',
		relativePath: 'a.ts',
		backend: 'git',
	});
	assert.deepEqual(ids, ['aaa', 'bbb', 'ccc']);
});

test('listFileRevisionIds appends @ tip for jj', async () => {
	const ids = await listFileRevisionIds({
		runner: {
			runGit: async () => ({ stdout: '' }),
			runJj: async () => ({ stdout: 'ccc\nbbb\naaa\n' }),
		},
		workspacePath: '/tmp/repo',
		relativePath: 'a.ts',
		backend: 'jj',
	});
	assert.deepEqual(ids, ['aaa', 'bbb', 'ccc', '@']);
});

test('getRevisionDiffNavAvailability disables prev at oldest pair and next at tip', () => {
	assert.deepEqual(getRevisionDiffNavAvailability(undefined), {
		active: false,
		hasPrevious: false,
		hasNext: false,
	});

	const two = {
		revisions: ['aaa', 'bbb'],
		tipIndex: 1,
	};
	assert.deepEqual(getRevisionDiffNavAvailability(two), {
		active: true,
		hasPrevious: false,
		hasNext: false,
	});

	const mid = { revisions: ['a', 'b', 'c', 'd'], tipIndex: 2 };
	assert.deepEqual(getRevisionDiffNavAvailability(mid), {
		active: true,
		hasPrevious: true,
		hasNext: true,
	});

	const tip = { ...mid, tipIndex: 3 };
	assert.deepEqual(getRevisionDiffNavAvailability(tip), {
		active: true,
		hasPrevious: true,
		hasNext: false,
	});
});
