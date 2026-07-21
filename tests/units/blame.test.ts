import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildGitBlameArgs,
	findBlameForLine,
	parseGitBlamePorcelain,
	parseJjFileAnnotate,
	revisionMatchesBlame,
} from '../../src/shared/blame.ts';

test('parseGitBlamePorcelain maps porcelain hunks to final lines', () => {
	const stdout = [
		'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
		'author Ada',
		'summary first',
		'\tconst a = 1',
		'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 1',
		'author Bea',
		'summary second',
		'\tconst b = 2',
		'',
	].join('\n');
	const blame = parseGitBlamePorcelain(stdout);
	assert.equal(blame.length, 2);
	assert.deepEqual(findBlameForLine(blame, 2)?.revision.slice(0, 4), 'bbbb');
	assert.equal(findBlameForLine(blame, 2)?.author, 'Bea');
});

test('parseJjFileAnnotate keeps line order', () => {
	const blame = parseJjFileAnnotate('abc1234 path:1: hello\ndef5678 path:2: world\n');
	assert.equal(blame[0]?.line, 1);
	assert.equal(blame[1]?.revision, 'def5678');
});

test('revisionMatchesBlame tolerates short/long hashes', () => {
	assert.equal(revisionMatchesBlame('abcdef123456', 'abcdef1'), true);
	assert.equal(revisionMatchesBlame('deadbeef', 'cafe'), false);
});

test('buildGitBlameArgs pins a single line', () => {
	assert.deepEqual(buildGitBlameArgs({ relativePath: 'src/a.ts', line: 9 }), [
		'blame',
		'-L',
		'9,9',
		'--porcelain',
		'--',
		'src/a.ts',
	]);
});
