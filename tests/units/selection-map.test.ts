import assert from 'node:assert/strict';
import test from 'node:test';
import { mapSelectionAcrossSources } from '../../webview/src/domain/timeline-selection.ts';
import type { FileRevisionEntry } from '../../webview/src/types.ts';

function entry(
	overrides: Partial<FileRevisionEntry> & Pick<FileRevisionEntry, 'index' | 'changeId'>,
): FileRevisionEntry {
	return {
		id: `e${overrides.index}`,
		revision: `rev${overrides.index}`.padEnd(40, '0'),
		shortRevision: `r${overrides.index}`,
		authorDate: '2026-07-08T12:00:00+02:00',
		authorName: 'Alex',
		description: `entry ${overrides.index}`,
		isWorkingTree: false,
		touchesFile: true,
		timestamp: overrides.index,
		index: overrides.index,
		changeId: overrides.changeId,
		...overrides,
	};
}

test('mapSelectionAcrossSources maps tip to last matching changeId in snapshot list', () => {
	const mapped = mapSelectionAcrossSources({
		previousEntries: [
			entry({ index: 0, changeId: 'aaaa' }),
			entry({ index: 1, changeId: 'bbbb' }),
			entry({ index: 2, changeId: 'cccc' }),
		],
		nextEntries: [
			entry({ index: 10, changeId: 'aaaa' }),
			entry({ index: 11, changeId: 'bbbb' }),
			entry({ index: 12, changeId: 'cccc' }),
			entry({ index: 13, changeId: 'cccc' }),
		],
		fromIndex: 1,
		toIndex: 2,
		comparisonMode: 'step',
	});
	assert.deepEqual(mapped, { fromIndex: 12, toIndex: 13 });
});
