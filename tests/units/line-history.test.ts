import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildGitLineHistoryArgs,
	diffTouchesLineRange,
	filterEntriesTouchingLineRange,
	formatLineHistoryLabel,
	normalizeLineHistoryRange,
	parseGitLineHistoryRevisions,
} from '../../src/shared/line-history.ts';

test('normalizeLineHistoryRange clamps and orders inclusive 1-based lines', () => {
	assert.deepEqual(normalizeLineHistoryRange(5, 3), { startLine: 3, endLine: 5 });
	assert.deepEqual(normalizeLineHistoryRange(0, -2), { startLine: 1, endLine: 1 });
	assert.equal(normalizeLineHistoryRange(Number.NaN, 2), null);
});

test('formatLineHistoryLabel distinguishes single vs range', () => {
	assert.equal(formatLineHistoryLabel({ startLine: 4, endLine: 4 }), 'Line 4');
	assert.equal(formatLineHistoryLabel({ startLine: 2, endLine: 9 }), 'Lines 2–9');
});

test('formatStatusBarLineHistoryChip formats chip label', async () => {
	const { formatStatusBarLineHistoryChip } = await import('../../src/shared/line-history.ts');
	assert.equal(formatStatusBarLineHistoryChip({ startLine: 12, endLine: 12 }), 'JJ Timeline L12');
	assert.equal(formatStatusBarLineHistoryChip({ startLine: 12, endLine: 18 }), 'JJ Timeline L12–18');
});

test('diffTouchesLineRange detects edits inside the window and ignores distant edits', () => {
	const before = ['a', 'b', 'c', 'd', 'e'].join('\n');
	const afterNear = ['a', 'b', 'X', 'd', 'e'].join('\n');
	const afterFar = ['a', 'b', 'c', 'd', 'Z'].join('\n');

	assert.equal(
		diffTouchesLineRange({ beforeText: before, afterText: afterNear, range: { startLine: 3, endLine: 3 } }),
		true,
	);
	assert.equal(
		diffTouchesLineRange({ beforeText: before, afterText: afterFar, range: { startLine: 2, endLine: 3 } }),
		false,
	);
	assert.equal(
		diffTouchesLineRange({ beforeText: before, afterText: before, range: { startLine: 1, endLine: 5 } }),
		false,
	);
});

test('filterEntriesTouchingLineRange keeps only revisions that changed the window', () => {
	const entries = [
		{ revision: 'r1', text: 'one\ntwo\nthree' },
		{ revision: 'r2', text: 'one\nTWO\nthree' },
		{ revision: 'r3', text: 'one\nTWO\nthree\nfour' },
		{ revision: 'r4', text: 'one\nTWO\nthree\nfour', isWorkingTree: true },
	];

	const filtered = filterEntriesTouchingLineRange({
		entries,
		range: { startLine: 2, endLine: 2 },
		getContent: (entry) => entry.text,
	});

	assert.deepEqual(
		filtered.map((entry) => entry.revision),
		['r2', 'r4'],
	);
});

test('parseGitLineHistoryRevisions returns oldest-first hashes', () => {
	assert.deepEqual(parseGitLineHistoryRevisions('aaa1111\nbbb2222\nccc3333\n'), ['ccc3333', 'bbb2222', 'aaa1111']);
});

test('buildGitLineHistoryArgs uses -L and --follow', () => {
	assert.deepEqual(
		buildGitLineHistoryArgs({ relativePath: 'src/a.ts', range: { startLine: 10, endLine: 12 }, limit: 40 }),
		['log', '--follow', '-L10,12:src/a.ts', '--date=iso-strict', '--format=%H', '--max-count=40'],
	);
});
