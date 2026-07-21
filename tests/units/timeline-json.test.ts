import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTimelineJsonSummary, compactTimelineJsonEntry } from '../../src/cli/timeline-json.ts';

test('compactTimelineJsonEntry keeps flags only when set', () => {
	assert.deepEqual(
		compactTimelineJsonEntry({
			id: '1',
			revision: 'abcd',
			shortRevision: 'abcd',
			changeId: 'kqpp',
			authorDate: '2026-04-09T12:00:00Z',
			authorName: 'alex',
			description: 'hello',
			isWorkingTree: false,
			touchesFile: true,
			timestamp: 0,
			filePath: 'src/a.ts',
			isEmpty: true,
			hasConflict: true,
		}),
		{
			rev: 'abcd',
			changeId: 'kqpp',
			date: '2026-04-09T12:00:00Z',
			desc: 'hello',
			path: 'src/a.ts',
			flags: { empty: true, conflict: true },
		},
	);
});

test('buildTimelineJsonSummary drops working-tree tip', () => {
	const summary = buildTimelineJsonSummary({
		backend: 'jj',
		relativePath: 'src/a.ts',
		workspacePath: '/tmp/repo',
		entries: [
			{
				id: '1',
				revision: 'abcd',
				shortRevision: 'abcd',
				authorDate: '2026-04-09T12:00:00Z',
				authorName: 'alex',
				description: 'hello',
				isWorkingTree: false,
				touchesFile: true,
				timestamp: 0,
			},
			{
				id: '2',
				revision: 'WORKTREE',
				shortRevision: 'Current',
				authorDate: '2026-04-09T12:00:00Z',
				authorName: 'alex',
				description: 'Working tree',
				isWorkingTree: true,
				touchesFile: true,
				timestamp: 0,
			},
		],
	});
	assert.equal(summary.backend, 'jj');
	assert.equal(summary.path, 'src/a.ts');
	assert.equal(summary.entries.length, 1);
	assert.equal(summary.entries[0]?.rev, 'abcd');
});
