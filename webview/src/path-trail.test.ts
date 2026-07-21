import { expect, test } from 'vitest';
import { buildFilePathTrail, formatFilePathTrail, pathTrailChanged } from '../../src/shared/path-trail.ts';
import { getFilePathTrailLabel } from './selectors.ts';
import { hydratedModel, makeTimelineData, makeEntry } from './test/fixture-model.ts';

test('getFilePathTrailLabel is empty when path never changes', () => {
	const model = hydratedModel();
	expect(getFilePathTrailLabel(model)).toBe('');
});

test('getFilePathTrailLabel formats rename chain from entry filePaths', () => {
	const base = hydratedModel();
	const model = {
		...base,
		data: makeTimelineData(
			[
				makeEntry({ index: 0, id: 'a', revision: 'a', shortRevision: 'a', filePath: 'legacy.ts' }),
				makeEntry({ index: 1, id: 'b', revision: 'b', shortRevision: 'b', filePath: 'invite.ts' }),
				makeEntry({ index: 2, id: 'c', revision: 'c', shortRevision: 'c', filePath: 'app.ts', isWorkingTree: true }),
			],
			{ relativePath: 'app.ts' },
		),
	};
	expect(pathTrailChanged(buildFilePathTrail(model.data!.entries, 'app.ts'))).toBe(true);
	expect(getFilePathTrailLabel(model)).toContain('legacy.ts');
	expect(getFilePathTrailLabel(model)).toContain('app.ts');
	expect(getFilePathTrailLabel(model)).toBe(formatFilePathTrail(buildFilePathTrail(model.data!.entries, 'app.ts')));
});
