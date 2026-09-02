import { Scene } from 'foldkit';
import { test } from 'vitest';
import type { RepoRevisionEntry, RepoTimelineData, RepoTimelineDiff } from './types.ts';
import { CompletedSendHost } from './messages.ts';
import { initialModel } from './model.ts';
import { SendHostCommand } from './commands.ts';
import { update } from './update.ts';
import { view } from './view.ts';

function entry(
	index: number,
	revision: string,
	parentRevisionIds: string[],
	overrides: Partial<RepoRevisionEntry> = {},
): RepoRevisionEntry {
	return {
		id: revision,
		revision,
		shortRevision: revision,
		changeId: `change-${revision}`,
		parentRevisionIds,
		authorDate: '2026-09-02T12:00:00Z',
		authorName: 'Agent',
		description: `workspace: ${revision}`,
		isWorkingTree: false,
		touchesFile: false,
		timestamp: index,
		index,
		relativeDate: `${index} minutes ago`,
		...overrides,
	};
}

test('compact SCM view combines workspace graph rows and selected revision files', () => {
	const entries = [
		entry(0, 'base', []),
		entry(1, 'agent', ['base'], { workingCopyNames: ['agent-workspace'], isWorkingTree: true }),
		entry(2, 'main', ['base'], {
			workingCopyNames: ['default'],
			isWorkingTree: true,
			isCurrentWorkingCopy: true,
		}),
	];
	const data: RepoTimelineData = {
		backend: 'jj',
		workspacePath: '/tmp/repo',
		repositoryName: 'repo',
		entries,
		bookmarks: [],
		truncated: false,
		selectedIndex: 2,
	};
	const diff: RepoTimelineDiff = {
		revision: 'main',
		patch: '',
		files: [{ path: 'src/main.ts', before: '', after: '' }],
	};
	const model = { ...initialModel, compact: true, loading: false, data, diff, selectedIndex: 2 };

	Scene.scene(
		{ update, view },
		Scene.with(model),
		Scene.expect(Scene.role('textbox', { name: 'Revisions shown in the graph' })).toExist(),
		Scene.expect(Scene.role('button', { name: /workspace: main.*current workspace/u })).toExist(),
		Scene.expect(Scene.role('button', { name: '↳ src/main.ts' })).toExist(),
		Scene.click(Scene.role('button', { name: /workspace: agent/u })),
		Scene.Command.expectExact(SendHostCommand({ command: { command: 'select-revision', index: 1 } })),
		Scene.Command.resolve(SendHostCommand, CompletedSendHost()),
		Scene.expect(Scene.selector('.repo-compact-files.repo-loading')).toContainText('Loading changes'),
	);
});
