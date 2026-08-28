import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileRevisionEntry } from '../../src/shared/timeline-types.ts';

function entry(overrides: Partial<FileRevisionEntry> = {}): FileRevisionEntry {
	return {
		id: 'revision',
		revision: 'revision',
		shortRevision: 'revisio',
		authorDate: '2026-08-28T12:00:00Z',
		authorName: 'Alex',
		description: 'Update repository timeline',
		isWorkingTree: false,
		touchesFile: false,
		timestamp: 1_724_851_200,
		...overrides,
	};
}

test('repository history entries retain repository-level semantics', () => {
	const revision = entry({ bookmarkNames: ['main'], branchNames: ['feature/search'] });
	assert.equal(revision.touchesFile, false);
	assert.deepEqual(revision.bookmarkNames, ['main']);
	assert.deepEqual(revision.branchNames, ['feature/search']);
});

test('revision diff output can identify changed file headers', () => {
	const patch = ['diff --git a/src/old.ts b/src/new.ts', '--- a/src/old.ts', '+++ b/src/new.ts'].join('\n');
	const files = [...patch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gmu)].map((match) => match[2]);
	assert.deepEqual(files, ['src/new.ts']);
});
