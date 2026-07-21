import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildGitBlameArgs,
	buildGitBlameFileArgs,
	buildJjAnnotateArgs,
	collapseBlameToHunkStarts,
	findBlameForLine,
	findEntryIndexForBlameRevision,
	formatBlameAuthorDate,
	formatBlameGutterLabel,
	formatBlameHoverTooltip,
	parseGitBlamePorcelain,
	parseJjFileAnnotate,
	revisionMatchesBlame,
	shortBlameRevision,
} from '../../src/shared/blame.ts';

test('parseGitBlamePorcelain maps porcelain hunks to final lines with author dates', () => {
	const stdout = [
		'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
		'author Ada Lovelace',
		'author-time 1700000000',
		'summary first',
		'\tconst a = 1',
		'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 1',
		'author Bea',
		'author-time 1700003600',
		'summary second',
		'\tconst b = 2',
		'',
	].join('\n');
	const blame = parseGitBlamePorcelain(stdout);
	assert.equal(blame.length, 2);
	assert.deepEqual(findBlameForLine(blame, 2)?.revision.slice(0, 4), 'bbbb');
	assert.equal(findBlameForLine(blame, 2)?.author, 'Bea');
	assert.equal(findBlameForLine(blame, 1)?.authorTimestamp, 1700000000);
	assert.ok(findBlameForLine(blame, 1)?.authorDate);
});

test('parseJjFileAnnotate keeps line order and templated author fields', () => {
	const legacy = parseJjFileAnnotate('abc1234 path:1: hello\ndef5678 path:2: world\n');
	assert.equal(legacy[0]?.line, 1);
	assert.equal(legacy[1]?.revision, 'def5678');

	const templated = parseJjFileAnnotate('abc1234\tAda\t1700000000\thello\ndef5678\tBea\t1700003600\tworld\n');
	assert.equal(templated[0]?.author, 'Ada');
	assert.equal(templated[1]?.authorTimestamp, 1700003600);
	assert.equal(formatBlameGutterLabel(templated[0]!), `Ada, ${templated[0]!.authorDate}`);
	assert.match(formatBlameHoverTooltip(templated[0]!), /Author: Ada/);
});

test('parseJjFileAnnotate accepts ISO jj timestamps', () => {
	const lines = parseJjFileAnnotate(
		'abc1234\tAda\t2026-04-08 15:39:22.000 +02:00\tinit\ndef5678\tBea\t2026-04-08 17:52:07.000 +02:00\trename\n',
	);
	assert.equal(lines[0]?.author, 'Ada');
	assert.ok(typeof lines[0]?.authorTimestamp === 'number');
	assert.equal(lines[0]?.summary, 'init');
	assert.ok((lines[1]?.authorTimestamp ?? 0) > (lines[0]?.authorTimestamp ?? 0));
});

test('buildJjAnnotateArgs uses AnnotationLine commit.* template', () => {
	const jjArgs = buildJjAnnotateArgs({ relativePath: 'a.ts', revision: 'xyz' });
	const template = jjArgs[jjArgs.indexOf('-T') + 1];
	assert.match(template, /commit\.commit_id\(\)/);
	assert.match(template, /timestamp\(\)\.format\("%s"\)/);
	assert.equal(template.includes('commit_id.short()'), false);
});

test('formatBlameAuthorDate uses relative buckets', () => {
	const now = 1_700_003_600_000;
	assert.equal(formatBlameAuthorDate(1_700_003_590, now), 'just now');
	assert.equal(formatBlameAuthorDate(1_700_000_000, now), '1h ago');
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

test('buildGitBlameFileArgs and jj annotate accept revision pin with template', () => {
	assert.deepEqual(buildGitBlameFileArgs({ relativePath: 'a.ts', revision: 'abc' }), [
		'blame',
		'--porcelain',
		'abc',
		'--',
		'a.ts',
	]);
	const jjArgs = buildJjAnnotateArgs({ relativePath: 'a.ts', revision: 'xyz' });
	assert.equal(jjArgs[0], 'file');
	assert.equal(jjArgs[1], 'annotate');
	assert.ok(jjArgs.includes('-T'));
	assert.ok(jjArgs.includes('-r'));
	assert.ok(jjArgs.includes('xyz'));
});

test('collapseBlameToHunkStarts keeps revision boundaries', () => {
	const starts = collapseBlameToHunkStarts([
		{ line: 1, revision: 'aaa' },
		{ line: 2, revision: 'aaa' },
		{ line: 3, revision: 'bbb' },
		{ line: 4, revision: 'bbb' },
		{ line: 5, revision: 'ccc' },
	]);
	assert.deepEqual(
		starts.map((entry) => entry.line),
		[1, 3, 5],
	);
	assert.equal(shortBlameRevision('abcdef12'), 'abcdef1');
});

test('findEntryIndexForBlameRevision matches short hashes', () => {
	assert.equal(
		findEntryIndexForBlameRevision(
			[{ revision: 'abcdef123456' }, { revision: 'deadbeef', isWorkingTree: true }],
			'abcdef1',
		),
		0,
	);
});
