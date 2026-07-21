import { expect, test } from 'vitest';
import { getFilePathTrailLabel, getFilePathTrailTitle } from './selectors.ts';
import { hydratedModel, makeTimelineData, makeEntry } from './test/fixture-model.ts';

test('getFilePathTrailLabel is empty when path never changes', () => {
	const model = hydratedModel();
	expect(getFilePathTrailLabel(model)).toBe('');
});

test('getFilePathTrailLabel collapses rename ping-pong', () => {
	const base = hydratedModel();
	const model = {
		...base,
		data: makeTimelineData(
			[
				makeEntry({ index: 0, id: 'a', revision: 'a', shortRevision: 'a', filePath: 'apps/api/src/spec.ts' }),
				makeEntry({ index: 1, id: 'b', revision: 'b', shortRevision: 'b', filePath: 'apps/api/src/api.ts' }),
				makeEntry({ index: 2, id: 'c', revision: 'c', shortRevision: 'c', filePath: 'apps/api/src/spec.ts' }),
				makeEntry({
					index: 3,
					id: 'd',
					revision: 'd',
					shortRevision: 'd',
					filePath: 'apps/api/src/api.ts',
					isWorkingTree: true,
				}),
			],
			{ relativePath: 'apps/api/src/api.ts' },
		),
	};
	expect(getFilePathTrailLabel(model)).toBe('apps/api/src/spec.ts → apps/api/src/api.ts');
	expect(getFilePathTrailTitle(model)).toContain('spec.ts → apps/api/src/api.ts → apps/api/src/spec.ts');
});
