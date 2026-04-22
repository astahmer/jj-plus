import assert from 'node:assert/strict';
import test from 'node:test';

import {
	adjustRangeBoundary,
	buildPreviewKey,
	canNavigateSelection,
	dockRangeSelection,
	filterEntries,
	getDefaultSelection,
	normalizeSelection,
	shiftRangeSelection,
	shiftStepSelection,
} from '../../webview/src/timeline-selection.ts';
import type { FileRevisionEntry, TimelineData } from '../../webview/src/types.ts';

function makeEntry(overrides: Partial<FileRevisionEntry> & Pick<FileRevisionEntry, 'index'>): FileRevisionEntry {
	return {
		id: overrides.id || `entry-${overrides.index}`,
		revision: overrides.revision || `rev-${overrides.index}`,
		shortRevision: overrides.shortRevision || `r${overrides.index}`,
		changeId: overrides.changeId,
		authorDate: overrides.authorDate || '2026-04-10T16:07:57+02:00',
		authorName: overrides.authorName || 'Alex',
		description: overrides.description || `entry ${overrides.index}`,
		isWorkingTree: overrides.isWorkingTree === true,
		touchesFile: overrides.touchesFile !== false,
		timestamp: overrides.timestamp ?? overrides.index,
		filePath: overrides.filePath,
		operationId: overrides.operationId,
		operationIndex: overrides.operationIndex,
		operationKey: overrides.operationKey,
		remoteUrl: overrides.remoteUrl,
		hasPreviousEntry: overrides.hasPreviousEntry,
		monthLabel: overrides.monthLabel,
		shortDate: overrides.shortDate,
		relativeDate: overrides.relativeDate,
		index: overrides.index,
	};
}

function makeTimelineData(entries: FileRevisionEntry[]): TimelineData {
	return {
		backend: 'git',
		workspacePath: '/tmp/repo',
		relativePath: 'src/example.ts',
		fileName: 'example.ts',
		version: '0.0.0-test',
		presets: { year: 365, '7d': 7, '30d': 30, '90d': 90, all: Number.POSITIVE_INFINITY },
		defaultIndex: entries.at(-1)?.index || 0,
		latestIndex: entries.at(-1)?.index || 0,
		preferences: {},
		workspaceFiles: ['src/example.ts'],
		hasIntermediateRevisions: entries.some((entry) => !entry.touchesFile),
		entries,
		snapshotEntries: [],
		snapshotState: undefined,
	};
}

test('filterEntries keeps the full file history regardless of preset window', () => {
	const entries = [
		makeEntry({ index: 1, timestamp: 1, touchesFile: true }),
		makeEntry({ index: 2, timestamp: 2, touchesFile: true }),
		makeEntry({ index: 3, timestamp: 20, touchesFile: false }),
		makeEntry({ index: 4, timestamp: 25, touchesFile: true }),
		makeEntry({ index: 5, timestamp: 30, touchesFile: true }),
	];
	const data = makeTimelineData(entries);

	assert.deepEqual(
		filterEntries(entries, data, '7d', false).map((entry) => entry.index),
		[1, 2, 4, 5],
	);
	assert.deepEqual(
		filterEntries(entries, data, '7d', true).map((entry) => entry.index),
		[1, 2, 3, 4, 5],
	);
});

test('getDefaultSelection keeps the latest adjacent pair when enough entries are visible', () => {
	assert.deepEqual(getDefaultSelection([makeEntry({ index: 2 }), makeEntry({ index: 4 }), makeEntry({ index: 9 })]), {
		fromIndex: 4,
		toIndex: 9,
	});
	assert.deepEqual(getDefaultSelection([makeEntry({ index: 7 })]), { fromIndex: 7, toIndex: 7 });
});

test('buildPreviewKey normalizes range order', () => {
	assert.equal(buildPreviewKey(9, 4, 'revision'), 'revision:4:9');
});

test('normalizeSelection snaps invalid values back onto a legal visible range', () => {
	const entries = [makeEntry({ index: 2 }), makeEntry({ index: 4 }), makeEntry({ index: 9 }), makeEntry({ index: 12 })];
	assert.deepEqual(normalizeSelection(entries, 100, 3, 'range'), [2, 4]);
	assert.deepEqual(normalizeSelection(entries, 100, 999, 'range'), [9, 12]);
	assert.deepEqual(normalizeSelection(entries, 2, 9, 'step'), [4, 9]);
});

test('shiftStepSelection and shiftRangeSelection clamp at the visible bounds', () => {
	const entries = [makeEntry({ index: 2 }), makeEntry({ index: 4 }), makeEntry({ index: 9 }), makeEntry({ index: 12 })];
	assert.deepEqual(shiftStepSelection(entries, 4, -3), [2, 4]);
	assert.deepEqual(shiftStepSelection(entries, 9, 2), [9, 12]);
	assert.deepEqual(shiftRangeSelection(entries, 2, 9, 5), [4, 12]);
	assert.deepEqual(shiftRangeSelection(entries, 4, 12, -5), [2, 9]);
});

test('adjustRangeBoundary and dockRangeSelection preserve a minimum range width', () => {
	const entries = [makeEntry({ index: 2 }), makeEntry({ index: 4 }), makeEntry({ index: 9 }), makeEntry({ index: 12 })];
	assert.deepEqual(adjustRangeBoundary(entries, 4, 12, 'from', 10), [9, 12]);
	assert.deepEqual(adjustRangeBoundary(entries, 4, 9, 'to', -10), [4, 9]);
	assert.deepEqual(dockRangeSelection(entries, 4, 9, 'start'), [2, 4]);
	assert.deepEqual(dockRangeSelection(entries, 4, 9, 'end'), [9, 12]);
});

test('canNavigateSelection reflects the current comparison mode', () => {
	const entries = [makeEntry({ index: 2 }), makeEntry({ index: 4 }), makeEntry({ index: 9 }), makeEntry({ index: 12 })];
	assert.equal(canNavigateSelection(entries, 2, 4, 'step', -1), false);
	assert.equal(canNavigateSelection(entries, 4, 9, 'step', 1), true);
	assert.equal(canNavigateSelection(entries, 2, 9, 'range', -1), false);
	assert.equal(canNavigateSelection(entries, 4, 9, 'range', 1), true);
});
