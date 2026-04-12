'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const { getEntriesForSource } = require('./timeline-model.js');
const {
	getGitHubRemoteBaseUrl,
	normalizeSnapshotOperationKey,
	parseJjEvolutionSummaryEntries,
	parseJjSummaryChangedPaths,
} = require('./history-helpers.js');

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'webview-dist');
const packageJson = require('../package.json');
const displayLocale = 'en-US';
const displayTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
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
const timelinePresets = { year: 365, '7d': 7, '30d': 30, '90d': 90, all: Number.POSITIVE_INFINITY };
const ignoredWorkspaceEntries = new Set(['.git', '.jj', 'node_modules', 'webview-dist', '.e2e-runtime']);

async function startStandaloneTimelineServer({
	workspacePath,
	filePath,
	openBrowser = true,
	port = 0,
	verbose = false,
}) {
	await ensureDistReady();

	const runtime = await createStandaloneRuntime({ workspacePath, filePath });
	const server = http.createServer((request, response) => {
		void handleRequest(request, response, runtime, verbose);
	});

	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});

	const address = server.address();
	const actualPort = typeof address === 'object' && address ? address.port : port;
	const url = `http://127.0.0.1:${actualPort}/?standalone=1`;

	if (openBrowser) {
		try {
			await openTarget(url);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`Failed to open the browser automatically: ${message}\n`);
		}
	}

	return {
		url,
		close() {
			return new Promise((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}

					resolve();
				});
			});
		},
	};
}

async function createStandaloneRuntime({ workspacePath, filePath }) {
	const repoContext = await resolveRepoContext(workspacePath);
	const absoluteFilePath = path.resolve(filePath);
	const relativePath = path.relative(repoContext.repoRoot, absoluteFilePath);
	if (!relativePath || relativePath.startsWith('..')) {
		throw new Error(`The file must be inside the repository root: ${repoContext.repoRoot}`);
	}

	const preferencesByPath = new Map();
	const fileCache = new Map();
	let activeRelativePath = normalizePath(relativePath);

	return {
		async handleCommand(command) {
			switch (command.command) {
				case 'ready':
					return emitTimeline();
				case 'refresh':
					fileCache.delete(activeRelativePath);
					return emitTimeline();
				case 'switch-file': {
					activeRelativePath = normalizePath(command.relativePath);
					await getActiveFileFixture();
					return emitTimeline();
				}
				case 'persist-state':
					preferencesByPath.set(activeRelativePath, extractPersistedPreferences(command));
					return [];
				case 'select-entry': {
					const fileFixture = await getActiveFileFixture();
					return [
						{
							type: 'diff-preview',
							payload: getFixturePreview(fileFixture, command.fromIndex, command.toIndex, command.comparisonSource),
						},
					];
				}
				case 'resolve-nonempty-range': {
					const fileFixture = await getActiveFileFixture();
					return [
						{
							type: 'resolved-range',
							payload: resolveNonEmptyRange(fileFixture, command.candidateIndexes),
						},
					];
				}
				case 'hydrate-snapshot-entries': {
					const fileFixture = await getActiveFileFixture();
					return [
						{
							type: 'snapshot-entries',
							payload: {
								snapshotEntries: clone(fileFixture.timelineData.snapshotEntries),
								snapshotState: clone(fileFixture.timelineData.snapshotState || { loadedChangeIds: [] }),
							},
						},
					];
				}
				case 'open-current-file':
					await openTarget(path.join(repoContext.repoRoot, activeRelativePath));
					return [];
				case 'open-editor-diff':
				case 'open-range-files-diff': {
					const fileFixture = await getActiveFileFixture();
					const preview = getFixturePreview(fileFixture, command.fromIndex, command.toIndex, command.comparisonSource);
					await openPreviewDocument(preview, activeRelativePath);
					return [];
				}
				case 'open-revision-files-diff': {
					const fileFixture = await getActiveFileFixture();
					const preview = getUnitPreview(fileFixture, command.entryIndex, command.comparisonSource);
					if (preview) {
						await openPreviewDocument(preview, activeRelativePath);
					}
					return [];
				}
				case 'open-revision-remote': {
					const fileFixture = await getActiveFileFixture();
					const sourceEntries = getEntriesForSource(fileFixture.timelineData, command.comparisonSource);
					const entry = sourceEntries.find((candidate) => candidate.index === command.entryIndex);
					if (entry?.remoteUrl) {
						await openTarget(entry.remoteUrl);
					}
					return [];
				}
				case 'cancel-active-request':
					return [];
				default:
					return [];
			}
		},
	};

	async function emitTimeline() {
		const fileFixture = await getActiveFileFixture();
		const timelineData = withPersistedPreferences(fileFixture.timelineData);
		const defaultFromIndex = Math.max(0, timelineData.defaultIndex - 1);
		return [
			{ type: 'timeline-data', payload: timelineData },
			{
				type: 'diff-preview',
				payload: getFixturePreview(
					fileFixture,
					defaultFromIndex,
					timelineData.defaultIndex,
					timelineData.preferences.comparisonSource || 'revision',
				),
			},
		];
	}

	async function getActiveFileFixture() {
		return getFileFixture(activeRelativePath);
	}

	async function getFileFixture(relativeFilePath) {
		const normalizedRelativePath = normalizePath(relativeFilePath);
		if (!fileCache.has(normalizedRelativePath)) {
			const nextFixture = await buildFileFixture({
				backend: repoContext.backend,
				relativePath: normalizedRelativePath,
				repoRoot: repoContext.repoRoot,
				remoteBaseUrl: repoContext.remoteBaseUrl,
			});
			fileCache.set(normalizedRelativePath, nextFixture);
		}

		return fileCache.get(normalizedRelativePath);
	}

	function withPersistedPreferences(timelineData) {
		const persistedPreferences = preferencesByPath.get(timelineData.relativePath) || {};
		return {
			...clone(timelineData),
			preferences: {
				...clone(timelineData.preferences),
				...persistedPreferences,
			},
		};
	}
}

async function handleRequest(request, response, runtime, verbose) {
	try {
		const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
		if (request.method === 'POST' && requestUrl.pathname === '/api/command') {
			const command = await readJsonBody(request);
			const messages = await runtime.handleCommand(command);
			return writeJson(response, 200, { messages });
		}

		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return writeJson(response, 405, { error: 'Method Not Allowed' });
		}

		const targetPath = resolveStaticPath(requestUrl.pathname);
		if (!targetPath) {
			return writeJson(response, 403, { error: 'Forbidden' });
		}

		if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
			return writeJson(response, 404, { error: 'Not Found' });
		}

		const body = await fsPromises.readFile(targetPath);
		response.writeHead(200, {
			'content-type': getContentType(targetPath),
			'cache-control': 'no-store',
		});

		if (request.method === 'HEAD') {
			response.end();
			return;
		}

		response.end(body);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (verbose) {
			process.stderr.write(`Standalone timeline request failed: ${message}\n`);
		}
		writeJson(response, 500, { error: message });
	}
}

async function buildFileFixture({ backend, relativePath, repoRoot, remoteBaseUrl }) {
	const workspaceFiles = await getWorkspaceFiles(repoRoot);
	const entries =
		backend === 'jj'
			? await getJjEntries(repoRoot, relativePath, remoteBaseUrl)
			: await getGitEntries(repoRoot, relativePath, remoteBaseUrl);
	const snapshotEntries =
		backend === 'jj' ? await getJjSnapshotEntries(repoRoot, relativePath, entries, remoteBaseUrl) : [];
	const loadedChangeIds = backend === 'jj' ? [...new Set(entries.map((entry) => entry.changeId).filter(Boolean))] : [];
	const snapshotSourceEntries =
		backend === 'jj' ? composeSnapshotEntries(entries, snapshotEntries, new Set(loadedChangeIds)) : entries;
	const defaultIndex = Math.max(0, entries.length - 1);

	return {
		timelineData: {
			backend,
			workspacePath: repoRoot,
			relativePath,
			fileName: path.basename(relativePath),
			version: packageJson.version,
			presets: timelinePresets,
			defaultIndex,
			latestIndex: defaultIndex,
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
			revision: await buildPreviewMap(repoRoot, entries, backend, relativePath, 'revision'),
			snapshot:
				backend === 'jj'
					? await buildPreviewMap(repoRoot, snapshotSourceEntries, backend, relativePath, 'snapshot')
					: await buildPreviewMap(repoRoot, entries, backend, relativePath, 'revision'),
		},
	};
}

async function getGitEntries(repoRoot, relativePath, remoteBaseUrl) {
	const entries = await getGitHistoryEntries(repoRoot, relativePath, remoteBaseUrl);
	const workingTreeEntry = await makeWorkingTreeEntry(repoRoot, entries.at(-1), relativePath, 'git', remoteBaseUrl);
	if (workingTreeEntry) {
		entries.push(workingTreeEntry);
	}

	return reindexEntries(entries);
}

async function getGitHistoryEntries(repoRoot, relativePath, remoteBaseUrl) {
	const { stdout } = await run(
		'git',
		['log', '--reverse', '--format=%H%x09%cI%x09%an%x09%s', '--', relativePath],
		repoRoot,
	);
	const revisions = stdout.trim().split(/\r?\n/).filter(Boolean);
	const entries = [];
	for (const [index, line] of revisions.entries()) {
		const [revision, authorDate, authorName, description] = line.split('\t');
		const touchesFile = await gitTouchesFile(repoRoot, revision, relativePath);
		entries.push(
			makeEntry({
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
				remoteBaseUrl,
			}),
		);
	}

	return entries;
}

async function getJjEntries(repoRoot, relativePath, remoteBaseUrl) {
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
	const { stdout } = await run('jj', ['log', '--no-graph', '--reversed', '--limit', '100', '-T', template], repoRoot);
	const revisions = stdout.trim().split(/\r?\n/).filter(Boolean);
	const entries = [];
	for (const [index, line] of revisions.entries()) {
		const [revision, changeId, authorDate, authorName, description] = line.split('\t');
		if (/^0+$/u.test(revision)) {
			continue;
		}

		const touchesFile = await jjTouchesFile(repoRoot, revision, relativePath);
		entries.push(
			makeEntry({
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
				remoteBaseUrl,
			}),
		);
	}

	const lastEntry = entries.at(-1);
	if (lastEntry && !lastEntry.description) {
		lastEntry.revision = 'WORKTREE';
		lastEntry.shortRevision = 'Current';
		lastEntry.description = 'Working tree';
		lastEntry.isWorkingTree = true;
		lastEntry.changeId = undefined;
		lastEntry.remoteUrl = undefined;
	}

	const workingTreeEntry = await makeWorkingTreeEntry(repoRoot, entries.at(-1), relativePath, 'jj', remoteBaseUrl);
	if (workingTreeEntry) {
		entries.push(workingTreeEntry);
	}

	return reindexEntries(entries);
}

async function getJjSnapshotEntries(repoRoot, relativePath, revisionEntries, remoteBaseUrl) {
	const snapshotEntries = [];

	for (const entry of revisionEntries) {
		if (!entry.changeId || entry.isWorkingTree || !entry.touchesFile) {
			continue;
		}

		let stdout = '';
		try {
			({ stdout } = await run(
				'jj',
				['evolog', '--no-graph', '--summary', '--limit', '100', '-r', entry.revision],
				repoRoot,
			));
		} catch {
			continue;
		}

		const evolutionEntries = parseJjEvolutionSummaryEntries(stdout)
			.filter((evolutionEntry) => parseJjSummaryChangedPaths(evolutionEntry.summaryLines).includes(relativePath))
			.map((evolutionEntry) =>
				makeEntry({
					id: `snapshot:${evolutionEntry.operationId || evolutionEntry.changeKey || evolutionEntry.revision}`,
					index: 0,
					revision: evolutionEntry.revision,
					shortRevision: normalizeSnapshotOperationKey(evolutionEntry.changeKey) || evolutionEntry.revision.slice(0, 8),
					changeId: entry.changeId,
					authorDate: normalizeSnapshotAuthorDate(evolutionEntry.authorDate, entry.authorDate),
					authorName: evolutionEntry.authorName || entry.authorName,
					description: normalizeSnapshotDescription(evolutionEntry.description, evolutionEntry.operationDescription),
					touchesFile: true,
					isWorkingTree: false,
					filePath: relativePath,
					remoteBaseUrl,
				}),
			);

		snapshotEntries.push(...evolutionEntries);
	}

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

async function buildPreviewMap(repoRoot, entries, backend, relativePath, comparisonSource) {
	const previews = {};
	for (let toIndex = 1; toIndex < entries.length; toIndex += 1) {
		for (let fromIndex = 0; fromIndex < toIndex; fromIndex += 1) {
			previews[`${fromIndex}:${toIndex}`] = await buildPreview(
				repoRoot,
				entries,
				backend,
				relativePath,
				comparisonSource,
				fromIndex,
				toIndex,
			);
		}
	}

	return previews;
}

async function buildPreview(repoRoot, entries, backend, relativePath, comparisonSource, fromIndex, toIndex) {
	const fromEntry = entries[fromIndex];
	const toEntry = entries[toIndex];
	const beforeText = await getEntryContent(repoRoot, backend, fromEntry, relativePath);
	const afterText = await getEntryContent(repoRoot, backend, toEntry, relativePath);
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

async function getEntryContent(repoRoot, backend, entry, relativePath) {
	if (entry.isWorkingTree) {
		try {
			return await fsPromises.readFile(path.join(repoRoot, relativePath), 'utf8');
		} catch (error) {
			if (isMissingFileError(error)) {
				return '';
			}
			throw error;
		}
	}

	return backend === 'jj'
		? showJjFileAtRevision(repoRoot, entry.revision, relativePath)
		: showGitFileAtRevision(repoRoot, entry.revision, relativePath);
}

async function showGitFileAtRevision(repoRoot, revision, relativePath) {
	try {
		const { stdout } = await run('git', ['show', `${revision}:${relativePath}`], repoRoot);
		return stdout;
	} catch (error) {
		if (isMissingFileAtRevisionError(error)) {
			return '';
		}
		throw error;
	}
}

async function showJjFileAtRevision(repoRoot, revision, relativePath) {
	try {
		const { stdout } = await run('jj', ['file', 'show', '-r', revision, relativePath], repoRoot);
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

async function gitTouchesFile(repoRoot, revision, relativePath) {
	const { stdout } = await run(
		'git',
		['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', revision, '--', relativePath],
		repoRoot,
	);
	return stdout.trim().length > 0;
}

async function jjTouchesFile(repoRoot, revision, relativePath) {
	const { stdout } = await run('jj', ['diff', '--name-only', '-r', revision], repoRoot);
	return stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.includes(relativePath);
}

async function getWorkspaceFiles(repoRoot) {
	try {
		const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], repoRoot);
		return stdout
			.split(/\r?\n/)
			.filter(Boolean)
			.toSorted((left, right) => left.localeCompare(right));
	} catch {
		const files = [];
		await collectWorkspaceFiles(repoRoot, repoRoot, files);
		return files.toSorted((left, right) => left.localeCompare(right));
	}
}

async function collectWorkspaceFiles(repoRoot, currentDir, files) {
	const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
	for (const entry of entries) {
		if (ignoredWorkspaceEntries.has(entry.name)) {
			continue;
		}

		const absolutePath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) {
			await collectWorkspaceFiles(repoRoot, absolutePath, files);
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		files.push(normalizePath(path.relative(repoRoot, absolutePath)));
	}
}

async function makeWorkingTreeEntry(repoRoot, previousEntry, relativePath, backend, remoteBaseUrl) {
	let content = '';
	let stats = null;
	try {
		stats = await fsPromises.stat(path.join(repoRoot, relativePath));
		content = await fsPromises.readFile(path.join(repoRoot, relativePath), 'utf8');
	} catch (error) {
		if (!isMissingFileError(error)) {
			throw error;
		}
	}

	const previousContent = previousEntry ? await getEntryContent(repoRoot, backend, previousEntry, relativePath) : '';
	if (content === previousContent) {
		return null;
	}

	return makeEntry({
		id: `working-tree:${relativePath}`,
		index: previousEntry ? previousEntry.index + 1 : 0,
		revision: 'WORKTREE',
		shortRevision: 'Current',
		changeId: undefined,
		authorDate: (stats?.mtime || new Date()).toISOString(),
		authorName: process.env.GIT_AUTHOR_NAME || process.env.USER || 'CLI User',
		description: 'Working tree',
		touchesFile: true,
		isWorkingTree: true,
		filePath: relativePath,
		remoteBaseUrl,
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
	remoteBaseUrl,
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
		remoteUrl: isWorkingTree || !remoteBaseUrl ? undefined : `${remoteBaseUrl}/commit/${revision}`,
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
	const deltaHours = Math.round((Date.now() - timestamp) / (1000 * 60 * 60));
	if (deltaHours <= 1) {
		return 'this minute';
	}
	if (deltaHours < 36) {
		return 'yesterday';
	}
	if (deltaHours < 24 * 30) {
		return `${Math.round(deltaHours / 24)} days ago`;
	}

	return `${Math.round(deltaHours / (24 * 30))} months ago`;
}

async function resolveRepoContext(workspacePath) {
	try {
		const { stdout } = await run('jj', ['root'], workspacePath);
		const repoRoot = stdout.trim();
		return {
			backend: 'jj',
			repoRoot,
			remoteBaseUrl: await resolveRemoteBaseUrl(repoRoot),
		};
	} catch {}

	try {
		const { stdout } = await run('git', ['rev-parse', '--show-toplevel'], workspacePath);
		const repoRoot = stdout.trim();
		return {
			backend: 'git',
			repoRoot,
			remoteBaseUrl: await resolveRemoteBaseUrl(repoRoot),
		};
	} catch {
		throw new Error('Standalone timeline requires a Git or JJ repository.');
	}
}

async function resolveRemoteBaseUrl(repoRoot) {
	try {
		const { stdout } = await run('git', ['remote', 'get-url', 'origin'], repoRoot);
		return getGitHubRemoteBaseUrl(stdout.trim());
	} catch {
		return undefined;
	}
}

function extractPersistedPreferences(command) {
	return {
		sidebarWidth: command.sidebarWidth,
		sidebarCollapsed: command.sidebarCollapsed,
		timelinePaneHeight: command.timelinePaneHeight,
		timelinePaneCollapsed: command.timelinePaneCollapsed,
		layoutMode: command.layoutMode,
		contentMode: command.contentMode,
		comparisonMode: command.comparisonMode,
		comparisonSource: command.comparisonSource,
		showIntermediateRevisions: command.showIntermediateRevisions,
		preset: command.preset,
	};
}

function getFixturePreview(fileFixture, fromIndex, toIndex, comparisonSource) {
	const normalizedFromIndex = Math.min(fromIndex, toIndex);
	const normalizedToIndex = Math.max(fromIndex, toIndex);
	const key = `${normalizedFromIndex}:${normalizedToIndex}`;
	const previewMap = fileFixture.previews[comparisonSource] || fileFixture.previews.revision || {};
	const preview = previewMap[key];
	if (preview) {
		return clone(preview);
	}

	return {
		index: normalizedToIndex,
		title: 'No diff available',
		subtitle: '',
		additions: 0,
		deletions: 0,
		hunkCount: 0,
		hasChanges: false,
		fromIndex: normalizedFromIndex,
		toIndex: normalizedToIndex,
		comparisonSource,
		rows: [],
		nonTextualDetails: [],
	};
}

function resolveNonEmptyRange(fileFixture, candidateIndexes) {
	const previewMap = fileFixture.previews.revision || {};
	for (let index = candidateIndexes.length - 1; index > 0; index -= 1) {
		const fromIndex = candidateIndexes[index - 1];
		const toIndex = candidateIndexes[index];
		const key = `${Math.min(fromIndex, toIndex)}:${Math.max(fromIndex, toIndex)}`;
		if (previewMap[key]?.hasChanges) {
			return { fromIndex, toIndex };
		}
	}

	return null;
}

function getUnitPreview(fileFixture, entryIndex, comparisonSource) {
	const sourceEntries = getEntriesForSource(fileFixture.timelineData, comparisonSource);
	const currentIndex = sourceEntries.findIndex((entry) => entry.index === entryIndex);
	if (currentIndex <= 0) {
		return null;
	}

	return getFixturePreview(
		fileFixture,
		sourceEntries[currentIndex - 1].index,
		sourceEntries[currentIndex].index,
		comparisonSource,
	);
}

async function openPreviewDocument(preview, relativePath) {
	const previewDirectory = path.join(os.tmpdir(), 'jj-range-diff-previews');
	await fsPromises.mkdir(previewDirectory, { recursive: true });
	const sanitizedPath = relativePath.replace(/[^a-zA-Z0-9._-]+/g, '_');
	const previewPath = path.join(previewDirectory, `${Date.now()}-${sanitizedPath}.diff.txt`);
	await fsPromises.writeFile(previewPath, renderPreviewText(preview, relativePath), 'utf8');
	await openTarget(previewPath);
}

function renderPreviewText(preview, relativePath) {
	const summary = `+${preview.additions} -${preview.deletions} ${preview.hunkCount} hunks`;
	const detailLines = preview.nonTextualDetails?.length ? [...preview.nonTextualDetails, ''] : [];
	const rowLines = preview.rows.map((row) => {
		if (row.type === 'skip') {
			return `@@ ${row.text} @@`;
		}

		const left = row.leftNumber == null ? '' : String(row.leftNumber);
		const right = row.rightNumber == null ? '' : String(row.rightNumber);
		const prefix = row.type === 'add' ? '+' : row.type === 'remove' ? '-' : ' ';
		return `${prefix} ${left.padStart(4, ' ')} ${right.padStart(4, ' ')} ${row.text}`;
	});

	return [`${relativePath}`, preview.title, preview.subtitle, summary, '', ...detailLines, ...rowLines, ''].join('\n');
}

async function openTarget(target) {
	const launcher = getSystemLauncher(target);
	await new Promise((resolve, reject) => {
		const child = spawn(launcher.command, launcher.args, {
			detached: true,
			stdio: 'ignore',
		});
		child.once('error', reject);
		child.once('spawn', () => {
			child.unref();
			resolve();
		});
	});
}

function getSystemLauncher(target) {
	if (process.platform === 'darwin') {
		return { command: 'open', args: [target] };
	}
	if (process.platform === 'win32') {
		return { command: 'cmd', args: ['/c', 'start', '', target] };
	}
	return { command: 'xdg-open', args: [target] };
}

async function ensureDistReady() {
	const indexPath = path.join(distDir, 'index.html');
	if (!fs.existsSync(indexPath)) {
		throw new Error(
			'Missing webview-dist/index.html. Run pnpm build:webview before launching the standalone timeline.',
		);
	}
}

function resolveStaticPath(requestPath) {
	const rawPath = requestPath === '/' ? '/index.html' : requestPath;
	const decodedPath = decodeURIComponent(rawPath);
	const candidatePath = path.normalize(path.join(distDir, decodedPath));
	if (candidatePath !== distDir && !candidatePath.startsWith(`${distDir}${path.sep}`)) {
		return null;
	}
	return candidatePath;
}

function getContentType(filePath) {
	const extension = path.extname(filePath).toLowerCase();
	if (extension === '.html') {
		return 'text/html; charset=utf-8';
	}
	if (extension === '.js') {
		return 'application/javascript; charset=utf-8';
	}
	if (extension === '.css') {
		return 'text/css; charset=utf-8';
	}
	if (extension === '.json') {
		return 'application/json; charset=utf-8';
	}
	if (extension === '.svg') {
		return 'image/svg+xml';
	}
	return 'application/octet-stream';
}

async function readJsonBody(request) {
	const chunks = [];
	let totalBytes = 0;
	for await (const chunk of request) {
		totalBytes += chunk.length;
		if (totalBytes > 1024 * 1024) {
			throw new Error('Request body is too large.');
		}
		chunks.push(chunk);
	}

	const text = Buffer.concat(chunks).toString('utf8');
	return text ? JSON.parse(text) : {};
}

function writeJson(response, statusCode, payload) {
	response.writeHead(statusCode, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	});
	response.end(JSON.stringify(payload));
}

function isMissingFileAtRevisionError(error) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		/exists on disk, but not in/i.test(message) ||
		/path .* does not exist in/i.test(message) ||
		/no such path/i.test(message) ||
		/no matching entries/i.test(message) ||
		/No such file or directory/i.test(message) ||
		/Path .* not found/i.test(message)
	);
}

function isMissingFileError(error) {
	return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function normalizePath(relativePath) {
	return relativePath.split(path.sep).join('/');
}

function clone(value) {
	return JSON.parse(JSON.stringify(value));
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

module.exports = {
	renderPreviewText,
	startStandaloneTimelineServer,
};
