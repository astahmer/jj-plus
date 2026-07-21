import { expect, test } from 'vitest';
import { Story } from 'foldkit';
import { SendHostCommand } from './commands.ts';
import { GotHostMessage, SubmittedFileSwitcher } from './messages.ts';
import { hostCommandResolvers, hydratedModel, makeEntry, makeTimelineData } from './test/fixture-model.ts';
import { update } from './update.ts';

test('switching back to a cached file restores Ready state without wiping previews', () => {
	const first = makeTimelineData([
		makeEntry({ index: 0, shortRevision: 'a0' }),
		makeEntry({ index: 1, shortRevision: 'a1' }),
		makeEntry({ index: 2, shortRevision: 'Current', isWorkingTree: true }),
	]);
	first.relativePath = 'src/example.ts';
	first.workspaceFiles = ['src/example.ts', 'src/other.ts'];

	const second = makeTimelineData([
		makeEntry({ index: 0, shortRevision: 'b0' }),
		makeEntry({ index: 1, shortRevision: 'Current', isWorkingTree: true }),
	]);
	second.relativePath = 'src/other.ts';
	second.workspaceFiles = ['src/example.ts', 'src/other.ts'];

	const ready = hydratedModel(first);

	Story.story(
		update,
		Story.with({
			...ready,
			previewByRange: {
				'revision:1:2': {
					index: 2,
					title: 'cached',
					subtitle: '',
					diffCount: 1,
					additions: 1,
					deletions: 0,
					hunkCount: 1,
					hasChanges: true,
					fromIndex: 1,
					toIndex: 2,
					comparisonSource: 'revision',
					beforePath: 'src/example.ts',
					afterPath: 'src/example.ts',
					beforeText: 'a',
					afterText: 'b',
					nonTextualDetails: [],
				},
			},
		}),
		Story.message(SubmittedFileSwitcher({ value: 'src/other.ts' })),
		Story.Command.expectHas(SendHostCommand),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.session._tag).toBe('Loading');
			expect((model.fileSessionByPath as Record<string, unknown>)['src/example.ts']).toBeTruthy();
		}),
		Story.message(
			GotHostMessage({
				payload: { type: 'timeline-data', payload: second },
			}),
		),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.session._tag).toBe('Ready');
			expect((model.data as { relativePath?: string } | null)?.relativePath).toBe('src/other.ts');
		}),
		Story.message(SubmittedFileSwitcher({ value: 'src/example.ts' })),
		Story.Command.expectHas(SendHostCommand),
		Story.Command.resolveAll(...hostCommandResolvers()),
		Story.model((model) => {
			expect(model.session._tag).toBe('Ready');
			expect((model.data as { relativePath?: string } | null)?.relativePath).toBe('src/example.ts');
			expect(model.previewByRange['revision:1:2']).toBeTruthy();
		}),
	);
});
