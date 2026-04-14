import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
	normalizeSnapshotOperationKey,
	parseJjEvolutionSummaryEntries,
	parseJjSummaryChangedPaths,
	toJjRootFileFileset,
} from '../../src/shared/history-helpers.ts';
import type {
	ComparisonSource,
	DiffPreview,
	DiffRow,
	FileRevisionEntry,
	HistoryBackend,
	TimelineFixture,
	TimelineFixtureFile,
	TimelinePreferences,
} from '../../src/shared/timeline-types.ts';

type EvolutionSummaryEntry = ReturnType<typeof parseJjEvolutionSummaryEntries>[number];

type FixtureEntry = FileRevisionEntry & {
	index: number;
};

type RepositoryFixture = TimelineFixture & {
	files: Record<string, TimelineFixtureFile>;
};

type PreviewMap = Record<string, DiffPreview>;

type BuildEntryArgs = {
	id: string;
	index: number;
	revision: string;
	shortRevision: string;
	changeId?: string;
	authorDate: string;
	authorName: string;
	description: string;
	touchesFile: boolean;
	isWorkingTree: boolean;
	filePath: string;
};

type StableEntryOverrides = Partial<Pick<FixtureEntry, 'changeId' | 'shortRevision' | 'authorDate' | 'authorName'>>;

type RunResult = {
	stdout: string;
	stderr: string;
};

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const runtimeDir = path.join(rootDir, '.e2e-runtime');
const reposDir = path.join(runtimeDir, 'repos');
const outputDir = path.join(rootDir, 'webview', 'public', 'e2e');
const defaultRelativeFilePath = 'apps/backend/instructions/lazy-di-rollout-plan.md';
const secondaryRelativeFilePath = 'apps/backend/src/service.ts';
const trackedFilePaths = [defaultRelativeFilePath, secondaryRelativeFilePath];
const remoteBaseUrl = 'https://github.com/astahmer/visualjj-range-diff-helper';
const stableJjMutableChangeId = 'xooxvqzo';
const stableJjMutableShortRevisions = ['xooxvqzo/1', 'xooxvqzo/3'];
const stableJjMutableAuthorDates = ['2026-04-12T19:19:09+02:00', '2026-04-12T19:20:09+02:00'];
const stableJjMutableAuthorName = 'alexandre.stahmer@gmail.com';
const stableJjWorkingTreeAuthorDate = '2026-04-12T19:20:09+02:00';
const stableJjWorkingTreeAuthorName = 'Alexandre Stahmer';
const displayLocale = 'en-US';
const displayTimeZone = 'Europe/Paris';
const monthFormatter = new Intl.DateTimeFormat(displayLocale, { month: 'long', timeZone: displayTimeZone });
const shortDateFormatter = new Intl.DateTimeFormat(displayLocale, {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
	timeZone: displayTimeZone,
});
const subtitleDateFormatter = new Intl.DateTimeFormat(displayLocale, {
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit',
	second: '2-digit',
	hour12: true,
	timeZone: displayTimeZone,
});
const revisionTouchedPathsCache: Record<HistoryBackend, Map<string, Promise<Set<string>>>> = {
	git: new Map<string, Promise<Set<string>>>(),
	jj: new Map<string, Promise<Set<string>>>(),
};
const entryContentCache = new Map<string, Promise<string>>();
const jjEvolutionSummaryCache = new Map<string, Promise<EvolutionSummaryEntry[]>>();

await fs.rm(runtimeDir, { recursive: true, force: true });
await fs.mkdir(reposDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });

const [gitFixture, jjFixture] = await Promise.all([generateGitFixture(), generateJjFixture()]);
await fs.writeFile(path.join(outputDir, 'git-basic.json'), JSON.stringify(gitFixture, null, 2) + '\n');
await fs.writeFile(path.join(outputDir, 'jj-basic.json'), JSON.stringify(jjFixture, null, 2) + '\n');

async function generateGitFixture(): Promise<RepositoryFixture> {
	const repoDir = path.join(reposDir, 'git-basic');
	await fs.mkdir(repoDir, { recursive: true });
	await run('git', ['init'], repoDir);
	await run('git', ['config', 'user.name', 'Fixture User'], repoDir);
	await run('git', ['config', 'user.email', 'fixture@example.com'], repoDir);

	await commit(repoDir, '2026-04-08T10:00:00Z', 'initial workspace', {
		[defaultRelativeFilePath]: buildPlanContent('Initial revision', 'alpha line', 'Capture the initial rollout notes.'),
		[secondaryRelativeFilePath]: buildServiceContent('alpha', 'Bootstrap service wiring.'),
	});

	await commit(repoDir, '2026-04-08T11:00:00Z', 'unrelated note', {
		'notes/todo.txt': 'unrelated note\n',
	});

	await commit(repoDir, '2026-04-09T10:00:00Z', 'plan refinement', {
		[defaultRelativeFilePath]: buildPlanContent('Second revision', 'beta line', 'Refine the plan for the next review.'),
	});

	await commit(repoDir, '2026-04-09T16:00:00Z', 'service extraction', {
		[secondaryRelativeFilePath]: buildServiceContent('beta', 'Extract the service helper into its own file.'),
	});

	await commit(repoDir, '2026-04-10T10:00:00Z', 'finalized rollout', {
		[defaultRelativeFilePath]: buildPlanContent('Third revision', 'gamma line', 'Finalize the rollout checklist.'),
	});

	await writeFiles(repoDir, {
		[defaultRelativeFilePath]: buildPlanContent('Working tree', 'delta line', 'Uncommitted plan changes.'),
		[secondaryRelativeFilePath]: buildServiceContent('gamma', 'Local service tweaks that are not committed yet.'),
	});

	return buildRepositoryFixture(repoDir, 'git');
}

async function generateJjFixture(): Promise<RepositoryFixture> {
	const repoDir = path.join(reposDir, 'jj-basic');
	await fs.mkdir(repoDir, { recursive: true });
	await run('jj', ['git', 'init', '--colocate', repoDir], rootDir);
	await run('git', ['config', 'user.name', 'Fixture User'], repoDir);
	await run('git', ['config', 'user.email', 'fixture@example.com'], repoDir);

	await commit(repoDir, '2026-04-08T10:00:00Z', 'initial workspace', {
		[defaultRelativeFilePath]: buildPlanContent('Initial revision', 'alpha line', 'Capture the initial rollout notes.'),
		[secondaryRelativeFilePath]: buildServiceContent('alpha', 'Bootstrap service wiring.'),
	});

	await commit(repoDir, '2026-04-08T11:00:00Z', 'unrelated note', {
		'notes/todo.txt': 'unrelated note\n',
	});

	await commit(repoDir, '2026-04-09T10:00:00Z', 'plan refinement', {
		[defaultRelativeFilePath]: buildPlanContent('Second revision', 'beta line', 'Refine the plan for the next review.'),
	});

	await commit(repoDir, '2026-04-09T16:00:00Z', 'service extraction', {
		[secondaryRelativeFilePath]: buildServiceContent('beta', 'Extract the service helper into its own file.'),
	});

	await writeFiles(repoDir, {
		[defaultRelativeFilePath]: buildPlanContent('Snapshot draft', 'gamma line', 'First mutable JJ snapshot.'),
		[secondaryRelativeFilePath]: buildServiceContent('gamma', 'First mutable JJ snapshot for the service helper.'),
	});
	await run('jj', ['describe', '-m', 'snapshot working copy'], repoDir);

	await writeFiles(repoDir, {
		[defaultRelativeFilePath]: buildPlanContent('Snapshot refinement', 'epsilon line', 'Second mutable JJ snapshot.'),
		[secondaryRelativeFilePath]: buildServiceContent('epsilon', 'Second mutable JJ snapshot for the service helper.'),
	});
	await run('jj', ['describe', '-m', 'snapshot working copy'], repoDir);

	await run('jj', ['commit', '-m', 'snapshot working copy'], repoDir);

	await writeFiles(repoDir, {
		[defaultRelativeFilePath]: buildPlanContent('Working tree', 'zeta line', 'Uncommitted JJ working tree changes.'),
		[secondaryRelativeFilePath]: buildServiceContent('zeta', 'Uncommitted JJ working tree service changes.'),
	});

	return stabilizeJjFixture(await buildRepositoryFixture(repoDir, 'jj'), repoDir);
}

async function buildRepositoryFixture(repoDir: string, backend: HistoryBackend): Promise<RepositoryFixture> {
	const workspaceFiles = await getWorkspaceFiles(repoDir);
	const fileEntries: Array<[string, TimelineFixtureFile]> = await Promise.all(
		trackedFilePaths.map(async (relativePath) => {
			const fileFixture = await buildFileFixture(repoDir, backend, relativePath, workspaceFiles);
			return [relativePath, fileFixture];
		}),
	);
	const files = toRecord(fileEntries);
	const primaryFileFixture = files[defaultRelativeFilePath];
	if (!primaryFileFixture) {
		throw new Error(`Missing primary fixture file for ${defaultRelativeFilePath}`);
	}

	return {
		...primaryFileFixture,
		files,
	};
}

async function stabilizeJjFixture(fixture: RepositoryFixture, repoDir: string): Promise<RepositoryFixture> {
	const fileFixtures = Object.values(fixture.files);

	for (const fileFixture of fileFixtures) {
		await stabilizeJjFileFixture(fileFixture, repoDir);
	}

	const primaryFileFixture = fixture.files?.[defaultRelativeFilePath];
	if (primaryFileFixture) {
		fixture.timelineData = primaryFileFixture.timelineData;
		fixture.previews = primaryFileFixture.previews;
	}

	return fixture;
}

async function stabilizeJjFileFixture(fileFixture: TimelineFixtureFile, repoDir: string): Promise<void> {
	const workingTreeEntry = fileFixture.timelineData.entries.find((entry) => entry.isWorkingTree);
	const mutableRevisionEntry = fileFixture.timelineData.entries.find(
		(entry) => !entry.isWorkingTree && entry.description === 'snapshot working copy' && entry.changeId,
	);
	const mutableChangeId = mutableRevisionEntry?.changeId;
	const fallbackMutableAuthorDate =
		stableJjMutableAuthorDates[stableJjMutableAuthorDates.length - 1] || stableJjWorkingTreeAuthorDate;

	if (mutableRevisionEntry) {
		applyStableEntryMetadata(mutableRevisionEntry, {
			changeId: stableJjMutableChangeId,
			shortRevision: stableJjMutableChangeId,
			authorDate: stableJjWorkingTreeAuthorDate,
			authorName: stableJjWorkingTreeAuthorName,
		});
	}

	if (workingTreeEntry) {
		applyStableEntryMetadata(workingTreeEntry, {
			authorDate: stableJjWorkingTreeAuthorDate,
			authorName: stableJjWorkingTreeAuthorName,
		});
	}

	const mutableSnapshotEntries = fileFixture.timelineData.snapshotEntries.filter(
		(entry) => !mutableChangeId || entry.changeId === mutableChangeId,
	);
	mutableSnapshotEntries
		.toSorted((left, right) => (left.index ?? 0) - (right.index ?? 0))
		.forEach((entry, index) => {
			applyStableEntryMetadata(entry, {
				changeId: stableJjMutableChangeId,
				shortRevision: stableJjMutableShortRevisions[index] || `${stableJjMutableChangeId}/${index + 1}`,
				authorDate: stableJjMutableAuthorDates[index] || fallbackMutableAuthorDate,
				authorName: stableJjMutableAuthorName,
			});
		});

	if (fileFixture.timelineData.snapshotState?.loadedChangeIds) {
		fileFixture.timelineData.snapshotState.loadedChangeIds = fileFixture.timelineData.snapshotState.loadedChangeIds.map(
			(changeId) => (changeId === mutableChangeId ? stableJjMutableChangeId : changeId),
		);
	}

	const snapshotSourceEntries = composeSnapshotEntries(
		fileFixture.timelineData.entries,
		fileFixture.timelineData.snapshotEntries,
		new Set(fileFixture.timelineData.snapshotState?.loadedChangeIds || []),
	);

	fileFixture.previews = {
		revision: await buildPreviewMap(
			repoDir,
			fileFixture.timelineData.entries,
			'jj',
			fileFixture.timelineData.relativePath,
			'revision',
		),
		snapshot: await buildPreviewMap(
			repoDir,
			snapshotSourceEntries,
			'jj',
			fileFixture.timelineData.relativePath,
			'snapshot',
		),
	};
}

function applyStableEntryMetadata(entry: FileRevisionEntry, overrides: StableEntryOverrides): void {
	const authorDate = overrides.authorDate || entry.authorDate;
	const timestamp = Date.parse(authorDate);
	Object.assign(entry, overrides, {
		authorDate,
		timestamp,
		monthLabel: monthFormatter.format(timestamp),
		shortDate: shortDateFormatter.format(timestamp),
		relativeDate: relativeTime(timestamp),
	});
}

async function buildFileFixture(
	repoDir: string,
	backend: HistoryBackend,
	relativePath: string,
	workspaceFiles: string[],
): Promise<TimelineFixtureFile> {
	const entries =
		backend === 'jj' ? await getJjEntries(repoDir, relativePath) : await getGitEntries(repoDir, relativePath);
	const snapshotEntries = backend === 'jj' ? await getJjSnapshotEntries(repoDir, relativePath, entries) : [];
	const loadedChangeIds =
		backend === 'jj' ? [...new Set(entries.map((entry) => entry.changeId).filter(isDefined))] : [];
	const snapshotSourceEntries =
		backend === 'jj' ? composeSnapshotEntries(entries, snapshotEntries, new Set(loadedChangeIds)) : entries;
	const preferences: TimelinePreferences = {
		sidebarWidth: 280,
		layoutMode: 'split',
		contentMode: 'diffs',
		comparisonMode: 'range',
		comparisonSource: backend === 'jj' ? 'snapshot' : 'revision',
		preset: '90d',
		showIntermediateRevisions: true,
	};

	return {
		timelineData: {
			backend,
			workspacePath: repoDir,
			relativePath,
			fileName: path.basename(relativePath),
			version: '0.0.2',
			presets: { year: 365, '7d': 7, '30d': 30, '90d': 90, all: Number.POSITIVE_INFINITY },
			defaultIndex: entries.length - 1,
			latestIndex: entries.length - 1,
			preferences,
			workspaceFiles,
			hasIntermediateRevisions: entries.some((entry) => !entry.touchesFile),
			entries,
			snapshotEntries,
			snapshotState: {
				loadedChangeIds,
			},
		},
		previews: {
			revision: await buildPreviewMap(repoDir, entries, backend, relativePath, 'revision'),
			snapshot:
				backend === 'jj'
					? await buildPreviewMap(repoDir, snapshotSourceEntries, backend, relativePath, 'snapshot')
					: await buildPreviewMap(repoDir, entries, backend, relativePath, 'revision'),
		},
	};
}

async function getGitEntries(repoDir: string, relativePath: string): Promise<FixtureEntry[]> {
	const entries = await getGitHistoryEntries(repoDir, relativePath);
	const workingTreeEntry = await makeWorkingTreeEntry(repoDir, entries.at(-1), relativePath, 'git');
	if (workingTreeEntry) {
		entries.push(workingTreeEntry);
	}

	return reindexEntries(entries);
}

async function getGitHistoryEntries(repoDir: string, relativePath: string): Promise<FixtureEntry[]> {
	const { stdout } = await run('git', ['log', '--reverse', '--format=%H%x09%cI%x09%an%x09%s'], repoDir);
	const revisions = stdout.trim().split(/\r?\n/).filter(Boolean);

	return Promise.all(
		revisions.map(async (line, index) => {
			const [revision, authorDate, authorName, description] = line.split('\t');
			const touchesFile = await gitTouchesFile(repoDir, revision, relativePath);
			return makeEntry({
				id: revision,
				index,
				revision,
				shortRevision: revision.slice(0, 8),
				changeId: undefined,
				authorDate,
				authorName,
				description,
				touchesFile,
				isWorkingTree: false,
				filePath: relativePath,
			});
		}),
	);
}

async function getJjEntries(repoDir: string, relativePath: string): Promise<FixtureEntry[]> {
	const template = [
		'commit_id.short()',
		'"\\t"',
		'change_id.shortest()',
		'"\\t"',
		'author.timestamp().format("%Y-%m-%dT%H:%M:%S%:z")',
		'"\\t"',
		'author.name()',
		'"\\t"',
		'description.first_line()',
		'"\\n"',
	].join(' ++ ');
	const { stdout } = await run('jj', ['log', '--no-graph', '--reversed', '--limit', '100', '-T', template], repoDir);
	const revisions = stdout.trim().split(/\r?\n/).filter(Boolean);
	const entries: Array<FixtureEntry | null> = await Promise.all(
		revisions.map(async (line, index) => {
			const [revision, changeId, authorDate, authorName, description] = line.split('\t');
			if (/^0+$/u.test(revision)) {
				return null;
			}

			const touchesFile = await jjTouchesFile(repoDir, revision, relativePath);
			return makeEntry({
				id: revision,
				index,
				revision,
				shortRevision: changeId || revision.slice(0, 8),
				changeId: changeId || undefined,
				authorDate,
				authorName,
				description,
				touchesFile,
				isWorkingTree: false,
				filePath: relativePath,
			});
		}),
	);
	const filteredEntries = entries.filter(isDefined);

	const lastEntry = filteredEntries.at(-1);
	if (lastEntry && (!lastEntry.description || lastEntry.description === '')) {
		lastEntry.revision = 'WORKTREE';
		lastEntry.shortRevision = 'Current';
		lastEntry.description = 'Working tree';
		lastEntry.isWorkingTree = true;
		lastEntry.changeId = undefined;
		lastEntry.remoteUrl = undefined;
	}

	const workingTreeEntry = await makeWorkingTreeEntry(repoDir, filteredEntries.at(-1), relativePath, 'jj');
	if (workingTreeEntry) {
		filteredEntries.push(workingTreeEntry);
	}

	return reindexEntries(filteredEntries);
}

async function getJjSnapshotEntries(
	repoDir: string,
	relativePath: string,
	revisionEntries: FixtureEntry[],
): Promise<FixtureEntry[]> {
	const snapshotEntryGroups = await Promise.all(
		revisionEntries.map(async (entry) => {
			if (!entry.changeId || entry.isWorkingTree || !entry.touchesFile) {
				return [];
			}

			const evolutionEntries = await getJjEvolutionEntries(repoDir, entry.revision);

			return evolutionEntries
				.filter((evolutionEntry) => parseJjSummaryChangedPaths(evolutionEntry.summaryLines).includes(relativePath))
				.map((evolutionEntry) =>
					makeEntry({
						id: `snapshot:${evolutionEntry.operationId || evolutionEntry.changeKey || evolutionEntry.revision}`,
						index: 0,
						revision: evolutionEntry.revision,
						shortRevision:
							normalizeSnapshotOperationKey(evolutionEntry.changeKey) || evolutionEntry.revision.slice(0, 8),
						changeId: entry.changeId,
						authorDate: normalizeSnapshotAuthorDate(evolutionEntry.authorDate, entry.authorDate),
						authorName: evolutionEntry.authorName || entry.authorName,
						description: normalizeSnapshotDescription(evolutionEntry.description, evolutionEntry.operationDescription),
						touchesFile: true,
						isWorkingTree: false,
						filePath: relativePath,
					}),
				);
		}),
	);
	const snapshotEntries = snapshotEntryGroups.flat();

	snapshotEntries.sort(
		(left, right) => left.timestamp - right.timestamp || left.revision.localeCompare(right.revision),
	);
	return reindexEntries(snapshotEntries);
}

function composeSnapshotEntries(
	revisionEntries: FileRevisionEntry[],
	snapshotEntries: FileRevisionEntry[],
	loadedChangeIds: Set<string>,
): FileRevisionEntry[] {
	if (!loadedChangeIds.size) {
		return revisionEntries;
	}

	const snapshotEntriesByChangeId = snapshotEntries.reduce<Map<string, FileRevisionEntry[]>>((groups, entry) => {
		if (!entry.changeId) {
			return groups;
		}

		const existing = groups.get(entry.changeId) || [];
		existing.push(entry);
		groups.set(entry.changeId, existing);
		return groups;
	}, new Map<string, FileRevisionEntry[]>());

	return reindexEntries(
		revisionEntries.flatMap((entry) => {
			if (!entry.changeId || entry.isWorkingTree || !entry.touchesFile || !loadedChangeIds.has(entry.changeId)) {
				return [entry];
			}

			return snapshotEntriesByChangeId.get(entry.changeId) || [entry];
		}),
	);
}

async function buildPreviewMap(
	repoDir: string,
	entries: FileRevisionEntry[],
	backend: HistoryBackend,
	relativePath: string,
	comparisonSource: ComparisonSource,
	contentCache = entryContentCache,
): Promise<PreviewMap> {
	const previews: PreviewMap = {};
	const entryContents = await Promise.all(
		entries.map((entry) => getEntryContent(repoDir, backend, entry, relativePath, contentCache)),
	);

	for (let toIndex = 1; toIndex < entries.length; toIndex += 1) {
		for (let fromIndex = 0; fromIndex < toIndex; fromIndex += 1) {
			previews[`${fromIndex}:${toIndex}`] = buildPreview(entries, entryContents, comparisonSource, fromIndex, toIndex);
		}
	}

	return previews;
}

function buildPreview(
	entries: FileRevisionEntry[],
	entryContents: string[],
	comparisonSource: ComparisonSource,
	fromIndex: number,
	toIndex: number,
): DiffPreview {
	const fromEntry = entries[fromIndex];
	const toEntry = entries[toIndex];
	const beforeText = entryContents[fromIndex] || '';
	const afterText = entryContents[toIndex] || '';
	const rows = buildRows(beforeText, afterText);
	const additions = rows.filter((row) => row.type === 'add').length;
	const deletions = rows.filter((row) => row.type === 'remove').length;
	const hunkCount = rows.some((row) => row.type === 'add' || row.type === 'remove') ? 1 : 0;

	return {
		index: toIndex,
		title: `${fromEntry.shortRevision} -> ${toEntry.shortRevision}`,
		subtitle: toEntry.isWorkingTree
			? 'Working tree'
			: `${subtitleDateFormatter.format(new Date(toEntry.authorDate))} · ${toEntry.description}`,
		diffCount: 0,
		additions,
		deletions,
		hunkCount,
		hasChanges: additions > 0 || deletions > 0,
		fromIndex,
		toIndex,
		comparisonSource,
		rows,
		nonTextualDetails: [],
	};
}

async function getEntryContent(
	repoDir: string,
	backend: HistoryBackend,
	entry: FileRevisionEntry,
	relativePath: string,
	contentCache = entryContentCache,
): Promise<string> {
	const cacheKey = `${backend}:${entry.revision}:${relativePath}`;
	const cached = contentCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const contentPromise: Promise<string> = entry.isWorkingTree
		? fs.readFile(path.join(repoDir, relativePath), 'utf8')
		: backend === 'jj'
			? showJjFileAtRevision(repoDir, entry.revision, relativePath)
			: showGitFileAtRevision(repoDir, entry.revision, relativePath);
	contentCache.set(cacheKey, contentPromise);

	try {
		return await contentPromise;
	} catch (error) {
		contentCache.delete(cacheKey);
		throw error;
	}
}

async function showGitFileAtRevision(repoDir: string, revision: string, relativePath: string): Promise<string> {
	try {
		const { stdout } = await run('git', ['show', `${revision}:${relativePath}`], repoDir);
		return stdout;
	} catch (error) {
		if (isMissingFileAtRevisionError(error)) {
			return '';
		}
		throw error;
	}
}

async function showJjFileAtRevision(repoDir: string, revision: string, relativePath: string): Promise<string> {
	try {
		const { stdout } = await run('jj', ['file', 'show', '-r', revision, toJjRootFileFileset(relativePath)], repoDir);
		return stdout;
	} catch (error) {
		if (isMissingFileAtRevisionError(error)) {
			return '';
		}
		throw error;
	}
}

function buildRows(beforeText: string, afterText: string): DiffRow[] {
	const beforeLines = splitLines(beforeText);
	const afterLines = splitLines(afterText);
	if (beforeText === afterText) {
		return buildContextRows(afterLines);
	}

	let start = 0;
	while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
		start += 1;
	}

	let endBefore = beforeLines.length - 1;
	let endAfter = afterLines.length - 1;
	while (endBefore >= start && endAfter >= start && beforeLines[endBefore] === afterLines[endAfter]) {
		endBefore -= 1;
		endAfter -= 1;
	}

	const rows: DiffRow[] = [];
	rows.push(...buildContextRows(beforeLines.slice(0, start), 0, 0));
	for (let index = start; index <= endBefore; index += 1) {
		rows.push({ type: 'remove', leftNumber: index + 1, rightNumber: null, text: beforeLines[index] });
	}
	for (let index = start; index <= endAfter; index += 1) {
		rows.push({ type: 'add', leftNumber: null, rightNumber: index + 1, text: afterLines[index] });
	}

	const trailingContext = afterLines.slice(endAfter + 1);
	rows.push(...buildContextRows(trailingContext, endBefore + 1, endAfter + 1));
	return rows;
}

function buildContextRows(lines: string[], leftOffset = 0, rightOffset = 0): DiffRow[] {
	if (lines.length <= 6) {
		return lines.map((line, index) => ({
			type: 'context' as const,
			leftNumber: leftOffset + index + 1,
			rightNumber: rightOffset + index + 1,
			text: line,
		}));
	}

	const head: DiffRow[] = lines.slice(0, 3).map((line, index) => ({
		type: 'context',
		leftNumber: leftOffset + index + 1,
		rightNumber: rightOffset + index + 1,
		text: line,
	}));
	const tail: DiffRow[] = lines.slice(-3).map((line, index) => ({
		type: 'context',
		leftNumber: leftOffset + lines.length - 3 + index + 1,
		rightNumber: rightOffset + lines.length - 3 + index + 1,
		text: line,
	}));

	return [
		...head,
		{ type: 'skip', leftNumber: null, rightNumber: null, text: `Show ${lines.length - 6} unchanged lines` },
		...tail,
	];
}

function splitLines(value: string): string[] {
	const normalized = value.replace(/\r\n/g, '\n');
	if (!normalized) {
		return [];
	}

	return normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n') : normalized.split('\n');
}

async function gitTouchesFile(repoDir: string, revision: string, relativePath: string): Promise<boolean> {
	return (await getGitTouchedPaths(repoDir, revision)).has(relativePath);
}

async function jjTouchesFile(repoDir: string, revision: string, relativePath: string): Promise<boolean> {
	return (await getJjTouchedPaths(repoDir, revision)).has(relativePath);
}

async function getWorkspaceFiles(repoDir: string): Promise<string[]> {
	const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], repoDir);
	return stdout
		.split(/\r?\n/)
		.filter(Boolean)
		.toSorted((a, b) => a.localeCompare(b));
}

async function makeWorkingTreeEntry(
	repoDir: string,
	previousEntry: FileRevisionEntry | undefined,
	relativePath: string,
	backend: HistoryBackend,
): Promise<FixtureEntry | null> {
	const content = await fs.readFile(path.join(repoDir, relativePath), 'utf8');
	const previousContent = previousEntry ? await getEntryContent(repoDir, backend, previousEntry, relativePath) : '';
	if (content === previousContent) {
		return null;
	}

	return makeEntry({
		id: `working-tree:${relativePath}`,
		index: (previousEntry?.index ?? -1) + 1,
		revision: 'WORKTREE',
		shortRevision: 'Current',
		changeId: undefined,
		authorDate: '2026-04-11T12:00:00Z',
		authorName: 'Fixture User',
		description: 'Working tree',
		touchesFile: true,
		isWorkingTree: true,
		filePath: relativePath,
	});
}

function makeEntry({
	id,
	index,
	revision,
	shortRevision,
	changeId,
	authorDate,
	authorName,
	description,
	touchesFile,
	isWorkingTree,
	filePath,
}: BuildEntryArgs): FixtureEntry {
	const timestamp = Date.parse(authorDate);
	return {
		id,
		index,
		revision,
		shortRevision,
		changeId,
		authorDate,
		authorName,
		description: description || '',
		isWorkingTree,
		touchesFile,
		timestamp,
		filePath,
		monthLabel: monthFormatter.format(timestamp),
		shortDate: shortDateFormatter.format(timestamp),
		relativeDate: relativeTime(timestamp),
		hasPreviousEntry: index > 0,
		remoteUrl: isWorkingTree ? undefined : `${remoteBaseUrl}/commit/${revision}`,
	};
}

function reindexEntries(entries: FileRevisionEntry[]): FixtureEntry[] {
	return entries.map((entry, index) => ({
		...entry,
		index,
		hasPreviousEntry: index > 0,
	}));
}

function normalizeSnapshotAuthorDate(authorDate: string | undefined, fallbackAuthorDate: string): string {
	const value = String(authorDate || '').trim();
	if (value && !Number.isNaN(Date.parse(value))) {
		return value;
	}

	return fallbackAuthorDate;
}

function normalizeSnapshotDescription(
	description: string | undefined,
	operationDescription: string | undefined,
): string {
	const trimmed = String(description || '').trim();
	if (!trimmed || trimmed === '(no description set)' || trimmed === '(empty) (no description set)') {
		return operationDescription || 'Snapshot';
	}

	return trimmed;
}

function relativeTime(timestamp: number): string {
	const now = Date.parse('2026-04-11T12:00:00Z');
	const hours = Math.round((now - timestamp) / (1000 * 60 * 60));
	if (hours <= 1) {
		return 'this minute';
	}
	if (hours < 36) {
		return 'yesterday';
	}
	return `${Math.round(hours / 24)} days ago`;
}

async function commit(repoDir: string, date: string, message: string, files: Record<string, string>) {
	await writeFiles(repoDir, files);
	await run('git', ['add', '.'], repoDir);
	await run('git', ['commit', '-m', message], repoDir, {
		GIT_AUTHOR_DATE: date,
		GIT_COMMITTER_DATE: date,
	});
}

async function writeFiles(repoDir: string, files: Record<string, string>) {
	await Promise.all(
		Object.entries(files).map(async ([relativePath, content]) => {
			const targetPath = path.join(repoDir, relativePath);
			await fs.mkdir(path.dirname(targetPath), { recursive: true });
			await fs.writeFile(targetPath, content);
		}),
	);
}

function buildPlanContent(title: string, line: string, note: string): string {
	return `## ${title}\n\n1. Inventory\n${line}\n\n2. Notes\n${note}\n`;
}

function buildServiceContent(version: string, note: string): string {
	return [
		'export function buildServiceLabel() {',
		`  return '${version}';`,
		'}',
		'',
		`export const serviceNote = '${note}';`,
		'',
	].join('\n');
}

function isMissingFileAtRevisionError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		/exists on disk, but not in/i.test(message) ||
		/path .* does not exist in/i.test(message) ||
		/no such path/i.test(message) ||
		/no matching entries/i.test(message) ||
		/No such file or directory/i.test(message)
	);
}

async function run(
	command: 'git' | 'jj',
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv = {},
): Promise<RunResult> {
	return execFileAsync(command, args, {
		cwd,
		env: {
			...process.env,
			...env,
		},
	});
}

async function getJjEvolutionEntries(repoDir: string, revision: string): Promise<EvolutionSummaryEntry[]> {
	const cacheKey = `${repoDir}:${revision}`;
	let cached = jjEvolutionSummaryCache.get(cacheKey);
	if (!cached) {
		cached = run('jj', ['evolog', '--no-graph', '--summary', '--limit', '100', '-r', revision], repoDir)
			.then(({ stdout }) => parseJjEvolutionSummaryEntries(stdout))
			.catch(() => []);
		jjEvolutionSummaryCache.set(cacheKey, cached);
	}

	return cached;
}

async function getGitTouchedPaths(repoDir: string, revision: string): Promise<Set<string>> {
	const cacheKey = `${repoDir}:${revision}`;
	let cached = revisionTouchedPathsCache.git.get(cacheKey);
	if (!cached) {
		cached = run('git', ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', revision], repoDir).then(
			({ stdout }) => parseTouchedPaths(stdout),
		);
		revisionTouchedPathsCache.git.set(cacheKey, cached);
	}

	return cached;
}

async function getJjTouchedPaths(repoDir: string, revision: string): Promise<Set<string>> {
	const cacheKey = `${repoDir}:${revision}`;
	let cached = revisionTouchedPathsCache.jj.get(cacheKey);
	if (!cached) {
		cached = run('jj', ['diff', '--name-only', '-r', revision], repoDir).then(({ stdout }) =>
			parseTouchedPaths(stdout),
		);
		revisionTouchedPathsCache.jj.set(cacheKey, cached);
	}

	return cached;
}

function parseTouchedPaths(stdout: string): Set<string> {
	return new Set(
		stdout
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean),
	);
}

function isDefined<T>(value: T | null | undefined): value is T {
	return value !== null && value !== undefined;
}

function toRecord<K extends string, V>(entries: Array<readonly [K, V]>): Record<K, V> {
	return Object.fromEntries(entries) as Record<K, V>;
}
