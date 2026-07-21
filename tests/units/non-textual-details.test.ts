import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNonTextualDetails } from '../../src/shared/non-textual-details.ts';

test('buildNonTextualDetails reports path changes', () => {
	assert.deepEqual(
		buildNonTextualDetails({
			beforeText: 'same',
			afterText: 'same',
			beforePath: 'old.ts',
			afterPath: 'new.ts',
		}),
		['Path changed: old.ts -> new.ts'],
	);
});

test('buildNonTextualDetails reports line endings and whitespace-only', () => {
	assert.ok(
		buildNonTextualDetails({
			beforeText: 'a\r\nb\r\n',
			afterText: 'a\nb\n',
			beforePath: 'a.ts',
			afterPath: 'a.ts',
		}).includes('Line endings changed.'),
	);
	assert.ok(
		buildNonTextualDetails({
			beforeText: 'a b',
			afterText: 'a  b',
			beforePath: 'a.ts',
			afterPath: 'a.ts',
		}).includes('Whitespace-only changes.'),
	);
});

test('buildNonTextualDetails reports empty sides, binary, and mode', () => {
	assert.ok(
		buildNonTextualDetails({
			beforeText: '',
			afterText: '',
			beforePath: 'a.ts',
			afterPath: 'a.ts',
		}).some((line) => line.includes('Both sides are empty')),
	);
	assert.ok(
		buildNonTextualDetails({
			beforeText: 'x\u0000y',
			afterText: 'x\u0000z',
			beforePath: 'a.bin',
			afterPath: 'a.bin',
		}).some((line) => line.includes('Binary')),
	);
	assert.ok(
		buildNonTextualDetails({
			beforeText: 'same',
			afterText: 'same',
			beforePath: 'a.ts',
			afterPath: 'a.ts',
			beforeMode: '100644',
			afterMode: '100755',
		}).includes('File mode changed: 100644 -> 100755'),
	);
});

test('buildNonTextualDetails always returns a fallback reason', () => {
	const details = buildNonTextualDetails({
		beforeText: 'same',
		afterText: 'same',
		beforePath: 'a.ts',
		afterPath: 'a.ts',
	});
	assert.equal(details.length, 1);
	assert.match(details[0]!, /metadata|non-text/i);
});
