import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRangeOverviewKey, buildPreviewKey } from '../../webview/src/domain/timeline-selection.ts';
import { buildTimelineSyncPlan } from '../../webview/src/domain/timeline-sync.ts';
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
		hasPreviousEntry: overrides.hasPreviousEntry ?? overrides.index > 0,
		monthLabel: overrides.monthLabel,
		shortDate: overrides.shortDate,
		relativeDate: overrides.relativeDate,
		index: overrides.index,
	};
}

function makeTimelineData(entries: FileRevisionEntry[], backend: TimelineData['backend'] = 'git'): TimelineData {
	return {
		backend,
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
		snapshotState: { loadedChangeIds: [] },
	};
}

test('buildTimelineSyncPlan normalizes the selection before requesting host data', () => {
	const visibleEntries = [2, 4, 9, 12].map((index) => makeEntry({ index }));
	const data = makeTimelineData(visibleEntries);

	assert.deepEqual(
		buildTimelineSyncPlan({
			ready: true,
			data,
			visibleEntries,
			filteredSidebarEntries: visibleEntries,
			fromIndex: 100,
			toIndex: 3,
			comparisonMode: 'range',
			comparisonSource: 'revision',
			activePreviewKey: buildPreviewKey(100, 3, 'revision'),
			previewByRange: {},
			activeRangeOverviewKey: buildRangeOverviewKey(100, 3, 'revision'),
			rangeOverviewByRange: {},
			rangeOverviewLoadingKey: '',
			selectedEntryIndexes: [],
			entryDiffCountByKey: {},
			entryDiffCountLoadingKey: '',
			pendingSnapshotRevisionIndexes: [],
			sidebarPreviewInFlightKey: '',
		}).normalizedSelection,
		{ fromIndex: 2, toIndex: 4 },
	);
});

test('buildTimelineSyncPlan requests missing preview, overview, and entry counts', () => {
	const visibleEntries = [0, 2, 4, 5].map((index) => makeEntry({ index }));
	const data = makeTimelineData(visibleEntries);
	const selectedEntryIndexes = [2, 4, 5];
	const plan = buildTimelineSyncPlan({
		ready: true,
		data,
		visibleEntries,
		filteredSidebarEntries: visibleEntries,
		fromIndex: 0,
		toIndex: 5,
		comparisonMode: 'range',
		comparisonSource: 'revision',
		activePreviewKey: buildPreviewKey(0, 5, 'revision'),
		previewByRange: {},
		activeRangeOverviewKey: buildRangeOverviewKey(0, 5, 'revision', selectedEntryIndexes),
		rangeOverviewByRange: {},
		rangeOverviewLoadingKey: '',
		selectedEntryIndexes,
		entryDiffCountByKey: { 'revision:2': 1 },
		entryDiffCountLoadingKey: '',
		pendingSnapshotRevisionIndexes: [],
		sidebarPreviewInFlightKey: '',
	});

	assert.deepEqual(plan.previewRequest, {
		fromIndex: 0,
		toIndex: 5,
		comparisonSource: 'revision',
	});
	assert.deepEqual(plan.rangeOverviewRequest, {
		fromIndex: 0,
		toIndex: 5,
		comparisonSource: 'revision',
		selectedEntryIndexes,
	});
	assert.deepEqual(plan.entryDiffCountsRequest, {
		entryIndexes: [4, 5],
		comparisonSource: 'revision',
	});
});

test('buildTimelineSyncPlan pauses background requests while snapshot hydration is pending', () => {
	const visibleEntries = [0, 1, 2].map((index) => makeEntry({ index, changeId: `c${index}` }));
	const data = makeTimelineData(visibleEntries, 'jj');
	const plan = buildTimelineSyncPlan({
		ready: true,
		data,
		visibleEntries,
		filteredSidebarEntries: visibleEntries,
		fromIndex: 1,
		toIndex: 2,
		comparisonMode: 'range',
		comparisonSource: 'snapshot',
		activePreviewKey: buildPreviewKey(1, 2, 'snapshot'),
		previewByRange: { [buildPreviewKey(1, 2, 'snapshot')]: {} as never },
		activeRangeOverviewKey: buildRangeOverviewKey(1, 2, 'snapshot', [2]),
		rangeOverviewByRange: {},
		rangeOverviewLoadingKey: '',
		selectedEntryIndexes: [2],
		entryDiffCountByKey: {},
		entryDiffCountLoadingKey: '',
		pendingSnapshotRevisionIndexes: [4, 5],
		sidebarPreviewInFlightKey: '',
	});

	assert.deepEqual(plan.snapshotHydrationRequest, { revisionIndexes: [4, 5] });
	assert.equal(plan.entryDiffCountsRequest, undefined);
	assert.equal(plan.sidebarPreviewRequest, undefined);
});

test('buildTimelineSyncPlan prefetches the nearest uncached sidebar preview', () => {
	const visibleEntries = [1, 2, 3, 4].map((index) => makeEntry({ index }));
	const data = makeTimelineData(visibleEntries);
	const activePreviewKey = buildPreviewKey(3, 4, 'revision');
	const plan = buildTimelineSyncPlan({
		ready: true,
		data,
		visibleEntries,
		filteredSidebarEntries: visibleEntries,
		fromIndex: 3,
		toIndex: 4,
		comparisonMode: 'range',
		comparisonSource: 'revision',
		activePreviewKey,
		previewByRange: { [activePreviewKey]: {} as never },
		activeRangeOverviewKey: buildRangeOverviewKey(3, 4, 'revision', [4]),
		rangeOverviewByRange: { [buildRangeOverviewKey(3, 4, 'revision', [4])]: [] },
		rangeOverviewLoadingKey: '',
		selectedEntryIndexes: [4],
		entryDiffCountByKey: { 'revision:2': 1, 'revision:3': 1, 'revision:4': 1 },
		entryDiffCountLoadingKey: '',
		pendingSnapshotRevisionIndexes: [],
		sidebarPreviewInFlightKey: '',
	});

	assert.deepEqual(plan.sidebarPreviewRequest, {
		key: buildPreviewKey(2, 3, 'revision'),
		fromIndex: 2,
		toIndex: 3,
		comparisonSource: 'revision',
	});
});
