import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
	normalizeSnapshotOperationKey,
	parseJjEvolutionSummaryEntries,
	parseJjSummaryChangedPaths,
} from '../../src/shared/history-helpers.ts';

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
const revisionTouchedPathsCache = {
	git: new Map<string, Promise<Set<string>>>(),
	jj: new Map<string, Promise<Set<string>>>(),
};
const entryContentCache = new Map<string, Promise<string>>();
const jjEvolutionSummaryCache = new Map<string, Promise<ReturnType<typeof parseJjEvolutionSummaryEntries>>>();

await fs.rm(runtimeDir, { recursive: true, force: true });
await fs.mkdir(reposDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });

const [gitFixture, jjFixture] = await Promise.all([generateGitFixture(), generateJjFixture()]);
await fs.writeFile(path.join(outputDir, 'git-basic.json'), JSON.stringify(gitFixture, null, 2) + '\n');
await fs.writeFile(path.join(outputDir, 'jj-basic.json'), JSON.stringify(jjFixture, null, 2) + '\n');

async function generateGitFixture() {
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

async function generateJjFixture() {
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

async function buildRepositoryFixture(repoDir, backend) {
	const workspaceFiles = await getWorkspaceFiles(repoDir);
	const fileEntries = await Promise.all(
		trackedFilePaths.map(async (relativePath) => {
			const fileFixture = await buildFileFixture(repoDir, backend, relativePath, workspaceFiles);
			return [relativePath, fileFixture];
		}),
	);
	const files = Object.fromEntries(fileEntries);

	return {
		...files[defaultRelativeFilePath],
		files,
	};
}

async function stabilizeJjFixture(fixture, repoDir) {
	const fileFixtures = Object.values(fixture.files || {});

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

async function stabilizeJjFileFixture(fileFixture, repoDir) {
	const workingTreeEntry = fileFixture.timelineData.entries.find((entry) => entry.isWorkingTree);
	const mutableRevisionEntry = fileFixture.timelineData.entries.find(
		(entry) => !entry.isWorkingTree && entry.description === 'snapshot working copy' && entry.changeId,
	);
	const mutableChangeId = mutableRevisionEntry?.changeId;

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
		.toSorted((left, right) => left.index - right.index)
		.forEach((entry, index) => {
			applyStableEntryMetadata(entry, {
				changeId: stableJjMutableChangeId,
				shortRevision: stableJjMutableShortRevisions[index] || `${stableJjMutableChangeId}/${index + 1}`,
				authorDate: stableJjMutableAuthorDates[index] || stableJjMutableAuthorDates.at(-1),
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

function applyStableEntryMetadata(entry, overrides) {
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

async function buildFileFixture(repoDir, backend, relativePath, workspaceFiles) {
	const entries =
		backend === 'jj' ? await getJjEntries(repoDir, relativePath) : await getGitEntries(repoDir, relativePath);
	const snapshotEntries = backend === 'jj' ? await getJjSnapshotEntries(repoDir, relativePath, entries) : [];
	const loadedChangeIds = backend === 'jj' ? [...new Set(entries.map((entry) => entry.changeId).filter(Boolean))] : [];
	const snapshotSourceEntries =
		backend === 'jj' ? composeSnapshotEntries(entries, snapshotEntries, new Set(loadedChangeIds)) : entries;

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
			preferences: {
				sidebarWidth: 280,
				layoutMode: 'split',
				contentMode: 'diffs',
				comparisonMode: 'range',
				comparisonSource: backend === 'jj' ? 'snapshot' : 'revision',
				preset: '90d',
				showIntermediateRevisions: true,
			},
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

async function getGitEntries(repoDir, relativePath) {
	const entries = await getGitHistoryEntries(repoDir, relativePath);
	const workingTreeEntry = await makeWorkingTreeEntry(repoDir, entries.at(-1), relativePath, 'git');
	if (workingTreeEntry) {
		entries.push(workingTreeEntry);
	}

	return reindexEntries(entries);
}

async function getGitHistoryEntries(repoDir, relativePath) {
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

async function getJjEntries(repoDir, relativePath) {
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
	const entries = await Promise.all(
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
	const filteredEntries = entries.filter(Boolean);

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

async function getJjSnapshotEntries(repoDir, relativePath, revisionEntries) {
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

function composeSnapshotEntries(revisionEntries, snapshotEntries, loadedChangeIds) {
	if (!loadedChangeIds.size) {
		return revisionEntries;
	}

	const snapshotEntriesByChangeId = snapshotEntries.reduce((groups, entry) => {
		if (!entry.changeId) {
			return groups;
		}

		const existing = groups.get(entry.changeId) || [];
		existing.push(entry);
		groups.set(entry.changeId, existing);
		return groups;
	}, new Map());

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
	repoDir,
	entries,
	backend,
	relativePath,
	comparisonSource,
	contentCache = entryContentCache,
) {
	const previews = {};
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

function buildPreview(entries, entryContents, comparisonSource, fromIndex, toIndex) {
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

async function getEntryContent(repoDir, backend, entry, relativePath, contentCache = entryContentCache) {
	const cacheKey = `${backend}:${entry.revision}:${relativePath}`;
	const cached = contentCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const contentPromise = entry.isWorkingTree
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

async function showGitFileAtRevision(repoDir, revision, relativePath) {
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

async function showJjFileAtRevision(repoDir, revision, relativePath) {
	try {
		const { stdout } = await run('jj', ['file', 'show', '-r', revision, relativePath], repoDir);
		return stdout;
	} catch (error) {
		if (isMissingFileAtRevisionError(error)) {
			return '';
		}
		throw error;
	}
}

function buildRows(beforeText, afterText) {
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

	const rows = [];
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

function buildContextRows(lines, leftOffset = 0, rightOffset = 0) {
	if (lines.length <= 6) {
		return lines.map((line, index) => ({
			type: 'context',
			leftNumber: leftOffset + index + 1,
			rightNumber: rightOffset + index + 1,
			text: line,
		}));
	}

	const head = lines.slice(0, 3).map((line, index) => ({
		type: 'context',
		leftNumber: leftOffset + index + 1,
		rightNumber: rightOffset + index + 1,
		text: line,
	}));
	const tail = lines.slice(-3).map((line, index) => ({
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

function splitLines(value) {
	const normalized = value.replace(/\r\n/g, '\n');
	if (!normalized) {
		return [];
	}

	return normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n') : normalized.split('\n');
}

async function gitTouchesFile(repoDir, revision, relativePath) {
	return (await getGitTouchedPaths(repoDir, revision)).has(relativePath);
}

async function jjTouchesFile(repoDir, revision, relativePath) {
	return (await getJjTouchedPaths(repoDir, revision)).has(relativePath);
}

async function getWorkspaceFiles(repoDir) {
	const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], repoDir);
	return stdout
		.split(/\r?\n/)
		.filter(Boolean)
		.toSorted((a, b) => a.localeCompare(b));
}

async function makeWorkingTreeEntry(repoDir, previousEntry, relativePath, backend) {
	const content = await fs.readFile(path.join(repoDir, relativePath), 'utf8');
	const previousContent = previousEntry ? await getEntryContent(repoDir, backend, previousEntry, relativePath) : '';
	if (content === previousContent) {
		return null;
	}

	return makeEntry({
		id: `working-tree:${relativePath}`,
		index: previousEntry ? previousEntry.index + 1 : 0,
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
}) {
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

function reindexEntries(entries) {
	return entries.map((entry, index) => ({
		...entry,
		index,
		hasPreviousEntry: index > 0,
	}));
}

function normalizeSnapshotAuthorDate(authorDate, fallbackAuthorDate) {
	const value = String(authorDate || '').trim();
	if (value && !Number.isNaN(Date.parse(value))) {
		return value;
	}

	return fallbackAuthorDate;
}

function normalizeSnapshotDescription(description, operationDescription) {
	const trimmed = String(description || '').trim();
	if (!trimmed || trimmed === '(no description set)' || trimmed === '(empty) (no description set)') {
		return operationDescription || 'Snapshot';
	}

	return trimmed;
}

function relativeTime(timestamp) {
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

function buildPlanContent(title, line, note) {
	return `## ${title}\n\n1. Inventory\n${line}\n\n2. Notes\n${note}\n`;
}

function buildServiceContent(version, note) {
	return [
		'export function buildServiceLabel() {',
		`  return '${version}';`,
		'}',
		'',
		`export const serviceNote = '${note}';`,
		'',
	].join('\n');
}

function isMissingFileAtRevisionError(error) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		/exists on disk, but not in/i.test(message) ||
		/path .* does not exist in/i.test(message) ||
		/no such path/i.test(message) ||
		/no matching entries/i.test(message) ||
		/No such file or directory/i.test(message)
	);
}

async function run(command, args, cwd, env = {}) {
	return execFileAsync(command, args, {
		cwd,
		env: {
			...process.env,
			...env,
		},
	});
}

async function getJjEvolutionEntries(repoDir: string, revision: string) {
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

async function getGitTouchedPaths(repoDir: string, revision: string) {
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

async function getJjTouchedPaths(repoDir: string, revision: string) {
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

function parseTouchedPaths(stdout: string) {
	return new Set(
		stdout
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean),
	);
}
