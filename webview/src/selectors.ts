import type { Model } from './model.ts';
import { filterEntries, buildPreviewKey, buildRangeOverviewKey } from './domain/timeline-selection.ts';
import { filterEntriesBySidebarSearch } from '../../src/shared/sidebar-search.ts';
import {
	getEntriesForSource,
	getPendingSelectionRange,
	getPendingSnapshotRevisionIndexes,
	getRangeOverviewDiffCount,
	getSelectedDiffEntryIndexes,
	getSelectedEntryCount,
	getUnitPreviewRange,
	getIntermediateToggleLabel,
} from './domain/timeline-model.ts';
import { buildFilePathTrail, formatFilePathTrail, pathTrailChanged } from '../../src/shared/path-trail.ts';
import type {
	ComparisonSource,
	DiffPreview,
	FileRevisionEntry,
	HistoryBackend,
	RangeOverviewItem,
	TimelineData,
} from './types.ts';

export function getData(model: Model): TimelineData | null {
	return (model.data ?? null) as TimelineData | null;
}

export function getBackend(model: Model): HistoryBackend | null {
	return getData(model)?.backend ?? null;
}

export function getEffectiveComparisonSource(model: Model): ComparisonSource {
	const data = getData(model);
	if (data?.backend !== 'jj') {
		return 'revision';
	}
	return model.comparisonSource === 'snapshot' ? 'snapshot' : 'revision';
}

export function getRevisionEntries(model: Model): Array<FileRevisionEntry> {
	return getEntriesForSource(getData(model), 'revision');
}

export function getRevisionVisibleEntries(model: Model): Array<FileRevisionEntry> {
	return filterEntries(getRevisionEntries(model), getData(model), model.preset, model.showIntermediateRevisions);
}

export function getSourceEntries(model: Model): Array<FileRevisionEntry> {
	return getEntriesForSource(getData(model), getEffectiveComparisonSource(model));
}

export function getVisibleEntries(model: Model): Array<FileRevisionEntry> {
	return filterEntries(getSourceEntries(model), getData(model), model.preset, model.showIntermediateRevisions);
}

export function getPresetEntries(model: Model): Array<FileRevisionEntry> {
	return filterEntries(getSourceEntries(model), getData(model), model.preset, true);
}

export function getFilteredSidebarEntries(model: Model): Array<FileRevisionEntry> {
	const visible = getVisibleEntries(model);
	const filtered = filterEntriesBySidebarSearch(visible, model.sidebarSearchQuery);
	return model.oldestFirst ? filtered : filtered.toReversed();
}

export function getCurrentFromEntry(model: Model): FileRevisionEntry | undefined {
	return getSourceEntries(model).find((entry) => entry.index === model.fromIndex);
}

export function getCurrentToEntry(model: Model): FileRevisionEntry | undefined {
	return getSourceEntries(model).find((entry) => entry.index === model.toIndex);
}

export function getPendingSelectionIndex(model: Model): number | null {
	if (model.selection._tag === 'PendingAnchor') {
		return model.selection.entryIndex;
	}
	return null;
}

export function getRangeLabel(model: Model): string {
	const visible = getVisibleEntries(model);
	const fromEntry = visible.find((entry) => entry.index === model.fromIndex);
	const toEntry = visible.find((entry) => entry.index === model.toIndex);
	const data = getData(model);
	if (!fromEntry || !toEntry || !data) {
		return 'Loading revisions...';
	}
	return `${fromEntry.shortDate || 'Today'} - ${toEntry.shortDate || 'Today'} · ${data.backend.toUpperCase()}`;
}

export function getRangeSubtitle(model: Model): string {
	const visible = getVisibleEntries(model);
	const selectedCount = getSelectedEntryCount(visible, model.fromIndex, model.toIndex);
	const label = getEffectiveComparisonSource(model) === 'snapshot' ? 'snapshots' : 'revisions';
	return `${selectedCount}/${visible.length} ${label}`;
}

export function getFilePathTrailLabel(model: Model): string {
	const data = getData(model);
	if (!data) {
		return '';
	}
	const steps = buildFilePathTrail(data.entries, data.relativePath);
	if (!pathTrailChanged(steps)) {
		return '';
	}
	return formatFilePathTrail(steps);
}

export function getEvologStripEntries(model: Model): Array<FileRevisionEntry> {
	const data = getData(model);
	if (!data || data.backend !== 'jj') {
		return [];
	}
	const tip = getEntriesForSource(data, getEffectiveComparisonSource(model))[model.toIndex];
	if (!tip?.changeId) {
		return [];
	}
	const snapshotSource = getEntriesForSource(data, 'snapshot');
	return snapshotSource.filter((entry) => entry.changeId === tip.changeId);
}

export function getIntermediateLabel(model: Model): string {
	return getIntermediateToggleLabel(
		getVisibleEntries(model).length,
		getPresetEntries(model).length,
		model.showIntermediateRevisions,
	);
}

export function getSelectionMeta(model: Model): string {
	const pending = getPendingSelectionIndex(model);
	if (pending === null) {
		return 'Click an anchor or a sidebar entry to change the preview.';
	}

	const hovered = model.maybeHoveredSelectionIndex._tag === 'Some' ? model.maybeHoveredSelectionIndex.value : null;
	const range = getPendingSelectionRange(getVisibleEntries(model), pending, hovered);
	if (!range) {
		return 'Pick another revision to complete the range.';
	}
	return `Selecting ${range.selectedCount} revisions…`;
}

export function getStepStatus(model: Model): string {
	if (model.comparisonMode !== 'step') {
		return '';
	}

	const visible = getVisibleEntries(model);
	const current = Math.max(
		1,
		visible.findIndex((entry) => entry.index === model.toIndex),
	);
	const suffix = getEffectiveComparisonSource(model) === 'snapshot' ? 'snapshots' : 'diffs';
	return `${current}/${Math.max(1, visible.length - 1)} ${suffix}`;
}

export function getPendingSnapshotRevisionIndexesSelector(model: Model): Array<number> {
	const data = getData(model);
	if (!data || data.backend !== 'jj' || getEffectiveComparisonSource(model) !== 'snapshot') {
		return [];
	}
	const loaded = new Set(data.snapshotState?.loadedChangeIds || []);
	return getPendingSnapshotRevisionIndexes(getRevisionVisibleEntries(model), loaded, 8, [
		model.fromIndex,
		model.toIndex,
	]);
}

export function getShowSnapshotStatus(model: Model): boolean {
	return (
		getData(model)?.backend === 'jj' &&
		getEffectiveComparisonSource(model) === 'snapshot' &&
		getPendingSnapshotRevisionIndexesSelector(model).length > 0
	);
}

export function getSnapshotStatusLabel(model: Model): string {
	return getPendingSnapshotRevisionIndexesSelector(model).length ? 'Loading snapshots…' : '';
}

export function getActivePreviewKey(model: Model): string {
	return buildPreviewKey(model.fromIndex, model.toIndex, getEffectiveComparisonSource(model));
}

export function getSelectedDiffEntryIndexesSelector(model: Model): Array<number> {
	return getSelectedDiffEntryIndexes(getVisibleEntries(model), model.fromIndex, model.toIndex, model.comparisonMode);
}

export function getActiveRangeOverviewKey(model: Model): string {
	return buildRangeOverviewKey(
		model.fromIndex,
		model.toIndex,
		getEffectiveComparisonSource(model),
		getSelectedDiffEntryIndexesSelector(model),
	);
}

export function getActiveRangeOverviewItems(model: Model): Array<RangeOverviewItem> {
	return (model.rangeOverviewByRange[getActiveRangeOverviewKey(model)] as Array<RangeOverviewItem> | undefined) || [];
}

export function getRangeStackItems(model: Model): Array<{ relativePath: string; preview: DiffPreview }> {
	return Object.entries(model.rangeStackByPath as Record<string, DiffPreview>).map(([relativePath, preview]) => ({
		relativePath,
		preview,
	}));
}

export function getRangeOverviewLoading(model: Model): boolean {
	return model.rangeOverviewLoadingKey === getActiveRangeOverviewKey(model);
}

export function getSelectionDiffCount(model: Model): number | null {
	if (getRangeOverviewLoading(model)) {
		return null;
	}
	return getRangeOverviewDiffCount(getActiveRangeOverviewItems(model));
}

export function getPreview(model: Model): DiffPreview | null {
	return (model.previewByRange[getActivePreviewKey(model)] as DiffPreview | undefined) || null;
}

export function getPreviewForEntry(model: Model, entryIndex: number): DiffPreview | null {
	const range = getUnitPreviewRange(getVisibleEntries(model), entryIndex);
	if (!range) {
		return null;
	}
	const key = buildPreviewKey(range.fromIndex, range.toIndex, getEffectiveComparisonSource(model));
	return (model.previewByRange[key] as DiffPreview | undefined) || null;
}

export function getVersion(model: Model): string {
	const data = getData(model);
	return data?.version ? `v${data.version}` : '';
}

export function getEntryDiffCount(model: Model, entryIndex: number): number | null {
	const key = `${getEffectiveComparisonSource(model)}:${entryIndex}`;
	const value = (model.entryDiffCountByKey as Record<string, number>)[key];
	return value === undefined ? null : value;
}
