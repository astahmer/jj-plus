import type { ComparisonMode, ComparisonSource, FileRevisionEntry, TimelineData, TimelinePreset } from './types.ts';

export function filterEntries(
	entries: FileRevisionEntry[],
	data: TimelineData | null,
	preset: TimelinePreset,
	showIntermediateRevisions: boolean,
) {
	if (!data) {
		return [];
	}

	const lastEntry = entries[entries.length - 1];
	if (!lastEntry) {
		return [];
	}

	const windowDays = data.presets[preset];
	const cutoff = Number.isFinite(windowDays)
		? lastEntry.timestamp - windowDays * 24 * 60 * 60 * 1000
		: Number.NEGATIVE_INFINITY;

	const fallbackEntries = entries.filter((entry) => showIntermediateRevisions || entry.touchesFile);
	const filteredEntries = entries
		.filter((entry) => entry.timestamp >= cutoff)
		.filter((entry) => showIntermediateRevisions || entry.touchesFile);

	return filteredEntries.length >= 2 ? filteredEntries : fallbackEntries;
}

export function getDefaultSelection(entries: FileRevisionEntry[]) {
	if (entries.length < 2) {
		const index = entries[0]?.index || 0;
		return { fromIndex: index, toIndex: index };
	}

	return {
		fromIndex: entries[entries.length - 2].index,
		toIndex: entries[entries.length - 1].index,
	};
}

export function buildPreviewKey(fromIndex: number, toIndex: number, comparisonSource: ComparisonSource) {
	const normalizedFromIndex = Math.min(fromIndex, toIndex);
	const normalizedToIndex = Math.max(fromIndex, toIndex);
	return `${comparisonSource}:${normalizedFromIndex}:${normalizedToIndex}`;
}

export function buildRangeOverviewKey(
	fromIndex: number,
	toIndex: number,
	comparisonSource: ComparisonSource,
	selectedEntryIndexes: number[] = [],
) {
	const selectedKey = selectedEntryIndexes.length ? selectedEntryIndexes.join(',') : 'all';
	return `${buildPreviewKey(fromIndex, toIndex, comparisonSource)}:${selectedKey}`;
}

export function buildEntryDiffCountKey(entryIndex: number, comparisonSource: ComparisonSource) {
	return `${comparisonSource}:${entryIndex}`;
}

export function getVisibleIndexForAbsoluteIndex(entries: FileRevisionEntry[], entryIndex: number) {
	return entries.findIndex((entry) => entry.index === entryIndex);
}

export function normalizeSelection(
	entries: FileRevisionEntry[],
	fromIndex: number,
	toIndex: number,
	comparisonMode: ComparisonMode,
): [number, number] {
	if (entries.length < 2) {
		return [entries[0]?.index || 0, entries[0]?.index || 0];
	}

	const exactToVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
	const nextGreaterVisibleIndex = entries.findIndex((entry) => entry.index > toIndex);
	const nearestToVisibleIndex =
		exactToVisibleIndex >= 0
			? exactToVisibleIndex
			: nextGreaterVisibleIndex >= 0
				? nextGreaterVisibleIndex
				: entries.length - 1;

	const safeToVisibleIndex = nearestToVisibleIndex >= 1 ? nearestToVisibleIndex : entries.length - 1;
	if (comparisonMode === 'step') {
		return [entries[safeToVisibleIndex - 1].index, entries[safeToVisibleIndex].index];
	}

	const exactFromVisibleIndex = entries.findIndex((entry) => entry.index === fromIndex);
	if (exactFromVisibleIndex >= 0 && exactFromVisibleIndex < safeToVisibleIndex) {
		return [entries[exactFromVisibleIndex].index, entries[safeToVisibleIndex].index];
	}

	return [entries[safeToVisibleIndex - 1].index, entries[safeToVisibleIndex].index];
}

export function alignStepSelection(entries: FileRevisionEntry[], toIndex: number): [number, number] {
	if (entries.length < 2) {
		return [entries[0]?.index || 0, entries[0]?.index || 0];
	}

	const currentToVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
	const safeToVisibleIndex = Math.min(
		entries.length - 1,
		Math.max(1, currentToVisibleIndex >= 0 ? currentToVisibleIndex : entries.length - 1),
	);
	return [entries[safeToVisibleIndex - 1].index, entries[safeToVisibleIndex].index];
}

export function shiftStepSelection(entries: FileRevisionEntry[], toIndex: number, amount: number): [number, number] {
	if (entries.length < 2) {
		return [entries[0]?.index || 0, entries[0]?.index || 0];
	}

	const currentToVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
	const nextToVisibleIndex = Math.min(
		entries.length - 1,
		Math.max(1, (currentToVisibleIndex >= 0 ? currentToVisibleIndex : 1) + amount),
	);
	return [entries[nextToVisibleIndex - 1].index, entries[nextToVisibleIndex].index];
}

export function shiftRangeSelection(
	entries: FileRevisionEntry[],
	fromIndex: number,
	toIndex: number,
	amount: number,
): [number, number] {
	if (entries.length < 2) {
		return [entries[0]?.index || 0, entries[0]?.index || 0];
	}

	const fromVisibleIndex = entries.findIndex((entry) => entry.index === fromIndex);
	const toVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
	const safeFromVisibleIndex = Math.max(0, fromVisibleIndex);
	const safeToVisibleIndex = Math.max(
		safeFromVisibleIndex + 1,
		toVisibleIndex >= 0 ? toVisibleIndex : safeFromVisibleIndex + 1,
	);
	const width = safeToVisibleIndex - safeFromVisibleIndex;
	const nextFromVisibleIndex = Math.min(
		Math.max(0, safeFromVisibleIndex + amount),
		Math.max(0, entries.length - 1 - width),
	);
	const nextToVisibleIndex = Math.min(entries.length - 1, nextFromVisibleIndex + width);
	return [entries[nextFromVisibleIndex].index, entries[nextToVisibleIndex].index];
}

export function adjustRangeBoundary(
	entries: FileRevisionEntry[],
	fromIndex: number,
	toIndex: number,
	side: 'from' | 'to',
	amount: number,
): [number, number] {
	if (entries.length < 2) {
		return [entries[0]?.index || 0, entries[0]?.index || 0];
	}

	let fromVisibleIndex = entries.findIndex((entry) => entry.index === fromIndex);
	let toVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
	fromVisibleIndex = Math.max(0, fromVisibleIndex);
	toVisibleIndex = Math.max(fromVisibleIndex + 1, toVisibleIndex);

	if (side === 'from') {
		fromVisibleIndex = Math.min(Math.max(0, fromVisibleIndex + amount), toVisibleIndex - 1);
	} else {
		toVisibleIndex = Math.max(fromVisibleIndex + 1, Math.min(entries.length - 1, toVisibleIndex + amount));
	}

	return [entries[fromVisibleIndex].index, entries[toVisibleIndex].index];
}

export function dockRangeSelection(
	entries: FileRevisionEntry[],
	fromIndex: number,
	toIndex: number,
	edge: 'start' | 'end',
): [number, number] {
	if (entries.length < 2) {
		return [entries[0]?.index || 0, entries[0]?.index || 0];
	}

	const fromVisibleIndex = Math.max(
		0,
		entries.findIndex((entry) => entry.index === fromIndex),
	);
	const toVisibleIndex = Math.max(
		fromVisibleIndex + 1,
		entries.findIndex((entry) => entry.index === toIndex),
	);
	const width = toVisibleIndex - fromVisibleIndex;
	const nextFromVisibleIndex = edge === 'start' ? 0 : Math.max(0, entries.length - 1 - width);
	const nextToVisibleIndex = Math.min(entries.length - 1, nextFromVisibleIndex + width);
	return [entries[nextFromVisibleIndex].index, entries[nextToVisibleIndex].index];
}

export function canNavigateSelection(
	entries: FileRevisionEntry[],
	fromIndex: number,
	toIndex: number,
	comparisonMode: ComparisonMode,
	direction: -1 | 1,
) {
	if (entries.length < 2) {
		return false;
	}

	if (comparisonMode === 'step') {
		const toVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
		return direction < 0 ? toVisibleIndex > 1 : toVisibleIndex < entries.length - 1;
	}

	const fromVisibleIndex = entries.findIndex((entry) => entry.index === fromIndex);
	const toVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
	return direction < 0 ? fromVisibleIndex > 0 : toVisibleIndex < entries.length - 1;
}
