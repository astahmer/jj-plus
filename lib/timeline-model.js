function getEntriesForSource(data, comparisonSource) {
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
		}, new Map());

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

function getSelectedEntryCount(visibleEntries, fromIndex, toIndex) {
	const minIndex = Math.min(fromIndex, toIndex);
	const maxIndex = Math.max(fromIndex, toIndex);
	return visibleEntries.filter((entry) => entry.index >= minIndex && entry.index <= maxIndex).length;
}

function getTimelineAnchorPercent(visibleEntries, visibleIndex) {
	if (!visibleEntries.length) {
		return 0;
	}

	const denominator = Math.max(1, visibleEntries.length - 1);
	return (Math.min(Math.max(visibleIndex, 0), visibleEntries.length - 1) / denominator) * 100;
}

function getPendingSnapshotRevisionIndexes(revisionEntries, loadedChangeIds, limit, preferredIndexes = []) {
	const preferredIndexSet = new Set(preferredIndexes);
	const seenChangeIds = new Set();
	const orderedEntries = [...revisionEntries.filter((entry) => preferredIndexSet.has(entry.index)), ...revisionEntries];

	return orderedEntries
		.reduce((indexes, entry) => {
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

function getUnitPreviewRange(visibleEntries, toIndex) {
	const currentIndex = visibleEntries.findIndex((entry) => entry.index === toIndex);
	if (currentIndex <= 0) {
		return null;
	}

	return {
		fromIndex: visibleEntries[currentIndex - 1].index,
		toIndex: visibleEntries[currentIndex].index,
	};
}

function getSidebarPreviewRequests(
	visibleEntries,
	comparisonSource,
	previewByRange,
	selectedPreviewKey,
	buildPreviewKey,
) {
	const requests = [];

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

function getPendingSelectionRange(visibleEntries, pendingSelectionIndex, hoveredSelectionIndex) {
	if (
		pendingSelectionIndex == null ||
		hoveredSelectionIndex == null ||
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

function getIntermediateToggleLabel(visibleCount, totalCount, showIntermediateRevisions) {
	const action = showIntermediateRevisions ? 'Hide' : 'Show';
	const safeTotal = Math.max(0, totalCount);
	if (!safeTotal) {
		return `${action} In-Between`;
	}

	const safeVisibleCount = Math.min(Math.max(0, visibleCount), safeTotal);
	return `${action} In-Between ${safeVisibleCount}/${safeTotal}`;
}

module.exports = {
	getEntriesForSource,
	getIntermediateToggleLabel,
	getPendingSnapshotRevisionIndexes,
	getPendingSelectionRange,
	getSelectedEntryCount,
	getSidebarPreviewRequests,
	getTimelineAnchorPercent,
	getUnitPreviewRange,
};
