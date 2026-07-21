import { test } from 'vitest';
import { Scene } from 'foldkit';
import { buildPreviewKey } from './domain/timeline-selection.ts';
import { hydratedModel, makeDiffPreview, makeEntry, makeTimelineData } from './test/fixture-model.ts';
import { update } from './update.ts';
import { view } from './view/app.ts';

const program = { update, view };

test('empty textual diff shows concrete non-textual details', () => {
	const data = makeTimelineData([
		makeEntry({ index: 0, shortRevision: 'aaaa' }),
		makeEntry({ index: 1, shortRevision: 'bbbb' }),
	]);
	const key = buildPreviewKey(0, 1, 'revision');
	const ready = {
		...hydratedModel(data),
		fromIndex: 0,
		toIndex: 1,
		comparisonMode: 'range' as const,
		comparisonSource: 'revision' as const,
		contentMode: 'diffs' as const,
		previewByRange: {
			[key]: makeDiffPreview(0, 1, {
				hasChanges: false,
				additions: 0,
				deletions: 0,
				hunkCount: 0,
				beforePath: 'old.ts',
				afterPath: 'new.ts',
				beforeText: 'same',
				afterText: 'same',
				nonTextualDetails: ['Path changed: old.ts -> new.ts'],
			}),
		},
	};

	Scene.scene(
		program,
		Scene.with(ready),
		Scene.expect(Scene.text('No textual changes in this selection.')).toExist(),
		Scene.expect(Scene.selector('#emptyDiffDetails')).toContainText('Path changed: old.ts -> new.ts'),
	);
});
