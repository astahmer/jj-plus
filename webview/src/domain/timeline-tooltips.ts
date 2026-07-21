import type { FileRevisionEntry } from '../types.ts';
import { getSelectedEntryCount, getVisibleIndexFromClientX } from './timeline-model.ts';

export type TrackTooltipPayload = {
	left: number;
	top: number;
	fromIndex: number;
	toIndex: number;
	pending: boolean;
	selectedCount: number;
};

export function buildRangeTooltipPayload(
	entries: Array<FileRevisionEntry>,
	fromIndex: number,
	toIndex: number,
	clientX: number,
	clientY: number,
	pending: boolean,
): TrackTooltipPayload | null {
	const normalizedFromIndex = Math.min(fromIndex, toIndex);
	const normalizedToIndex = Math.max(fromIndex, toIndex);
	const fromEntry = entries.find((entry) => entry.index === normalizedFromIndex);
	const toEntry = entries.find((entry) => entry.index === normalizedToIndex);
	if (!fromEntry || !toEntry) {
		return null;
	}

	return {
		left: clientX,
		top: clientY,
		fromIndex: normalizedFromIndex,
		toIndex: normalizedToIndex,
		pending,
		selectedCount: getSelectedEntryCount(entries, normalizedFromIndex, normalizedToIndex),
	};
}

export function buildPendingRangeTooltipPayload(
	entries: Array<FileRevisionEntry>,
	pendingSelectionIndex: number,
	hoveredSelectionIndex: number | null,
	clientX: number,
	clientY: number,
): TrackTooltipPayload | null {
	if (hoveredSelectionIndex === null || hoveredSelectionIndex === pendingSelectionIndex) {
		return null;
	}

	return buildRangeTooltipPayload(entries, pendingSelectionIndex, hoveredSelectionIndex, clientX, clientY, true);
}

export function buildSegmentTooltipPayload(
	entries: Array<FileRevisionEntry>,
	clientX: number,
	clientY: number,
): TrackTooltipPayload | null {
	const visibleIndex = getVisibleIndexFromClientX(entries, clientX);
	if (visibleIndex <= 0) {
		return null;
	}

	const fromEntry = entries[visibleIndex - 1];
	const toEntry = entries[visibleIndex];
	if (!fromEntry || !toEntry) {
		return null;
	}

	return buildRangeTooltipPayload(entries, fromEntry.index, toEntry.index, clientX, clientY, false);
}

export function getHoveredTrackEntryIndex(
	entries: Array<FileRevisionEntry>,
	clientX: number,
	anchorEntryIndex: number | null,
): number | null {
	if (anchorEntryIndex !== null && Number.isInteger(anchorEntryIndex)) {
		return anchorEntryIndex;
	}

	const visibleIndex = getVisibleIndexFromClientX(entries, clientX);
	if (visibleIndex < 0) {
		return null;
	}

	return entries[visibleIndex]?.index ?? null;
}

export function formatRevisionCount(count: number): string {
	return `${count} ${count === 1 ? 'revision' : 'revisions'}`;
}

export function clampTooltipX(left: number, halfWidth = 180): number {
	if (typeof window === 'undefined') {
		return left;
	}

	return Math.min(window.innerWidth - halfWidth, Math.max(halfWidth, left));
}

export function shouldPlaceTooltipBelow(clientY: number, estimatedHeight = 200): boolean {
	return clientY < estimatedHeight + 24;
}

export function clampTooltipY(top: number, estimatedHeight = 200, placeBelow = false): number {
	if (typeof window === 'undefined') {
		return top;
	}

	const gap = 8;
	if (placeBelow) {
		const maxTop = Math.max(12, window.innerHeight - estimatedHeight - gap);
		return Math.min(maxTop, Math.max(12, top + gap));
	}

	// Point is the bottom of the tooltip (CSS translates up by 100%).
	const minTop = estimatedHeight + gap;
	const maxTop = window.innerHeight - gap;
	return Math.min(maxTop, Math.max(minTop, top));
}

export function readAnchorEntryIndex(target: HTMLElement | null): number | null {
	const anchor = target?.closest('.track-anchor[data-entry-index]') as HTMLElement | null;
	if (!anchor) {
		return null;
	}
	const raw = Number(anchor.dataset.entryIndex);
	return Number.isInteger(raw) ? raw : null;
}
