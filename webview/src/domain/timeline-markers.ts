import type { FileRevisionEntry } from '../types.ts';

export type TimelineMarker = {
	kind: 'bookmark' | 'branch' | 'operation' | 'empty' | 'conflict' | 'immutable';
	label: string;
	title: string;
};

export function getEntryTimelineMarkers(
	entry: Pick<
		FileRevisionEntry,
		'bookmarkNames' | 'branchNames' | 'operationId' | 'operationIndex' | 'isEmpty' | 'hasConflict' | 'isImmutable'
	>,
): Array<TimelineMarker> {
	const markers: Array<TimelineMarker> = [];
	for (const bookmarkName of new Set(entry.bookmarkNames || [])) {
		markers.push({
			kind: 'bookmark',
			label: bookmarkName,
			title: `Bookmark ${bookmarkName}`,
		});
	}

	for (const branchName of new Set(entry.branchNames || [])) {
		markers.push({
			kind: 'branch',
			label: branchName,
			title: `Branch ${branchName}`,
		});
	}

	if (entry.operationId || entry.operationIndex !== undefined) {
		const operationLabel =
			entry.operationIndex !== undefined ? String(entry.operationIndex) : (entry.operationId || '').slice(0, 8) || 'op';
		markers.push({
			kind: 'operation',
			label: operationLabel,
			title: entry.operationId ? `Operation ${entry.operationId}` : 'JJ operation',
		});
	}

	if (entry.isEmpty) {
		markers.push({
			kind: 'empty',
			label: 'empty',
			title: 'Empty change (no content diff)',
		});
	}

	if (entry.hasConflict) {
		markers.push({
			kind: 'conflict',
			label: 'conflict',
			title: 'Conflicted change',
		});
	}

	if (entry.isImmutable) {
		markers.push({
			kind: 'immutable',
			label: 'immutable',
			title: 'Immutable change',
		});
	}

	return markers;
}

export function getTimelineMarkerPrefix(kind: TimelineMarker['kind']): string {
	switch (kind) {
		case 'bookmark':
			return 'BM';
		case 'branch':
			return 'BR';
		case 'operation':
			return 'OP';
		case 'empty':
			return '∅';
		case 'conflict':
			return '!';
		case 'immutable':
			return 'IM';
	}
}

export function getTimelineMarkerKeywords(markers: Array<TimelineMarker>): Array<string> {
	return markers.flatMap((marker) => [marker.label, marker.title]);
}
