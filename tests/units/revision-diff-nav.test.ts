import assert from 'node:assert/strict';
import test from 'node:test';
import { listFileRevisionIds } from '../../src/shared/list-file-revisions.ts';
import { getRevisionDiffNavAvailability } from '../../src/shared/revision-diff-availability.ts';
import { resolveNextNonEmptyRevisionPair, resolveNonEmptyRevisionPair } from '../../src/shared/revision-diff-pair.ts';

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

	assert.deepEqual(
		getRevisionDiffNavAvailability({
			revisions: ['a', 'b', 'c'],
			tipIndex: 1,
			previousTipIndex: null,
			nextTipIndex: null,
		}),
		{ active: true, hasPrevious: false, hasNext: false },
	);
});

test('resolveNextNonEmptyRevisionPair skips empty pairs ahead of the current diff', async () => {
	const files = new Map<string, string>([
		['aaa', 'v1'],
		['bbb', 'v2'],
		['ccc', 'v2'],
		['ddd', 'v3'],
	]);
	const pair = await resolveNextNonEmptyRevisionPair({
		revisions: ['aaa', 'bbb', 'ccc', 'ddd'],
		tipIndex: 2,
		showFile: async (revision) => files.get(revision) ?? '',
	});
	assert.ok(pair);
	assert.equal(pair.tipIndex, 3);
	assert.equal(pair.base, 'ccc');
	assert.equal(pair.tip, 'ddd');
});

test('resolveNonEmptyRevisionPair skips empty pairs behind the current diff', async () => {
	const files = new Map<string, string>([
		['aaa', 'v1'],
		['bbb', 'v2'],
		['ccc', 'v2'],
		['ddd', 'v3'],
	]);
	const pair = await resolveNonEmptyRevisionPair({
		revisions: ['aaa', 'bbb', 'ccc', 'ddd'],
		tipIndex: 2,
		showFile: async (revision) => files.get(revision) ?? '',
	});
	assert.ok(pair);
	assert.equal(pair.tipIndex, 1);
	assert.equal(pair.base, 'aaa');
	assert.equal(pair.tip, 'bbb');
});
