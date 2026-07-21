import { expect, test } from 'vitest';
import { getEntryTimelineMarkers, getTimelineMarkerPrefix } from './domain/timeline-markers.ts';
import { makeEntry } from './test/fixture-model.ts';

test('getEntryTimelineMarkers adds empty conflict immutable badges', () => {
	const markers = getEntryTimelineMarkers(
		makeEntry({
			index: 1,
			isEmpty: true,
			hasConflict: true,
			isImmutable: true,
			bookmarkNames: ['main'],
		}),
	);
	expect(markers.map((marker) => marker.kind)).toEqual(['bookmark', 'empty', 'conflict', 'immutable']);
	expect(getTimelineMarkerPrefix('empty')).toBe('∅');
	expect(getTimelineMarkerPrefix('conflict')).toBe('!');
	expect(getTimelineMarkerPrefix('immutable')).toBe('IM');
});
