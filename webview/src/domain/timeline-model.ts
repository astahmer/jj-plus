import type {
	ComparisonMode,
	ComparisonSource,
	DiffPreview,
	FileRevisionEntry,
	RangeOverviewItem,
	TimelineData,
} from '../types.ts';

export function getEntriesForSource(
	data: TimelineData | null,
	comparisonSource: ComparisonSource,
): Array<FileRevisionEntry> {
	if (!data) {
		return [];
	}

	if (data.backend === 'jj' && comparisonSource === 'snapshot') {
		const revisionEntries = Array.isArray(data.entries) ? data.entries : [];
		const snapshotEntries = Array.isArray(data.snapshotEntries) ? data.snapshotEntries : [];
		const loadedChangeIds = new Set(
			Array.isArray(data.snapshotState?.loadedChangeIds) ? data.snapshotState.loadedChangeIds : [],
		);

		if (!loadedChangeIds.size) {
			return revisionEntries;
		}

		const snapshotEntriesByChangeId = snapshotEntries.reduce((groups, entry) => {
			if (!entry.changeId) {
				return groups;
			}
			const existing = groups.get(entry.changeId) || [];
			existing.push(entry);
			groups.set(entry.changeId, existing);
			return groups;
		}, new Map<string, Array<FileRevisionEntry>>());

		return revisionEntries
			.flatMap((entry) => {
				if (!entry.changeId || entry.isWorkingTree || !entry.touchesFile || !loadedChangeIds.has(entry.changeId)) {
					return [entry];
				}
				return snapshotEntriesByChangeId.get(entry.changeId) || [entry];
			})
			.map((entry, index) => ({ ...entry, index }));
	}

	return Array.isArray(data.entries) ? data.entries : [];
}

export function getSelectedEntryCount(
	visibleEntries: Array<FileRevisionEntry>,
	fromIndex: number,
	toIndex: number,
): number {
	const minIndex = Math.min(fromIndex, toIndex);
	const maxIndex = Math.max(fromIndex, toIndex);
	return visibleEntries.filter((entry) => entry.index >= minIndex && entry.index <= maxIndex).length;
}

export function findRevisionEntryMatch(
	entries: Array<FileRevisionEntry>,
	value: string,
): FileRevisionEntry | undefined {
	const query = value.trim().toLowerCase();
	if (!query) {
		return undefined;
	}

	return (
		entries.find((entry) => entry.shortRevision.toLowerCase() === query) ||
		entries.find((entry) => entry.revision.toLowerCase().startsWith(query))
	);
}

export function getSelectedDiffEntryIndexes(
	visibleEntries: Array<FileRevisionEntry>,
	fromIndex: number,
	toIndex: number,
	comparisonMode: ComparisonMode,
): Array<number> {
	if (!visibleEntries.length) {
		return [];
	}

	if (comparisonMode === 'step') {
		return visibleEntries.some((entry) => entry.index === toIndex) ? [toIndex] : [];
	}

	const minIndex = Math.min(fromIndex, toIndex);
	const maxIndex = Math.max(fromIndex, toIndex);
	return visibleEntries
		.filter((entry) => entry.index >= minIndex && entry.index <= maxIndex)
		.slice(1)
		.map((entry) => entry.index);
}

export function getRangeOverviewDiffCount(items: Array<RangeOverviewItem>): number {
	return items.reduce((total, item) => total + item.changeCount, 0);
}

export function getTimelineAnchorPercent(visibleEntries: Array<FileRevisionEntry>, visibleIndex: number): number {
	if (!visibleEntries.length) {
		return 0;
	}

	const denominator = Math.max(1, visibleEntries.length - 1);
	return (Math.min(Math.max(visibleIndex, 0), visibleEntries.length - 1) / denominator) * 100;
}

export function getVisibleIndexFromClientX(entries: Array<FileRevisionEntry>, clientX: number): number {
	const track = document.getElementById('track');
	const trackRect = track?.getBoundingClientRect();
	if (!trackRect || !entries.length) {
		return -1;
	}

	const ratio = Math.min(Math.max((clientX - trackRect.left) / Math.max(1, trackRect.width), 0), 1);
	const denominator = Math.max(1, entries.length - 1);
	return Math.min(entries.length - 1, Math.max(0, Math.round(ratio * denominator)));
}

export function getPendingSnapshotRevisionIndexes(
	revisionEntries: Array<FileRevisionEntry>,
	loadedChangeIds: Set<string>,
	limit: number,
	preferredIndexes: Array<number> = [],
): Array<number> {
	const preferredIndexSet = new Set(preferredIndexes);
	const seenChangeIds = new Set<string>();
	const orderedEntries = [...revisionEntries.filter((entry) => preferredIndexSet.has(entry.index)), ...revisionEntries];

	return orderedEntries
		.reduce<Array<number>>((indexes, entry) => {
			if (
				!entry.touchesFile ||
				entry.isWorkingTree ||
				!entry.changeId ||
				loadedChangeIds.has(entry.changeId) ||
				seenChangeIds.has(entry.changeId)
			) {
				return indexes;
			}

			seenChangeIds.add(entry.changeId);
			indexes.push(entry.index);
			return indexes.length >= limit ? indexes : indexes;
		}, [])
		.slice(0, limit);
}

export function getUnitPreviewRange(
	visibleEntries: Array<FileRevisionEntry>,
	toIndex: number,
): { fromIndex: number; toIndex: number } | null {
	const currentIndex = visibleEntries.findIndex((entry) => entry.index === toIndex);
	if (currentIndex <= 0) {
		return null;
	}

	return {
		fromIndex: visibleEntries[currentIndex - 1].index,
		toIndex: visibleEntries[currentIndex].index,
	};
}

export function getSidebarPreviewRequests(
	visibleEntries: Array<FileRevisionEntry>,
	comparisonSource: ComparisonSource,
	previewByRange: Record<string, DiffPreview>,
	selectedPreviewKey: string,
	buildPreviewKey: (fromIndex: number, toIndex: number, source: ComparisonSource) => string,
): Array<{ key: string; fromIndex: number; toIndex: number; comparisonSource: ComparisonSource }> {
	const requests: Array<{ key: string; fromIndex: number; toIndex: number; comparisonSource: ComparisonSource }> = [];

	for (let index = 1; index < visibleEntries.length; index += 1) {
		const fromIndex = visibleEntries[index - 1].index;
		const toIndex = visibleEntries[index].index;
		const key = buildPreviewKey(fromIndex, toIndex, comparisonSource);

		if (key === selectedPreviewKey || previewByRange[key]) {
			continue;
		}

		requests.push({
			key,
			fromIndex,
			toIndex,
			comparisonSource,
		});
	}

	return requests;
}

export function getPendingSelectionRange(
	visibleEntries: Array<FileRevisionEntry>,
	pendingSelectionIndex: number | null,
	hoveredSelectionIndex: number | null,
): { fromEntry: FileRevisionEntry; toEntry: FileRevisionEntry; selectedCount: number } | null {
	if (
		pendingSelectionIndex === null ||
		hoveredSelectionIndex === null ||
		pendingSelectionIndex === hoveredSelectionIndex
	) {
		return null;
	}

	const fromIndex = Math.min(pendingSelectionIndex, hoveredSelectionIndex);
	const toIndex = Math.max(pendingSelectionIndex, hoveredSelectionIndex);
	const fromEntry = visibleEntries.find((entry) => entry.index === fromIndex);
	const toEntry = visibleEntries.find((entry) => entry.index === toIndex);
	if (!fromEntry || !toEntry) {
		return null;
	}

	return {
		fromEntry,
		toEntry,
		selectedCount: getSelectedEntryCount(visibleEntries, fromIndex, toIndex),
	};
}

export function getIntermediateToggleLabel(
	visibleCount: number,
	totalCount: number,
	showIntermediateRevisions: boolean,
): string {
	const action = showIntermediateRevisions ? 'Hide' : 'Show';
	const safeTotal = Math.max(0, totalCount);
	if (!safeTotal) {
		return `${action} In-Between`;
	}

	const safeVisibleCount = Math.min(Math.max(0, visibleCount), safeTotal);
	return `${action} In-Between ${safeVisibleCount}/${safeTotal}`;
}
