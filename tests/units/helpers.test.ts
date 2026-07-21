import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTextForComparison, textsMatchIgnoringLineEndings } from '../../src/shared/diff-helpers.ts';
import {
	dedupeAdjacentEntriesByChangeId,
	getGitHubRemoteBaseUrl,
	normalizeSnapshotOperationKey,
	parseGitBranchNames,
	parseJjEvolutionLine,
	parseJjBookmarkNames,
	parseJjEvolutionSummaryEntries,
	parseJjHistoryLine,
	parseJjSummaryChangedPaths,
	parseJjSummaryRenameLines,
	resolvePreferredHistoryBackend,
	toJjRootFileFileset,
} from '../../src/shared/history-helpers.ts';
import { resolveHistoryAdapter } from '../../src/extension/history-adapters.ts';
import { createTimelineService } from '../../src/extension/timeline-service.ts';
import {
	findRevisionEntryMatch,
	getEntriesForSource,
	getIntermediateToggleLabel,
	getPendingSelectionRange,
	getPendingSnapshotRevisionIndexes,
	getRangeOverviewDiffCount,
	getSelectedDiffEntryIndexes,
	getSelectedEntryCount,
	getSidebarPreviewRequests,
	getTimelineAnchorPercent,
	getUnitPreviewRange,
} from '../../src/shared/timeline-model.ts';
import type { FileRevisionEntry, TimelineData } from '../../src/shared/timeline-types.ts';
import { normalizeTimelinePreferences } from '../../src/extension/timeline-service.ts';

function makeEntry(overrides: Partial<FileRevisionEntry> & Pick<FileRevisionEntry, 'index'>): FileRevisionEntry {
	const index = overrides.index;
	return {
		id: overrides.id || `entry-${index}`,
		revision: overrides.revision || `rev-${index}`,
		shortRevision: overrides.shortRevision || `r${index}`,
		changeId: overrides.changeId,
		authorDate: overrides.authorDate || '2026-04-10T16:07:57+02:00',
		authorName: overrides.authorName || 'Alex',
		description: overrides.description || `entry ${index}`,
		isWorkingTree: overrides.isWorkingTree === true,
		touchesFile: overrides.touchesFile !== false,
		timestamp: (overrides.timestamp ?? index)!,
		filePath: overrides.filePath,
		operationId: overrides.operationId,
		operationIndex: overrides.operationIndex,
		operationKey: overrides.operationKey,
		remoteUrl: overrides.remoteUrl,
		hasPreviousEntry: overrides.hasPreviousEntry,
		monthLabel: overrides.monthLabel,
		shortDate: overrides.shortDate,
		relativeDate: overrides.relativeDate,
		index,
	};
}

function makeTimelineData(overrides: {
	backend: TimelineData['backend'];
	entries: FileRevisionEntry[];
	snapshotEntries: FileRevisionEntry[];
	snapshotState?: TimelineData['snapshotState'];
}): TimelineData {
	return {
		backend: overrides.backend,
		workspacePath: '/tmp/repo',
		relativePath: 'src/example.ts',
		fileName: 'example.ts',
		version: '0.0.0-test',
		presets: { year: 365, '7d': 7, '30d': 30, '90d': 90, all: Number.POSITIVE_INFINITY },
		defaultIndex: overrides.entries.at(-1)?.index || 0,
		latestIndex: overrides.entries.at(-1)?.index || 0,
		preferences: {},
		workspaceFiles: ['src/example.ts'],
		hasIntermediateRevisions: false,
		entries: overrides.entries,
		snapshotEntries: overrides.snapshotEntries,
		snapshotState: overrides.snapshotState,
	};
}

test('normalizeTextForComparison normalizes CRLF to LF', () => {
	assert.equal(normalizeTextForComparison('a\r\nb\r\n'), 'a\nb\n');
});

test('textsMatchIgnoringLineEndings treats CRLF and LF as equal', () => {
	assert.equal(textsMatchIgnoringLineEndings('a\r\nb\r\n', 'a\nb\n'), true);
	assert.equal(textsMatchIgnoringLineEndings('a\nb\n', 'a\nc\n'), false);
});

test('parseJjSummaryRenameLines extracts renamed paths from jj diff summary output', () => {
	assert.deepEqual(
		parseJjSummaryRenameLines(
			[
				'M src/index.js',
				'R old/name.ts => new/name.ts',
				'A src/added.ts',
				'R apps/backend/src/auth/use-cases/{invite-member-to-organization.use-case.ts => app-invite-member-to-organization.use-case.ts}',
			].join('\n'),
		),
		[
			{ fromPath: 'old/name.ts', toPath: 'new/name.ts' },
			{
				fromPath: 'apps/backend/src/auth/use-cases/invite-member-to-organization.use-case.ts',
				toPath: 'apps/backend/src/auth/use-cases/app-invite-member-to-organization.use-case.ts',
			},
		],
	);
});

test('parseJjEvolutionLine prefers commit description but keeps operation metadata available', () => {
	assert.deepEqual(
		parseJjEvolutionLine(
			'38adf0870a65\tyvsqu\t2026-04-10T16:07:57+02:00\tAlex\tsnapshot working copy\tfix knip config',
		),
		{
			revision: '38adf0870a65',
			changeId: 'yvsqu',
			authorDate: '2026-04-10T16:07:57+02:00',
			authorName: 'Alex',
			description: 'fix knip config',
			operationDescription: 'snapshot working copy',
		},
	);
});

test('parseJjEvolutionLine falls back to operation description when commit description is empty', () => {
	assert.deepEqual(
		parseJjEvolutionLine('6db8e51d08d2\tyvsqu\t2026-04-10T16:07:57+02:00\tAlex\tsnapshot working copy\t'),
		{
			revision: '6db8e51d08d2',
			changeId: 'yvsqu',
			authorDate: '2026-04-10T16:07:57+02:00',
			authorName: 'Alex',
			description: 'snapshot working copy',
			operationDescription: 'snapshot working copy',
		},
	);
});

test('parseJjEvolutionSummaryEntries parses metadata and per-entry summaries from jj evolog --summary output', () => {
	const entries = parseJjEvolutionSummaryEntries(
		[
			'kqppukkm/72 alex@example.com 2026-04-08 13:51:51 021cab5d (hidden)',
			'(no description set)',
			'-- operation 10938023ba48 snapshot working copy',
			'M knip.jsonc',
			'kqppukkm/73 alex@example.com 2026-04-08 13:51:40 f1bd5a80 (hidden)',
			'fix config',
			'-- operation 832f9ee85116 snapshot working copy',
			'R old/name.ts => new/name.ts',
		].join('\n'),
	);

	assert.deepEqual(entries, [
		{
			changeKey: 'kqppukkm/72',
			changeId: 'kqppukkm',
			operationIndex: 72,
			authorDate: '2026-04-08T13:51:51',
			authorName: 'alex@example.com',
			revision: '021cab5d',
			description: '(no description set)',
			operationId: '10938023ba48',
			operationDescription: 'snapshot working copy',
			summaryLines: ['M knip.jsonc'],
		},
		{
			changeKey: 'kqppukkm/73',
			changeId: 'kqppukkm',
			operationIndex: 73,
			authorDate: '2026-04-08T13:51:40',
			authorName: 'alex@example.com',
			revision: 'f1bd5a80',
			description: 'fix config',
			operationId: '832f9ee85116',
			operationDescription: 'snapshot working copy',
			summaryLines: ['R old/name.ts => new/name.ts'],
		},
	]);
});

test('parseJjEvolutionSummaryEntries keeps the commit revision when a visible header includes bookmarks', () => {
	const [entry] = parseJjEvolutionSummaryEntries(
		[
			'kqppukkm alex@example.com 2026-04-09 12:32:35 chore/rm-unused-endpoints 4c3a9ffa',
			'rm more unused stuff',
			'-- operation 49a69c738364 squash commits into 0c5b72791d43296dfc536cc1c83c914684d16667',
		].join('\n'),
	);

	assert.equal(entry.revision, '4c3a9ffa');
	assert.deepEqual(entry.bookmarkNames, ['chore/rm-unused-endpoints']);
});

test('parseGitBranchNames keeps branch refs and strips HEAD aliases and tags', () => {
	assert.deepEqual(parseGitBranchNames('HEAD -> main, origin/main, tag: v0.0.4'), ['main', 'origin/main']);
	assert.deepEqual(parseGitBranchNames('origin/HEAD -> origin/main, feature/responsive-pane'), [
		'origin/main',
		'feature/responsive-pane',
	]);
	assert.equal(parseGitBranchNames('HEAD, tag: latest'), undefined);
});

test('parseJjBookmarkNames normalizes the template bookmark list', () => {
	assert.deepEqual(parseJjBookmarkNames('main, feature/responsive-pane, main'), ['main', 'feature/responsive-pane']);
	assert.equal(parseJjBookmarkNames(''), undefined);
});

test('parseJjHistoryLine reads empty conflict immutable flags', () => {
	const entry = parseJjHistoryLine(
		'abcd1234\tkqppukkm\t2026-04-09T12:32:35+02:00\talex\tmain\ttrue\ttrue\tfalse\tempty conflicted change',
	);
	assert.equal(entry.revision, 'abcd1234');
	assert.equal(entry.changeId, 'kqppukkm');
	assert.deepEqual(entry.bookmarkNames, ['main']);
	assert.equal(entry.isEmpty, true);
	assert.equal(entry.hasConflict, true);
	assert.equal(entry.isImmutable, undefined);
	assert.equal(entry.description, 'empty conflicted change');
});

test('parseJjHistoryLine keeps legacy bookmark-description format', () => {
	const entry = parseJjHistoryLine(
		'abcd1234\tkqppukkm\t2026-04-09T12:32:35+02:00\talex\tmain\tlegacy description',
	);
	assert.equal(entry.description, 'legacy description');
	assert.equal(entry.isEmpty, undefined);
	assert.equal(entry.hasConflict, undefined);
});

test('normalizeSnapshotOperationKey adds an explicit zero suffix for the visible revision snapshot', () => {
	assert.equal(normalizeSnapshotOperationKey('kqppukkm'), 'kqppukkm/0');
	assert.equal(normalizeSnapshotOperationKey('kqppukkm/4'), 'kqppukkm/4');
});

test('toJjRootFileFileset safely encodes file paths for jj fileset commands', () => {
	assert.equal(
		toJjRootFileFileset('apps/frontend/src/routes/_auth/$organization/commitments/$commitment/index.tsx'),
		'root-file:"apps/frontend/src/routes/_auth/$organization/commitments/$commitment/index.tsx"',
	);
});

test('resolvePreferredHistoryBackend prefers the closest repo root and breaks ties in favor of jj', () => {
	assert.equal(
		resolvePreferredHistoryBackend({
			workspacePath: '/workspace/repos/git-basic',
			gitRoot: '/workspace/repos/git-basic',
			jjRoot: '/workspace',
		}),
		'git',
	);
	assert.equal(
		resolvePreferredHistoryBackend({
			workspacePath: '/workspace/repos/jj-basic/src',
			gitRoot: '/workspace/repos/jj-basic',
			jjRoot: '/workspace/repos/jj-basic',
		}),
		'jj',
	);
	assert.equal(
		resolvePreferredHistoryBackend({
			workspacePath: '/workspace/repos/jj-basic/src',
			jjRoot: '/workspace/repos/jj-basic',
		}),
		'jj',
	);
	assert.equal(
		resolvePreferredHistoryBackend({
			workspacePath: '/workspace/repos/git-basic/src',
			gitRoot: '/workspace/repos/git-basic',
		}),
		'git',
	);
});

test('resolveHistoryAdapter follows jj file renames back to file creation', async () => {
	const jjCalls: string[][] = [];
	const currentPath = 'apps/backend/src/auth/use-cases/app-invite-member-to-organization.use-case.ts';
	const previousPath = 'apps/backend/src/auth/use-cases/invite-member-to-organization.use-case.ts';
	const currentPathHistory = [
		'rename-revision	rename-change	2026-03-02T10:00:00+00:00	Renamer		move invite use case',
		`R apps/backend/src/auth/use-cases/{invite-member-to-organization.use-case.ts => app-invite-member-to-organization.use-case.ts}`,
		'current-revision	current-change	2026-03-03T10:00:00+00:00	Current Author		update invite use case',
		`M ${currentPath}`,
	].join('\n');
	const previousPathHistory = [
		'creation-revision	creation-change	2026-03-01T10:00:00+00:00	Old Author		initial app invite',
		`A ${previousPath}`,
		'rename-revision	rename-change	2026-03-02T10:00:00+00:00	Renamer		move invite use case',
		`D ${previousPath}`,
	].join('\n');
	const adapter = await resolveHistoryAdapter({
		workspacePath: '/workspace/repos/jj-basic/src',
		runner: {
			runGit: async () => {
				throw new Error('git is unavailable in this test');
			},
			runJj: async ({ args }) => {
				jjCalls.push(args);
				if (args[0] === 'root') {
					return { stdout: '/workspace/repos/jj-basic\n', stderr: '' };
				}

				if (args[0] === 'log') {
					if (args.includes(`root-file:"${currentPath}"`)) {
						return { stdout: currentPathHistory, stderr: '' };
					}

					if (args.includes(`root-file:"${previousPath}"`)) {
						return { stdout: previousPathHistory, stderr: '' };
					}

					return { stdout: '', stderr: '' };
				}

				return { stdout: '', stderr: '' };
			},
			fileExists: async () => false,
			quoteShellArg: (value) => JSON.stringify(value),
		},
	});

	assert.equal(adapter.backend, 'jj');
	const entries = await adapter.getFileRevisionHistory({
		workspacePath: '/workspace/repos/jj-basic/src',
		relativePath: currentPath,
	});

	assert.deepEqual(
		entries.map((entry) => entry.revision),
		['creation-revision', 'rename-revision', 'current-revision'],
	);

	const logCalls = jjCalls.filter((args) => args[0] === 'log');
	assert.equal(logCalls.length, 2);
	assert.ok(logCalls.every((args) => args.includes('--summary')));
	assert.ok(logCalls.every((args) => args.includes('--limit')));
	assert.ok(logCalls.every((args) => args.includes('-r')));
	assert.ok(logCalls.some((args) => args.includes(`root-file:"${currentPath}"`)));
	assert.ok(logCalls.some((args) => args.includes(`root-file:"${previousPath}"`)));
});

test('resolveHistoryAdapter caps git file history by default', async () => {
	const gitCalls: string[][] = [];
	const adapter = await resolveHistoryAdapter({
		workspacePath: '/workspace/repos/git-basic',
		runner: {
			runGit: async ({ args }) => {
				gitCalls.push(args);
				if (args[0] === 'rev-parse') {
					return { stdout: '/workspace/repos/git-basic\n', stderr: '' };
				}

				if (args[0] === 'log') {
					return { stdout: 'git-revision\t2026-03-01T10:00:00+00:00\tGit Author\tHEAD -> main\tinit\n', stderr: '' };
				}

				throw new Error('git is unavailable in this test');
			},
			runJj: async () => {
				throw new Error('jj is unavailable in this test');
			},
			fileExists: async () => false,
			quoteShellArg: (value) => JSON.stringify(value),
		},
	});

	assert.equal(adapter.backend, 'git');
	await adapter.getFileRevisionHistory({
		workspacePath: '/workspace/repos/git-basic',
		relativePath: 'src/example.ts',
	});

	const logCalls = gitCalls.filter((args) => args[0] === 'log');
	assert.ok(logCalls.every((args) => args.some((arg) => arg.startsWith('--max-count='))));
});

test('createTimelineService keeps every jj revision that touched the file across renames', async () => {
	const jjCalls: string[][] = [];
	const currentPath = 'apps/backend/src/auth/use-cases/app-invite-member-to-organization.use-case.ts';
	const previousPath = 'apps/backend/src/auth/use-cases/invite-member-to-organization.use-case.ts';
	// Workspace is the jj root so relativePath matches jj fileset / summary paths.
	const workspacePath = '/workspace/repos/jj-basic';
	const absolutePath = `${workspacePath}/${currentPath}`;
	const currentPathHistory = [
		'rename-revision\trename-change\t2026-03-02T10:00:00+00:00\tRenamer\t\tmove invite use case',
		`R apps/backend/src/auth/use-cases/{invite-member-to-organization.use-case.ts => app-invite-member-to-organization.use-case.ts}`,
		'current-revision-a\trepeat-change\t2026-03-03T10:00:00+00:00\tCurrent Author\t\tupdate invite use case',
		`M ${currentPath}`,
		'current-revision-b\trepeat-change\t2026-03-04T10:00:00+00:00\tCurrent Author\t\tupdate invite use case again',
		`M ${currentPath}`,
	].join('\n');
	const previousPathHistory = [
		'creation-revision\tcreation-change\t2026-03-01T10:00:00+00:00\tOld Author\t\tinitial app invite',
		`A ${previousPath}`,
		'rename-revision\trename-change\t2026-03-02T10:00:00+00:00\tRenamer\t\tmove invite use case',
		`D ${previousPath}`,
	].join('\n');
	const service = createTimelineService({
		runner: {
			runGit: async ({ args }) => {
				if (args[0] === 'rev-parse') {
					return { stdout: `${workspacePath}\n`, stderr: '' };
				}

				throw new Error('git is unavailable in this test');
			},
			runJj: async ({ args }) => {
				jjCalls.push(args);
				if (args[0] === 'root') {
					return { stdout: `${workspacePath}\n`, stderr: '' };
				}

				if (args[0] === 'file' && args[1] === 'list') {
					return { stdout: `${currentPath}\n`, stderr: '' };
				}

				if (args[0] === 'log') {
					if (args.includes(`root-file:"${currentPath}"`)) {
						return { stdout: currentPathHistory, stderr: '' };
					}

					if (args.includes(`root-file:"${previousPath}"`)) {
						return { stdout: previousPathHistory, stderr: '' };
					}

					return { stdout: '', stderr: '' };
				}

				return { stdout: '', stderr: '' };
			},
			fileExists: async () => false,
			quoteShellArg: (value) => JSON.stringify(value),
		},
	});

	const session = await service.buildSession({ workspacePath, absolutePath });

	assert.equal(session.adapter.backend, 'jj');
	assert.deepEqual(
		session.entries.map((entry) => entry.revision),
		['creation-revision', 'rename-revision', 'current-revision-a', 'current-revision-b'],
	);
	assert.ok(session.entries.every((entry) => entry.touchesFile));
	assert.ok(jjCalls.some((args) => args[0] === 'log' && args.includes(`root-file:"${previousPath}"`)));
});

test('createTimelineService resolves jj historical paths across same-name copy boundaries', async () => {
	const gitCalls: string[][] = [];
	const jjCalls: string[][] = [];
	const currentPath = 'packages/backend/src/commitments/commitment.entity.ts';
	const previousPath = 'packages/service-serf/src/commitments/commitment.entity.ts';
	const workspacePath = '/workspace/repos/jj-basic';
	const absolutePath = `${workspacePath}/${currentPath}`;
	const currentPathHistory = [
		'copy-revision\tcopy-change\t2026-03-02T10:00:00+00:00\tRenamer\t\tmove commitment entity',
		`A ${currentPath}`,
		'current-revision\tcurrent-change\t2026-03-03T10:00:00+00:00\tCurrent Author\t\tupdate commitment entity',
		`M ${currentPath}`,
	].join('\n');
	const previousPathHistory = [
		'creation-revision\tcreation-change\t2026-03-01T10:00:00+00:00\tOld Author\t\tinitial commitment entity',
		`A ${previousPath}`,
	].join('\n');
	const service = createTimelineService({
		runner: {
			runGit: async ({ args }) => {
				gitCalls.push(args);
				if (args[0] === 'rev-parse') {
					return { stdout: `${workspacePath}\n`, stderr: '' };
				}

				if (args[0] === 'diff-tree' && args.at(-1) === 'copy-revision') {
					return {
						stdout: `C094\t${previousPath}\t${currentPath}\n`,
						stderr: '',
					};
				}

				throw new Error('git is unavailable in this test');
			},
			runJj: async ({ args }) => {
				jjCalls.push(args);
				if (args[0] === 'root') {
					return { stdout: `${workspacePath}\n`, stderr: '' };
				}

				if (args[0] === 'file' && args[1] === 'list') {
					return { stdout: `${currentPath}\n`, stderr: '' };
				}

				if (args[0] === 'log') {
					if (args.includes(`root-file:"${currentPath}"`)) {
						return { stdout: currentPathHistory, stderr: '' };
					}

					if (args.includes(`root-file:"${previousPath}"`)) {
						return { stdout: previousPathHistory, stderr: '' };
					}

					return { stdout: '', stderr: '' };
				}

				if (args[0] === 'diff' && args[1] === '--summary' && args.includes('copy-revision')) {
					return { stdout: `A ${currentPath}\n`, stderr: '' };
				}

				return { stdout: '', stderr: '' };
			},
			fileExists: async () => false,
			quoteShellArg: (value) => JSON.stringify(value),
		},
	});

	const session = await service.buildSession({ workspacePath, absolutePath });
	assert.ok(session.entries[0], 'expected at least one history entry');
	const resolvedPath = await service.resolveEntryFilePath({
		session,
		entry: session.entries[0],
		entryIndex: 0,
	});

	assert.equal(resolvedPath, previousPath);
	assert.ok(gitCalls.some((args) => args[0] === 'diff-tree' && args.includes('copy-revision')));
});

test('parseJjSummaryChangedPaths includes direct and renamed paths', () => {
	assert.deepEqual(parseJjSummaryChangedPaths(['M knip.jsonc', 'R old/name.ts => new/name.ts', 'D stale/file.ts']), [
		'knip.jsonc',
		'stale/file.ts',
		'old/name.ts',
		'new/name.ts',
	]);
});

test('getGitHubRemoteBaseUrl supports https and ssh remotes', () => {
	assert.equal(
		getGitHubRemoteBaseUrl('https://github.com/astahmer/visualjj-range-diff-helper.git'),
		'https://github.com/astahmer/visualjj-range-diff-helper',
	);
	assert.equal(
		getGitHubRemoteBaseUrl('git@github.com:astahmer/visualjj-range-diff-helper.git'),
		'https://github.com/astahmer/visualjj-range-diff-helper',
	);
	assert.equal(getGitHubRemoteBaseUrl('https://gitlab.com/astahmer/example.git'), undefined);
});

test('dedupeAdjacentEntriesByChangeId only collapses consecutive JJ evolutions', () => {
	assert.deepEqual(
		dedupeAdjacentEntriesByChangeId([
			{ revision: 'a1', changeId: 'aaa' },
			{ revision: 'a2', changeId: 'aaa' },
			{ revision: 'b1', changeId: 'bbb' },
			{ revision: 'a3', changeId: 'aaa' },
		]),
		[
			{ revision: 'a1', changeId: 'aaa' },
			{ revision: 'b1', changeId: 'bbb' },
			{ revision: 'a3', changeId: 'aaa' },
		],
	);
});

test('getEntriesForSource progressively expands hydrated JJ snapshot entries', () => {
	const data = makeTimelineData({
		backend: 'jj' as const,
		entries: [
			makeEntry({ index: 0, revision: 'rev-1', changeId: 'aaa', touchesFile: true }),
			makeEntry({ index: 1, revision: 'rev-2', changeId: 'bbb', touchesFile: true }),
		],
		snapshotEntries: [
			makeEntry({ index: 0, revision: 'snap-1', changeId: 'aaa', touchesFile: true }),
			makeEntry({ index: 1, revision: 'snap-2', changeId: 'aaa', touchesFile: true }),
		],
		snapshotState: {
			loadedChangeIds: ['aaa'],
		},
	});
	assert.deepEqual(getEntriesForSource(data, 'revision'), data.entries);
	assert.deepEqual(getEntriesForSource(data, 'snapshot'), [
		makeEntry({ index: 0, revision: 'snap-1', changeId: 'aaa', touchesFile: true }),
		makeEntry({ index: 1, revision: 'snap-2', changeId: 'aaa', touchesFile: true }),
		{ ...data.entries[1], index: 2 },
	]);
	assert.deepEqual(getEntriesForSource({ ...data, backend: 'git' as const }, 'snapshot'), data.entries);
});

test('timeline model computes unit preview ranges and selected counts', () => {
	const visibleEntries = [4, 8, 10, 14].map((index) => makeEntry({ index }));
	assert.deepEqual(getUnitPreviewRange(visibleEntries, 10), { fromIndex: 8, toIndex: 10 });
	assert.equal(getUnitPreviewRange(visibleEntries, 4), null);
	assert.equal(getSelectedEntryCount(visibleEntries, 8, 14), 3);
	assert.deepEqual(getSelectedDiffEntryIndexes(visibleEntries, 4, 14, 'range'), [8, 10, 14]);
	assert.deepEqual(getSelectedDiffEntryIndexes(visibleEntries, 8, 10, 'step'), [10]);
});

test('timeline model finds revision matches by short revision or full revision prefix', () => {
	const visibleEntries = [
		makeEntry({ index: 1, shortRevision: 'abc123', revision: 'abc123456789' }),
		makeEntry({ index: 2, shortRevision: 'def456', revision: 'def456987654' }),
	];

	assert.equal(findRevisionEntryMatch(visibleEntries, 'abc123')?.index, 1);
	assert.equal(findRevisionEntryMatch(visibleEntries, 'def45698')?.index, 2);
	assert.equal(findRevisionEntryMatch(visibleEntries, 'missing'), undefined);
});

test('timeline model totals selection diff counts from range overview items', () => {
	assert.equal(
		getRangeOverviewDiffCount([
			{ relativePath: 'src/a.ts', changeCount: 2 },
			{ relativePath: 'src/b.ts', changeCount: 1 },
		]),
		3,
	);
});

test('timeline model derives the pending selection range from the anchored start and hovered end', () => {
	const visibleEntries = [
		makeEntry({ index: 1, revision: 'a' }),
		makeEntry({ index: 4, revision: 'b' }),
		makeEntry({ index: 9, revision: 'c' }),
	];

	assert.deepEqual(getPendingSelectionRange(visibleEntries, 9, 4), {
		fromEntry: visibleEntries[1],
		toEntry: visibleEntries[2],
		selectedCount: 2,
	});
	assert.equal(getPendingSelectionRange(visibleEntries, 4, 4), null);
	assert.equal(getPendingSelectionRange(visibleEntries, null, 4), null);
});

test('timeline model formats the in-between toggle label with visible and total counts', () => {
	assert.equal(getIntermediateToggleLabel(5, 9, false), 'Show In-Between 5/9');
	assert.equal(getIntermediateToggleLabel(9, 9, true), 'Hide In-Between 9/9');
	assert.equal(getIntermediateToggleLabel(0, 0, false), 'Show In-Between');
});

test('timeline model positions anchors with equal spacing across visible entries', () => {
	const visibleEntries = [
		makeEntry({ index: 0, timestamp: 100 }),
		makeEntry({ index: 1, timestamp: 190 }),
		makeEntry({ index: 2, timestamp: 200 }),
	];

	assert.equal(getTimelineAnchorPercent(visibleEntries, 0), 0);
	assert.equal(getTimelineAnchorPercent(visibleEntries, 2), 100);
	assert.equal(getTimelineAnchorPercent(visibleEntries, 1), 50);
});

test('timeline model prioritizes selected changes when choosing pending snapshot hydration batches', () => {
	const revisionEntries = [
		makeEntry({ index: 0, changeId: 'aaa', touchesFile: true }),
		makeEntry({ index: 1, changeId: 'bbb', touchesFile: true }),
		makeEntry({ index: 2, changeId: 'ccc', touchesFile: true }),
		makeEntry({ index: 3, changeId: 'ddd', touchesFile: true, isWorkingTree: true }),
	];

	assert.deepEqual(getPendingSnapshotRevisionIndexes(revisionEntries, new Set(['aaa']), 2, [2]), [2, 1]);
});

test('timeline model builds sidebar preview requests for uncached unit ranges', () => {
	const visibleEntries = [1, 2, 3, 4].map((index) => makeEntry({ index }));
	const previewByRange = { 'revision:1:2': { additions: 1 } } as Record<string, unknown>;
	assert.deepEqual(
		getSidebarPreviewRequests(
			visibleEntries,
			'revision',
			previewByRange as never,
			'revision:2:3',
			(fromIndex, toIndex, source) => `${source}:${fromIndex}:${toIndex}`,
		),
		[{ key: 'revision:3:4', fromIndex: 3, toIndex: 4, comparisonSource: 'revision' }],
	);
});

test('normalizeTimelinePreferences restores missing values to the persisted defaults', () => {
	assert.deepEqual(normalizeTimelinePreferences({ sidebarCollapsed: true, comparisonSource: 'snapshot' }), {
		sidebarWidth: 276,
		sidebarCollapsed: true,
		timelinePaneHeight: 220,
		timelinePaneCollapsed: false,
		layoutMode: 'split',
		contentMode: 'diffs',
		comparisonMode: 'range',
		comparisonSource: 'snapshot',
		showIntermediateRevisions: false,
		preset: 'year',
		customRevset: '',
		themePreference: 'auto',
		heatmapOpen: false,
	});
});
