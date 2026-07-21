import assert from 'node:assert/strict';
import test from 'node:test';
import { listFileRevisionIds } from '../../src/shared/list-file-revisions.ts';

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
