import type { ComparisonSource, DiffPreview, FileRevisionEntry, TimelineData } from './timeline-types';

export function getEntriesForSource(
	data: TimelineData | null,
	comparisonSource: ComparisonSource,
): FileRevisionEntry[] {
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
		}, new Map<string, FileRevisionEntry[]>());

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

export function getSelectedEntryCount(visibleEntries: FileRevisionEntry[], fromIndex: number, toIndex: number): number {
	const minIndex = Math.min(fromIndex, toIndex);
	const maxIndex = Math.max(fromIndex, toIndex);
	return visibleEntries.filter(
		(entry) => entry.index !== undefined && entry.index >= minIndex && entry.index <= maxIndex,
	).length;
}

export function getTimelineAnchorPercent(visibleEntries: FileRevisionEntry[], visibleIndex: number): number {
	if (!visibleEntries.length) {
		return 0;
	}

	const denominator = Math.max(1, visibleEntries.length - 1);
	return (Math.min(Math.max(visibleIndex, 0), visibleEntries.length - 1) / denominator) * 100;
}

export function getPendingSnapshotRevisionIndexes(
	revisionEntries: FileRevisionEntry[],
	loadedChangeIds: Set<string>,
	limit: number,
	preferredIndexes: number[] = [],
): number[] {
	const preferredIndexSet = new Set(preferredIndexes);
	const seenChangeIds = new Set<string>();
	const orderedEntries = [
		...revisionEntries.filter((entry) => preferredIndexSet.has(entry.index ?? -1)),
		...revisionEntries,
	];

	return orderedEntries
		.reduce<number[]>((indexes, entry) => {
			if (
				!entry.touchesFile ||
				entry.isWorkingTree ||
				!entry.changeId ||
				loadedChangeIds.has(entry.changeId) ||
				seenChangeIds.has(entry.changeId) ||
				entry.index === undefined
			) {
				return indexes;
			}

			seenChangeIds.add(entry.changeId);
			indexes.push(entry.index);
			return indexes;
		}, [])
		.slice(0, limit);
}

export function getUnitPreviewRange(
	visibleEntries: FileRevisionEntry[],
	toIndex: number,
): { fromIndex: number; toIndex: number } | null {
	const currentIndex = visibleEntries.findIndex((entry) => entry.index === toIndex);
	if (currentIndex <= 0) {
		return null;
	}

	return {
		fromIndex: visibleEntries[currentIndex - 1]?.index ?? toIndex,
		toIndex: visibleEntries[currentIndex]?.index ?? toIndex,
	};
}

export function getSidebarPreviewRequests(
	visibleEntries: FileRevisionEntry[],
	comparisonSource: ComparisonSource,
	previewByRange: Record<string, DiffPreview>,
	selectedPreviewKey: string,
	buildPreviewKey: (fromIndex: number, toIndex: number, source: ComparisonSource) => string,
): Array<{ key: string; fromIndex: number; toIndex: number; comparisonSource: ComparisonSource }> {
	const requests: Array<{ key: string; fromIndex: number; toIndex: number; comparisonSource: ComparisonSource }> = [];

	for (let index = 1; index < visibleEntries.length; index += 1) {
		const fromIndex = visibleEntries[index - 1]?.index;
		const toIndex = visibleEntries[index]?.index;
		if (fromIndex === undefined || toIndex === undefined) {
			continue;
		}

		const key = buildPreviewKey(fromIndex, toIndex, comparisonSource);
		if (key === selectedPreviewKey || previewByRange[key]) {
			continue;
		}

		requests.push({ key, fromIndex, toIndex, comparisonSource });
	}

	return requests;
}

export function getPendingSelectionRange(
	visibleEntries: FileRevisionEntry[],
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
