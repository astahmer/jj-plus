import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import packageJson from '../../package.json' with { type: 'json' };
import { getEntriesForSource } from '../shared/timeline-model.ts';
import {
	getGitHubRemoteBaseUrl,
	normalizeSnapshotOperationKey,
	parseGitBranchNames,
	parseJjBookmarkNames,
	parseJjEvolutionSummaryEntries,
	parseJjSummaryChangedPaths,
	parseJjSummaryRenameLines,
	resolvePreferredHistoryBackend,
	toJjRootFileFileset,
} from '../shared/history-helpers.ts';
import type {
	ComparisonSource,
	DiffPreview,
	FileRevisionEntry,
	HistoryBackend,
	RangeOverviewItem,
	TimelineCommand,
	TimelineData,
	TimelineFixtureFile,
	TimelineInboundMessage,
	TimelinePreferences,
} from '../shared/timeline-types.ts';
import { computeDiffStats } from '../shared/diff-stats.ts';
import { buildNonTextualDetails } from '../shared/non-textual-details.ts';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const distDir = path.join(rootDir, 'webview-dist');
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
const distAssets = ['index.html', 'timeline-app.js', 'timeline-app.css', 'pierre-worker-portable.js'];

type RepoContext = {
	backend: HistoryBackend;
	repoRoot: string;
	remoteBaseUrl?: string;
};

type StandaloneRuntime = {
	handleCommand(command: TimelineCommand): Promise<TimelineInboundMessage[]>;
};

type FileFixtureBuildArgs = {
	backend: HistoryBackend;
	relativePath: string;
	repoRoot: string;
	remoteBaseUrl?: string;
};

export async function startStandaloneTimelineServer(args: {
	workspacePath: string;
	filePath: string;
	openBrowser?: boolean;
	port?: number;
	verbose?: boolean;
}): Promise<{ url: string; close(): Promise<void> }> {
	await ensureDistReady();

	const runtime = await createStandaloneRuntime({
		workspacePath: args.workspacePath,
		filePath: args.filePath,
	});
	const server = http.createServer((request, response) => {
		void handleRequest({ request, response, runtime, verbose: args.verbose === true });
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(args.port || 0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});

	const address = server.address();
	const actualPort = typeof address === 'object' && address ? address.port : args.port || 0;
	const url = `http://127.0.0.1:${actualPort}/?standalone=1`;

	if (args.openBrowser !== false) {
		try {
			await openTarget(url);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`Failed to open the browser automatically: ${message}\n`);
		}
	}

	return {
		url,
		async close() {
			await new Promise<void>((resolve, reject) => {
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

async function createStandaloneRuntime(args: { workspacePath: string; filePath: string }): Promise<StandaloneRuntime> {
	const repoContext = await resolveRepoContext(args.workspacePath);
	const absoluteFilePath = path.resolve(args.filePath);
	const relativePath = path.relative(repoContext.repoRoot, absoluteFilePath);
	if (!relativePath || relativePath.startsWith('..')) {
		throw new Error(`The file must be inside the repository root: ${repoContext.repoRoot}`);
	}

	const preferencesByPath = new Map<string, Partial<TimelinePreferences>>();
	const fileCache = new Map<string, TimelineFixtureFile>();
	const rangeOverviewCache = new Map<string, RangeOverviewItem[]>();
	let activeRelativePath = normalizePath(relativePath);

	return {
		async handleCommand(command) {
			switch (command.command) {
				case 'ready':
					return emitTimeline();
				case 'refresh':
					fileCache.delete(activeRelativePath);
					clearRangeOverviewCache(activeRelativePath);
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
							payload: getFixturePreview({
								fileFixture,
								fromIndex: command.fromIndex,
								toIndex: command.toIndex,
								comparisonSource: command.comparisonSource,
							}),
						},
					];
				}
				case 'load-range-overview': {
					const fileFixture = await getActiveFileFixture();
					const normalizedFromIndex = Math.max(0, Math.min(command.fromIndex, command.toIndex));
					const normalizedToIndex = Math.max(normalizedFromIndex, Math.max(command.fromIndex, command.toIndex));
					const comparisonSource = command.comparisonSource === 'snapshot' ? 'snapshot' : 'revision';
					const selectedEntryIndexes = command.selectedEntryIndexes || [];
					const overviewKey = `${activeRelativePath}:${comparisonSource}:${normalizedFromIndex}:${normalizedToIndex}:${selectedEntryIndexes.join(',') || 'all'}`;
					let items = rangeOverviewCache.get(overviewKey);
					if (!items) {
						items = await buildRangeOverview({
							repoRoot: repoContext.repoRoot,
							fileFixture,
							currentRelativePath: activeRelativePath,
							fromIndex: normalizedFromIndex,
							toIndex: normalizedToIndex,
							comparisonSource,
							selectedEntryIndexes,
						});
						rangeOverviewCache.set(overviewKey, items);
					}

					return [
						{
							type: 'range-overview',
							payload: {
								fromIndex: normalizedFromIndex,
								toIndex: normalizedToIndex,
								comparisonSource,
								selectedEntryIndexes,
								items,
							},
						},
					];
				}
				case 'load-range-stack': {
					const normalizedFromIndex = Math.max(0, Math.min(command.fromIndex, command.toIndex));
					const normalizedToIndex = Math.max(normalizedFromIndex, Math.max(command.fromIndex, command.toIndex));
					const comparisonSource = command.comparisonSource === 'snapshot' ? 'snapshot' : 'revision';
					const items: Array<{ relativePath: string; preview: DiffPreview }> = [];
					for (const stackPath of command.relativePaths) {
						const normalizedPath = normalizePath(stackPath);
						const fileFixture =
							normalizedPath === activeRelativePath
								? await getActiveFileFixture()
								: await getFileFixture(normalizedPath);
						items.push({
							relativePath: normalizedPath,
							preview: getFixturePreview({
								fileFixture,
								fromIndex: normalizedFromIndex,
								toIndex: normalizedToIndex,
								comparisonSource,
							}),
						});
					}
					return [
						{
							type: 'range-stack-previews',
							payload: {
								fromIndex: normalizedFromIndex,
								toIndex: normalizedToIndex,
								comparisonSource,
								items,
							},
						},
					];
				}
				case 'search-history': {
					const fileFixture = await getActiveFileFixture();
					const entries = fileFixture.timelineData.entries.filter((entry) => !entry.isWorkingTree);
					const tip = entries[Math.max(0, entries.length - 1)];
					const previous = entries[Math.max(0, entries.length - 2)] || tip;
					const introducedAt = previous?.index ?? 0;
					const tipIndex = tip?.index ?? introducedAt;
					const hits: Array<{ entryIndex: number; kind: 'introduced' | 'present' }> = [
						{ entryIndex: introducedAt, kind: 'introduced' },
					];
					if (tipIndex !== introducedAt) {
						hits.push({ entryIndex: tipIndex, kind: 'present' });
					}
					const message: TimelineInboundMessage = {
						type: 'history-search',
						payload: {
							query: command.query,
							introducedAt,
							removedAt: null,
							hits,
							purpose: command.purpose === 'sidebar' ? 'sidebar' : 'history',
						},
					};
					return [message];
				}
				case 'load-entry-diff-counts': {
					const fileFixture = await getActiveFileFixture();
					return [
						{
							type: 'entry-diff-counts',
							payload: {
								comparisonSource: command.comparisonSource,
								counts: await Promise.all(
									command.entryIndexes.map(async (entryIndex) => ({
										entryIndex,
										diffCount: await getStandaloneEntryDiffCount({
											repoRoot: repoContext.repoRoot,
											fileFixture,
											entryIndex,
											comparisonSource: command.comparisonSource,
										}),
									})),
								),
							},
						},
					];
				}
				case 'resolve-nonempty-range': {
					const fileFixture = await getActiveFileFixture();
					return [{ type: 'resolved-range', payload: resolveNonEmptyRange(fileFixture, command.candidateIndexes) }];
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
					if (command.command === 'open-range-files-diff' && command.editorCommand) {
						const fileFixture = await getActiveFileFixture();
						const plan = await buildStandaloneRangeMultiDiffPlan({
							repoRoot: repoContext.repoRoot,
							fileFixture,
							fromIndex: command.fromIndex,
							toIndex: command.toIndex,
							comparisonSource: command.comparisonSource,
							selectedEntryIndexes: command.selectedEntryIndexes || [],
						});
						if (plan.files.length) {
							await openMultiDiffWithEditor({
								repoRoot: repoContext.repoRoot,
								editorCommand: command.editorCommand,
								files: plan.files,
							});
						}
						return [];
					}

					const fileFixture = await getActiveFileFixture();
					const preview = getFixturePreview({
						fileFixture,
						fromIndex: command.fromIndex,
						toIndex: command.toIndex,
						comparisonSource: command.comparisonSource,
					});
					await openPreviewDocument({ preview, relativePath: activeRelativePath });
					return [];
				}
				case 'open-revision-files-diff': {
					if (command.editorCommand) {
						const fileFixture = await getActiveFileFixture();
						const plan = await buildStandaloneEntryMultiDiffPlan({
							repoRoot: repoContext.repoRoot,
							fileFixture,
							entryIndex: command.entryIndex,
							comparisonSource: command.comparisonSource,
						});
						if (plan.files.length) {
							await openMultiDiffWithEditor({
								repoRoot: repoContext.repoRoot,
								editorCommand: command.editorCommand,
								files: plan.files,
							});
						}
						return [];
					}

					const fileFixture = await getActiveFileFixture();
					const preview = getUnitPreview({
						fileFixture,
						entryIndex: command.entryIndex,
						comparisonSource: command.comparisonSource,
					});
					if (preview) {
						await openPreviewDocument({ preview, relativePath: activeRelativePath });
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
				default:
					return [];
			}
		},
	};

	async function emitTimeline(): Promise<TimelineInboundMessage[]> {
		const fileFixture = await getActiveFileFixture();
		const timelineData = withPersistedPreferences(fileFixture.timelineData);
		const defaultFromIndex = Math.max(0, timelineData.defaultIndex - 1);
		const messages: TimelineInboundMessage[] = [
			{ type: 'timeline-data', payload: timelineData },
			{
				type: 'diff-preview',
				payload: getFixturePreview({
					fileFixture,
					fromIndex: defaultFromIndex,
					toIndex: timelineData.defaultIndex,
					comparisonSource: timelineData.preferences.comparisonSource || 'revision',
				}),
			},
		];

		if (timelineData.backend === 'jj') {
			messages.push({
				type: 'snapshot-entries',
				payload: {
					snapshotEntries: clone(fileFixture.timelineData.snapshotEntries || []),
					snapshotState: clone(fileFixture.timelineData.snapshotState || { loadedChangeIds: [] }),
				},
			});
		}

		return messages;
	}

	async function getActiveFileFixture(): Promise<TimelineFixtureFile> {
		return getFileFixture(activeRelativePath);
	}

	async function getFileFixture(relativeFilePath: string): Promise<TimelineFixtureFile> {
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

		return fileCache.get(normalizedRelativePath)!;
	}

	function withPersistedPreferences(timelineData: TimelineData): TimelineData {
		const persistedPreferences = preferencesByPath.get(timelineData.relativePath) || {};
		return {
			...clone(timelineData),
			preferences: {
				...clone(timelineData.preferences),
				...persistedPreferences,
			},
		};
	}

	function clearRangeOverviewCache(relativeFilePath: string): void {
		for (const cacheKey of rangeOverviewCache.keys()) {
			if (cacheKey.startsWith(`${relativeFilePath}:`)) {
				rangeOverviewCache.delete(cacheKey);
			}
		}
	}
}

async function handleRequest(args: {
	request: IncomingMessage;
	response: ServerResponse;
	runtime: StandaloneRuntime;
	verbose: boolean;
}): Promise<void> {
	try {
		const requestUrl = new URL(args.request.url || '/', 'http://127.0.0.1');
		if (args.request.method === 'POST' && requestUrl.pathname === '/api/command') {
			const command = (await readJsonBody(args.request)) as TimelineCommand;
			const messages = await args.runtime.handleCommand(command);
			writeJson(args.response, 200, { messages });
			return;
		}

		if (args.request.method !== 'GET' && args.request.method !== 'HEAD') {
			writeJson(args.response, 405, { error: 'Method Not Allowed' });
			return;
		}

		const targetPath = resolveStaticPath(requestUrl.pathname);
		if (!targetPath) {
			writeJson(args.response, 403, { error: 'Forbidden' });
			return;
		}

		if (!fsSync.existsSync(targetPath) || !fsSync.statSync(targetPath).isFile()) {
			writeJson(args.response, 404, { error: 'Not Found' });
			return;
		}

		const body = await fs.readFile(targetPath);
		args.response.writeHead(200, {
			'content-type': getContentType(targetPath),
			'cache-control': 'no-store',
		});

		if (args.request.method === 'HEAD') {
			args.response.end();
			return;
		}

		args.response.end(body);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (args.verbose) {
			process.stderr.write(`Standalone timeline request failed: ${message}\n`);
		}
		writeJson(args.response, 500, { error: message });
	}
}

async function buildFileFixture(args: FileFixtureBuildArgs): Promise<TimelineFixtureFile> {
	const workspaceFiles = await getWorkspaceFiles(args.repoRoot);
	const entries =
		args.backend === 'jj'
			? await getJjEntries({
					repoRoot: args.repoRoot,
					relativePath: args.relativePath,
					remoteBaseUrl: args.remoteBaseUrl,
				})
			: await getGitEntries({
					repoRoot: args.repoRoot,
					relativePath: args.relativePath,
					remoteBaseUrl: args.remoteBaseUrl,
				});
	const snapshotEntries =
		args.backend === 'jj'
			? await getJjSnapshotEntries({
					repoRoot: args.repoRoot,
					relativePath: args.relativePath,
					revisionEntries: entries,
					remoteBaseUrl: args.remoteBaseUrl,
				})
			: [];
	const loadedChangeIds =
		args.backend === 'jj' ? [...new Set(entries.map((entry) => entry.changeId).filter(Boolean) as string[])] : [];
	const snapshotSourceEntries =
		args.backend === 'jj'
			? composeSnapshotEntries({ revisionEntries: entries, snapshotEntries, loadedChangeIds: new Set(loadedChangeIds) })
			: entries;
	const defaultIndex = Math.max(0, entries.length - 1);
	const pathCache = new Map<string, string>();
	const contentCache = new Map<string, string>();

	return {
		timelineData: {
			backend: args.backend,
			workspacePath: args.repoRoot,
			relativePath: args.relativePath,
			fileName: path.basename(args.relativePath),
			version: packageJson.version,
			presets: timelinePresets,
			defaultIndex,
			latestIndex: defaultIndex,
			preferences: {
				sidebarWidth: 280,
				layoutMode: 'split',
				contentMode: 'diffs',
				comparisonMode: 'range',
				comparisonSource: args.backend === 'jj' ? 'snapshot' : 'revision',
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
			revision: await buildPreviewMap({
				repoRoot: args.repoRoot,
				entries,
				backend: args.backend,
				relativePath: args.relativePath,
				comparisonSource: 'revision',
				pathCache,
				contentCache,
			}),
			snapshot:
				args.backend === 'jj'
					? await buildPreviewMap({
							repoRoot: args.repoRoot,
							entries: snapshotSourceEntries,
							backend: args.backend,
							relativePath: args.relativePath,
							comparisonSource: 'snapshot',
							pathCache,
							contentCache,
						})
					: await buildPreviewMap({
							repoRoot: args.repoRoot,
							entries,
							backend: args.backend,
							relativePath: args.relativePath,
							comparisonSource: 'revision',
							pathCache,
							contentCache,
						}),
		},
	};
}

async function getGitEntries(args: {
	repoRoot: string;
	relativePath: string;
	remoteBaseUrl?: string;
}): Promise<FileRevisionEntry[]> {
	const touchingEntries = await getGitHistoryEntries(args);
	const entries =
		touchingEntries.length >= 2
			? mergeTimelineEntries(await getGitRepositoryEntries(args), touchingEntries)
			: touchingEntries;
	seedLatestEntryPath(entries, args.relativePath);
	const workingTreeEntry = await makeWorkingTreeEntry({
		repoRoot: args.repoRoot,
		previousEntry: entries.at(-1),
		relativePath: args.relativePath,
		backend: 'git',
		remoteBaseUrl: args.remoteBaseUrl,
	});
	if (workingTreeEntry) {
		entries.push(workingTreeEntry);
	}

	return reindexEntries(entries);
}

async function getGitHistoryEntries(args: {
	repoRoot: string;
	relativePath: string;
	remoteBaseUrl?: string;
}): Promise<FileRevisionEntry[]> {
	const { stdout } = await run({
		command: 'git',
		args: [
			'log',
			'--follow',
			'--reverse',
			'--decorate=short',
			'--date=iso-strict',
			'--format=%H%x09%ad%x09%an%x09%D%x09%s',
			'--max-count=200',
			'--',
			args.relativePath,
		],
		cwd: args.repoRoot,
	});
	const revisions = stdout.trim().split(/\r?\n/).filter(Boolean);
	const entries: FileRevisionEntry[] = [];
	for (const [index, line] of revisions.entries()) {
		const [revision, authorDate, authorName, branchNames, description] = line.split('\t');
		entries.push(
			makeEntry({
				id: revision || '',
				index,
				revision: revision || '',
				shortRevision: (revision || '').slice(0, 8),
				changeId: undefined,
				branchNames: parseGitBranchNames(branchNames || ''),
				authorDate: authorDate || '',
				authorName: authorName || '',
				description: description || '',
				touchesFile: true,
				isWorkingTree: false,
				filePath: args.relativePath,
				remoteBaseUrl: args.remoteBaseUrl,
			}),
		);
	}

	return entries;
}

async function getGitRepositoryEntries(args: {
	repoRoot: string;
	relativePath: string;
	remoteBaseUrl?: string;
}): Promise<FileRevisionEntry[]> {
	const { stdout } = await run({
		command: 'git',
		args: [
			'log',
			'--reverse',
			'--decorate=short',
			'--date=iso-strict',
			'--format=%H%x09%ad%x09%an%x09%D%x09%s',
			'--max-count=200',
		],
		cwd: args.repoRoot,
	});
	const revisions = stdout.trim().split(/\r?\n/).filter(Boolean);
	const entries: FileRevisionEntry[] = [];

	for (const [index, line] of revisions.entries()) {
		const [revision, authorDate, authorName, branchNames, description] = line.split('\t');
		entries.push(
			makeEntry({
				id: revision || '',
				index,
				revision: revision || '',
				shortRevision: (revision || '').slice(0, 8),
				changeId: undefined,
				branchNames: parseGitBranchNames(branchNames || ''),
				authorDate: authorDate || '',
				authorName: authorName || '',
				description: description || '',
				touchesFile: false,
				isWorkingTree: false,
				filePath: undefined,
				remoteBaseUrl: args.remoteBaseUrl,
			}),
		);
	}

	return entries;
}

async function getJjEntries(args: {
	repoRoot: string;
	relativePath: string;
	remoteBaseUrl?: string;
}): Promise<FileRevisionEntry[]> {
	const template = [
		'commit_id.short()',
		'"\\t"',
		'change_id.shortest()',
		'"\\t"',
		'author.timestamp().format("%Y-%m-%dT%H:%M:%S%:z")',
		'"\\t"',
		'author.name()',
		'"\\t"',
		'self.local_bookmarks().map(|b| b.name()).join(",")',
		'"\\t"',
		'description.first_line()',
		'"\\n"',
	].join(' ++ ');
	const { stdout } = await run({
		command: 'jj',
		args: ['log', '--no-graph', '--reversed', '--limit', '100', '-T', template],
		cwd: args.repoRoot,
	});
	const revisions = stdout.trim().split(/\r?\n/).filter(Boolean);
	const entries: FileRevisionEntry[] = [];
	for (const [index, line] of revisions.entries()) {
		const [revision, changeId, authorDate, authorName, bookmarkNames, description] = line.split('\t');
		if (/^0+$/u.test(revision || '')) {
			continue;
		}

		const touchesFile = await jjTouchesFile({
			repoRoot: args.repoRoot,
			revision: revision || '',
			relativePath: args.relativePath,
		});
		entries.push(
			makeEntry({
				id: revision || '',
				index,
				revision: revision || '',
				shortRevision: changeId || (revision || '').slice(0, 8),
				changeId: changeId || undefined,
				bookmarkNames: parseJjBookmarkNames(bookmarkNames || ''),
				authorDate: authorDate || '',
				authorName: authorName || '',
				description: description || '',
				touchesFile,
				isWorkingTree: false,
				filePath: args.relativePath,
				remoteBaseUrl: args.remoteBaseUrl,
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

	seedLatestEntryPath(entries, args.relativePath);

	const workingTreeEntry = await makeWorkingTreeEntry({
		repoRoot: args.repoRoot,
		previousEntry: entries.at(-1),
		relativePath: args.relativePath,
		backend: 'jj',
		remoteBaseUrl: args.remoteBaseUrl,
	});
	if (workingTreeEntry) {
		entries.push(workingTreeEntry);
	}

	return reindexEntries(dedupeAdjacentTimelineEntries(entries));
}

async function getJjSnapshotEntries(args: {
	repoRoot: string;
	relativePath: string;
	revisionEntries: FileRevisionEntry[];
	remoteBaseUrl?: string;
}): Promise<FileRevisionEntry[]> {
	const snapshotEntries: FileRevisionEntry[] = [];

	for (const entry of args.revisionEntries) {
		if (!entry.changeId || entry.isWorkingTree || !entry.touchesFile) {
			continue;
		}

		let stdout = '';
		try {
			({ stdout } = await run({
				command: 'jj',
				args: ['evolog', '--no-graph', '--summary', '--limit', '100', '-r', entry.revision],
				cwd: args.repoRoot,
			}));
		} catch {
			continue;
		}

		const evolutionEntries = parseJjEvolutionSummaryEntries(stdout)
			.filter((evolutionEntry) => parseJjSummaryChangedPaths(evolutionEntry.summaryLines).includes(args.relativePath))
			.map((evolutionEntry, evolutionIndex) =>
				makeEntry({
					id: `snapshot:${entry.changeId}:${evolutionEntry.operationId || evolutionEntry.changeKey || evolutionEntry.revision}:${evolutionIndex}`,
					index: 0,
					revision: evolutionEntry.revision,
					shortRevision: normalizeSnapshotOperationKey(evolutionEntry.changeKey) || evolutionEntry.revision.slice(0, 8),
					changeId: entry.changeId,
					bookmarkNames: evolutionEntry.bookmarkNames,
					authorDate: normalizeSnapshotAuthorDate(evolutionEntry.authorDate, entry.authorDate),
					authorName: evolutionEntry.authorName || entry.authorName,
					description: normalizeSnapshotDescription(evolutionEntry.description, evolutionEntry.operationDescription),
					touchesFile: true,
					isWorkingTree: false,
					filePath: args.relativePath,
					operationId: evolutionEntry.operationId,
					operationIndex: evolutionEntry.operationIndex,
					operationKey: evolutionEntry.changeKey,
					remoteBaseUrl: args.remoteBaseUrl,
				}),
			);

		snapshotEntries.push(...evolutionEntries);
	}

	snapshotEntries.sort(
		(left, right) => left.timestamp - right.timestamp || left.revision.localeCompare(right.revision),
	);
	return reindexEntries(snapshotEntries);
}

function composeSnapshotEntries(args: {
	revisionEntries: FileRevisionEntry[];
	snapshotEntries: FileRevisionEntry[];
	loadedChangeIds: Set<string>;
}): FileRevisionEntry[] {
	if (!args.loadedChangeIds.size) {
		return args.revisionEntries;
	}

	const snapshotEntriesByChangeId = args.snapshotEntries.reduce((groups, entry) => {
		if (!entry.changeId) {
			return groups;
		}
		const existing = groups.get(entry.changeId) || [];
		existing.push(entry);
		groups.set(entry.changeId, existing);
		return groups;
	}, new Map<string, FileRevisionEntry[]>());

	return reindexEntries(
		args.revisionEntries.flatMap((entry) => {
			if (!entry.changeId || entry.isWorkingTree || !entry.touchesFile || !args.loadedChangeIds.has(entry.changeId)) {
				return [entry];
			}

			return snapshotEntriesByChangeId.get(entry.changeId) || [entry];
		}),
	);
}

function seedLatestEntryPath(entries: FileRevisionEntry[], relativePath: string): void {
	for (const entry of entries) {
		if (!entry.isWorkingTree && entry.filePath) {
			delete entry.filePath;
		}
	}

	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!entry || entry.isWorkingTree || !entry.touchesFile) {
			continue;
		}

		entry.filePath = relativePath;
		break;
	}
}

function mergeTimelineEntries(
	repositoryEntries: FileRevisionEntry[],
	fileEntries: FileRevisionEntry[],
): FileRevisionEntry[] {
	const touchingByRevision = new Map(fileEntries.map((entry) => [entry.revision, entry]));
	const repoIndexes = fileEntries
		.map((entry) => repositoryEntries.findIndex((candidate) => candidate.revision === entry.revision))
		.filter((index) => index >= 0);

	if (!repoIndexes.length) {
		return fileEntries;
	}

	const startIndex = Math.min(...repoIndexes);
	const endIndex = Math.max(...repoIndexes);
	const merged = repositoryEntries
		.slice(startIndex, endIndex + 1)
		.map((entry) => touchingByRevision.get(entry.revision) || entry);

	for (const entry of fileEntries) {
		if (!merged.some((candidate) => candidate.revision === entry.revision)) {
			merged.push(entry);
		}
	}

	return merged.toSorted(
		(left, right) => left.timestamp - right.timestamp || left.revision.localeCompare(right.revision),
	);
}

function dedupeAdjacentTimelineEntries(entries: FileRevisionEntry[]): FileRevisionEntry[] {
	return entries.reduce<FileRevisionEntry[]>((deduped, entry) => {
		const previousEntry = deduped.at(-1);
		if (!previousEntry?.changeId || previousEntry.changeId !== entry.changeId) {
			deduped.push(entry);
			return deduped;
		}

		if (!previousEntry.touchesFile && entry.touchesFile) {
			deduped[deduped.length - 1] = entry;
		}

		return deduped;
	}, []);
}

async function buildPreviewMap(args: {
	repoRoot: string;
	entries: FileRevisionEntry[];
	backend: HistoryBackend;
	relativePath: string;
	comparisonSource: ComparisonSource;
	pathCache: Map<string, string>;
	contentCache: Map<string, string>;
}): Promise<Record<string, DiffPreview>> {
	const previews: Record<string, DiffPreview> = {};
	for (let toIndex = 1; toIndex < args.entries.length; toIndex += 1) {
		for (let fromIndex = 0; fromIndex < toIndex; fromIndex += 1) {
			previews[`${fromIndex}:${toIndex}`] = await buildPreview({
				repoRoot: args.repoRoot,
				entries: args.entries,
				backend: args.backend,
				relativePath: args.relativePath,
				comparisonSource: args.comparisonSource,
				fromIndex,
				toIndex,
				pathCache: args.pathCache,
				contentCache: args.contentCache,
			});
		}
	}

	return previews;
}

async function buildPreview(args: {
	repoRoot: string;
	entries: FileRevisionEntry[];
	backend: HistoryBackend;
	relativePath: string;
	comparisonSource: ComparisonSource;
	fromIndex: number;
	toIndex: number;
	pathCache: Map<string, string>;
	contentCache: Map<string, string>;
}): Promise<DiffPreview> {
	const fromEntry = args.entries[args.fromIndex];
	const toEntry = args.entries[args.toIndex];
	const beforePath = await resolveEntryFilePath({
		repoRoot: args.repoRoot,
		backend: args.backend,
		entries: args.entries,
		entryIndex: args.fromIndex,
		relativePath: args.relativePath,
		pathCache: args.pathCache,
	});
	const afterPath = await resolveEntryFilePath({
		repoRoot: args.repoRoot,
		backend: args.backend,
		entries: args.entries,
		entryIndex: args.toIndex,
		relativePath: args.relativePath,
		pathCache: args.pathCache,
	});
	const beforeText = await getEntryContent({
		repoRoot: args.repoRoot,
		backend: args.backend,
		entries: args.entries,
		entryIndex: args.fromIndex,
		relativePath: args.relativePath,
		pathCache: args.pathCache,
		contentCache: args.contentCache,
	});
	const afterText = await getEntryContent({
		repoRoot: args.repoRoot,
		backend: args.backend,
		entries: args.entries,
		entryIndex: args.toIndex,
		relativePath: args.relativePath,
		pathCache: args.pathCache,
		contentCache: args.contentCache,
	});
	const stats = computeDiffStats(beforeText, afterText);

	return {
		index: args.toIndex,
		title: `${fromEntry?.shortRevision || ''} -> ${toEntry?.shortRevision || ''}`,
		subtitle: toEntry?.isWorkingTree
			? 'Working tree'
			: `${subtitleDateFormatter.format(new Date(toEntry?.authorDate || 0))} · ${toEntry?.description || ''}`,
		diffCount: 0,
		additions: stats.additions,
		deletions: stats.deletions,
		hunkCount: stats.hunkCount,
		hasChanges: stats.hasChanges,
		fromIndex: args.fromIndex,
		toIndex: args.toIndex,
		comparisonSource: args.comparisonSource,
		beforePath,
		afterPath,
		beforeText,
		afterText,
		nonTextualDetails: stats.hasChanges
			? []
			: buildNonTextualDetails({
					beforeText,
					afterText,
					beforePath,
					afterPath,
					isWorkingTree: toEntry?.isWorkingTree,
				}),
	};
}

async function getEntryContent(args: {
	repoRoot: string;
	backend: HistoryBackend;
	entries: FileRevisionEntry[];
	entryIndex: number;
	relativePath: string;
	pathCache: Map<string, string>;
	contentCache: Map<string, string>;
}): Promise<string> {
	const entry = args.entries[args.entryIndex];
	if (!entry) {
		return '';
	}

	const resolvedPath = entry.isWorkingTree ? args.relativePath : await resolveEntryFilePath(args);
	const cacheKey = `${entry.revision}:${resolvedPath}`;
	if (args.contentCache.has(cacheKey)) {
		return args.contentCache.get(cacheKey) || '';
	}

	let content = '';
	if (entry.isWorkingTree) {
		try {
			content = await fs.readFile(path.join(args.repoRoot, args.relativePath), 'utf8');
		} catch (error) {
			if (!isMissingFileError(error)) {
				throw error;
			}
		}
		args.contentCache.set(cacheKey, content);
		return content;
	}

	content =
		args.backend === 'jj'
			? await showJjFileAtRevision({ repoRoot: args.repoRoot, revision: entry.revision, relativePath: resolvedPath })
			: await showGitFileAtRevision({ repoRoot: args.repoRoot, revision: entry.revision, relativePath: resolvedPath });
	args.contentCache.set(cacheKey, content);
	return content;
}

async function resolveEntryFilePath(args: {
	repoRoot: string;
	backend: HistoryBackend;
	entries: FileRevisionEntry[];
	entryIndex: number;
	relativePath: string;
	pathCache: Map<string, string>;
}): Promise<string> {
	const entry = args.entries[args.entryIndex];
	if (!entry || entry.isWorkingTree) {
		return args.relativePath;
	}

	if (entry.filePath) {
		return entry.filePath;
	}

	await ensureEntryFilePath(args);
	return entry.filePath || args.relativePath;
}

async function ensureEntryFilePath(args: {
	repoRoot: string;
	backend: HistoryBackend;
	entries: FileRevisionEntry[];
	entryIndex: number;
	relativePath: string;
	pathCache: Map<string, string>;
}): Promise<void> {
	const targetEntry = args.entries[args.entryIndex];
	if (!targetEntry || targetEntry.filePath || targetEntry.isWorkingTree) {
		return;
	}

	let knownIndex = -1;
	for (let index = args.entryIndex + 1; index < args.entries.length; index += 1) {
		if (args.entries[index]?.filePath) {
			knownIndex = index;
			break;
		}
	}

	if (knownIndex < 0) {
		targetEntry.filePath = args.relativePath;
		return;
	}

	let currentPath = args.entries[knownIndex].filePath || args.relativePath;
	for (let index = knownIndex; index > args.entryIndex; index -= 1) {
		const currentEntry = args.entries[index];
		const previousEntry = args.entries[index - 1];
		if (!previousEntry) {
			break;
		}

		if (!previousEntry.filePath) {
			let previousPath = currentPath;
			if (currentEntry.touchesFile && !currentEntry.isWorkingTree) {
				previousPath = await resolvePreviousPathAcrossRevision({
					repoRoot: args.repoRoot,
					backend: args.backend,
					revision: currentEntry.revision,
					currentPath,
					pathCache: args.pathCache,
				});
			}
			previousEntry.filePath = previousPath;
		}

		currentPath = previousEntry.filePath || currentPath;
	}
}

async function resolvePreviousPathAcrossRevision(args: {
	repoRoot: string;
	backend: HistoryBackend;
	revision: string;
	currentPath: string;
	pathCache: Map<string, string>;
}): Promise<string> {
	const cacheKey = `${args.revision}:${args.currentPath}`;
	if (args.pathCache.has(cacheKey)) {
		return args.pathCache.get(cacheKey) || args.currentPath;
	}

	const previousPath =
		args.backend === 'git'
			? await resolveGitPreviousPath({
					repoRoot: args.repoRoot,
					revision: args.revision,
					currentPath: args.currentPath,
				})
			: await resolveJjPreviousPath({
					repoRoot: args.repoRoot,
					revision: args.revision,
					currentPath: args.currentPath,
				});
	args.pathCache.set(cacheKey, previousPath);
	return previousPath;
}

async function resolveGitPreviousPath(args: {
	repoRoot: string;
	revision: string;
	currentPath: string;
}): Promise<string> {
	const { stdout } = await run({
		command: 'git',
		args: ['diff-tree', '--root', '--no-commit-id', '--name-status', '--find-renames', '-r', args.revision],
		cwd: args.repoRoot,
	});
	for (const line of stdout
		.split(/\r?\n/u)
		.map((value) => value.trim())
		.filter(Boolean)) {
		const [, fromPath = '', toPath = ''] = line.split('\t');
		if (toPath === args.currentPath) {
			return fromPath || args.currentPath;
		}
	}

	return args.currentPath;
}

async function resolveJjPreviousPath(args: {
	repoRoot: string;
	revision: string;
	currentPath: string;
}): Promise<string> {
	try {
		const { stdout } = await run({
			command: 'jj',
			args: ['diff', '--summary', '-r', args.revision],
			cwd: args.repoRoot,
		});
		const rename = parseJjSummaryRenameLines(stdout).find((entry) => entry.toPath === args.currentPath);
		return rename ? rename.fromPath : args.currentPath;
	} catch {
		return args.currentPath;
	}
}

async function showGitFileAtRevision(args: {
	repoRoot: string;
	revision: string;
	relativePath: string;
}): Promise<string> {
	try {
		const { stdout } = await run({
			command: 'git',
			args: ['show', `${args.revision}:${args.relativePath}`],
			cwd: args.repoRoot,
		});
		return stdout;
	} catch (error) {
		if (isMissingFileAtRevisionError(error)) {
			return '';
		}
		throw error;
	}
}

async function showJjFileAtRevision(args: {
	repoRoot: string;
	revision: string;
	relativePath: string;
}): Promise<string> {
	try {
		const { stdout } = await run({
			command: 'jj',
			args: ['file', 'show', '-r', args.revision, toJjRootFileFileset(args.relativePath)],
			cwd: args.repoRoot,
		});
		return stdout;
	} catch (error) {
		if (isMissingFileAtRevisionError(error)) {
			return '';
		}
		throw error;
	}
}

async function jjTouchesFile(args: { repoRoot: string; revision: string; relativePath: string }): Promise<boolean> {
	const { stdout } = await run({
		command: 'jj',
		args: ['diff', '--name-only', '-r', args.revision],
		cwd: args.repoRoot,
	});
	return stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.includes(args.relativePath);
}

async function listGitRevisionFiles(args: { repoRoot: string; revision: string }): Promise<string[]> {
	const { stdout } = await run({
		command: 'git',
		args: ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', args.revision],
		cwd: args.repoRoot,
	});
	return stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

async function resolveGitParentRevision(args: { repoRoot: string; revision: string }): Promise<string | undefined> {
	try {
		const { stdout } = await run({
			command: 'git',
			args: ['rev-parse', `${args.revision}^`],
			cwd: args.repoRoot,
		});
		const parentRevision = stdout.trim();
		return parentRevision || undefined;
	} catch {
		return undefined;
	}
}

async function listGitWorkingTreeFiles(args: { repoRoot: string }): Promise<string[]> {
	const files = new Set<string>();

	try {
		const { stdout } = await run({ command: 'git', args: ['diff', '--name-only', 'HEAD', '--'], cwd: args.repoRoot });
		for (const relativePath of stdout
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.filter(Boolean)) {
			files.add(relativePath);
		}
	} catch {
		// Ignore.
	}

	return [...files].toSorted((left, right) => left.localeCompare(right));
}

async function listJjRevisionFiles(args: { repoRoot: string; revision: string }): Promise<string[]> {
	const { stdout } = await run({
		command: 'jj',
		args: ['diff', '--name-only', '-r', args.revision],
		cwd: args.repoRoot,
	});
	return stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

async function listJjChangedFiles(args: { repoRoot: string; base: string; target: string }): Promise<string[]> {
	const { stdout } = await run({
		command: 'jj',
		args: ['diff', '--name-only', '--from', args.base, '--to', args.target],
		cwd: args.repoRoot,
	});
	return stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

async function buildStandaloneEntryMultiDiffPlan(args: {
	repoRoot: string;
	fileFixture: TimelineFixtureFile;
	entryIndex: number;
	comparisonSource: ComparisonSource;
}): Promise<{
	title: string;
	files: Array<{
		relativePath: string;
		originalRevset: string;
		modifiedRevset: string;
		backend: HistoryBackend;
	}>;
}> {
	const backend = args.fileFixture.timelineData.backend;
	const sourceEntries = getEntriesForSource(args.fileFixture.timelineData, args.comparisonSource);
	const entry = sourceEntries[args.entryIndex];
	if (!entry) {
		return { title: '', files: [] };
	}

	if (backend === 'git') {
		if (entry.isWorkingTree) {
			const previousEntry = sourceEntries[Math.max(0, args.entryIndex - 1)];
			if (!previousEntry) {
				return { title: entry.shortRevision, files: [] };
			}

			const files = await listGitWorkingTreeFiles({ repoRoot: args.repoRoot });
			return {
				title: `${previousEntry.shortRevision}..${entry.shortRevision}`,
				files: files.map((relativePath) => ({
					relativePath,
					originalRevset: previousEntry.revision,
					modifiedRevset: '@',
					backend,
				})),
			};
		}

		const files = await listGitRevisionFiles({ repoRoot: args.repoRoot, revision: entry.revision });
		const parentRevision = await resolveGitParentRevision({ repoRoot: args.repoRoot, revision: entry.revision });
		return {
			title: entry.shortRevision,
			files: files.map((relativePath) => ({
				relativePath,
				originalRevset: parentRevision || 'EMPTY',
				modifiedRevset: entry.revision,
				backend,
			})),
		};
	}

	if (entry.isWorkingTree) {
		const previousEntry = sourceEntries[Math.max(0, args.entryIndex - 1)];
		if (!previousEntry) {
			return { title: entry.shortRevision, files: [] };
		}

		const files = await listJjChangedFiles({ repoRoot: args.repoRoot, base: previousEntry.revision, target: '@' });
		return {
			title: `${previousEntry.shortRevision}..${entry.shortRevision}`,
			files: files.map((relativePath) => ({
				relativePath,
				originalRevset: previousEntry.revision,
				modifiedRevset: '@',
				backend,
			})),
		};
	}

	const baseRevision =
		args.comparisonSource === 'snapshot'
			? sourceEntries[Math.max(0, args.entryIndex - 1)]?.revision || `${entry.revision}-`
			: `${entry.revision}-`;
	const files =
		args.comparisonSource === 'snapshot'
			? await listJjChangedFiles({ repoRoot: args.repoRoot, base: baseRevision, target: entry.revision })
			: await listJjRevisionFiles({ repoRoot: args.repoRoot, revision: entry.revision });
	return {
		title: entry.shortRevision,
		files: files.map((relativePath) => ({
			relativePath,
			originalRevset: baseRevision,
			modifiedRevset: entry.revision,
			backend,
		})),
	};
}

async function buildStandaloneRangeMultiDiffPlan(args: {
	repoRoot: string;
	fileFixture: TimelineFixtureFile;
	fromIndex: number;
	toIndex: number;
	comparisonSource: ComparisonSource;
	selectedEntryIndexes: number[];
}) {
	const sourceEntries = getEntriesForSource(args.fileFixture.timelineData, args.comparisonSource);
	const fromEntry = sourceEntries[Math.min(args.fromIndex, args.toIndex)];
	const toEntry = sourceEntries[Math.max(args.fromIndex, args.toIndex)];
	const title = fromEntry && toEntry ? `${fromEntry.shortRevision}..${toEntry.shortRevision}` : 'Selection';
	if (!args.selectedEntryIndexes.length) {
		return { title, files: [] };
	}

	const plans = await Promise.all(
		args.selectedEntryIndexes.map((entryIndex) =>
			buildStandaloneEntryMultiDiffPlan({
				repoRoot: args.repoRoot,
				fileFixture: args.fileFixture,
				entryIndex,
				comparisonSource: args.comparisonSource,
			}),
		),
	);

	return {
		title,
		files: plans.flatMap((plan) => plan.files),
	};
}

async function getStandaloneEntryDiffCount(args: {
	repoRoot: string;
	fileFixture: TimelineFixtureFile;
	entryIndex: number;
	comparisonSource: ComparisonSource;
}): Promise<number> {
	const plan = await buildStandaloneEntryMultiDiffPlan(args);
	return plan.files.length;
}

async function openMultiDiffWithEditor(args: {
	repoRoot: string;
	editorCommand: string;
	files: Array<{
		relativePath: string;
		originalRevset: string;
		modifiedRevset: string;
		backend: HistoryBackend;
	}>;
}): Promise<void> {
	const { command, args: baseArgs } = parseEditorCommand(args.editorCommand);
	const tempRoot = path.join(os.tmpdir(), 'jj-range-diff-editor', `${Date.now()}`);
	await fs.mkdir(tempRoot, { recursive: true });

	for (const [index, file] of args.files.entries()) {
		const originalPath = await materializeEditorDiffSide({
			repoRoot: args.repoRoot,
			backend: file.backend,
			revset: file.originalRevset,
			relativePath: file.relativePath,
			tempRoot,
			suffix: `${index}-original`,
		});
		const modifiedPath = await materializeEditorDiffSide({
			repoRoot: args.repoRoot,
			backend: file.backend,
			revset: file.modifiedRevset,
			relativePath: file.relativePath,
			tempRoot,
			suffix: `${index}-modified`,
		});

		await spawnDetached(command, [...baseArgs, '--reuse-window', '--diff', originalPath, modifiedPath]);
	}
}

async function materializeEditorDiffSide(args: {
	repoRoot: string;
	backend: HistoryBackend;
	revset: string;
	relativePath: string;
	tempRoot: string;
	suffix: string;
}): Promise<string> {
	const safePath = args.relativePath.replace(/[^a-zA-Z0-9._/-]+/g, '_');
	const targetPath = path.join(args.tempRoot, `${args.suffix}-${safePath}`);
	await fs.mkdir(path.dirname(targetPath), { recursive: true });
	const content = await readStandaloneRevsetFile({
		repoRoot: args.repoRoot,
		backend: args.backend,
		revset: args.revset,
		relativePath: args.relativePath,
	});
	await fs.writeFile(targetPath, content, 'utf8');
	return targetPath;
}

async function readStandaloneRevsetFile(args: {
	repoRoot: string;
	backend: HistoryBackend;
	revset: string;
	relativePath: string;
}): Promise<string> {
	if (args.revset === 'EMPTY') {
		return '';
	}

	if (args.revset === '@') {
		try {
			return await fs.readFile(path.join(args.repoRoot, args.relativePath), 'utf8');
		} catch (error) {
			if (isMissingFileError(error)) {
				return '';
			}
			throw error;
		}
	}

	return args.backend === 'jj'
		? showJjFileAtRevision({ repoRoot: args.repoRoot, revision: args.revset, relativePath: args.relativePath })
		: showGitFileAtRevision({ repoRoot: args.repoRoot, revision: args.revset, relativePath: args.relativePath });
}

function parseEditorCommand(editorCommand: string): { command: string; args: string[] } {
	const parts = editorCommand.trim().split(/\s+/u).filter(Boolean);
	if (!parts.length) {
		throw new Error('Missing editor command.');
	}

	return {
		command: parts[0],
		args: parts.slice(1),
	};
}

async function spawnDetached(command: string, args: string[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { detached: true, stdio: 'ignore' });
		child.once('error', reject);
		child.once('spawn', () => {
			child.unref();
			resolve();
		});
	});
}

async function buildRangeOverview(args: {
	repoRoot: string;
	fileFixture: TimelineFixtureFile;
	currentRelativePath: string;
	fromIndex: number;
	toIndex: number;
	comparisonSource: ComparisonSource;
	selectedEntryIndexes?: number[];
}): Promise<RangeOverviewItem[]> {
	const sourceEntries = getEntriesForSource(args.fileFixture.timelineData, args.comparisonSource);
	const workspaceFileSet = new Set(args.fileFixture.timelineData.workspaceFiles || []);
	const countedPaths = new Map<string, number>();
	const entryIndexesToScan = args.selectedEntryIndexes?.length
		? args.selectedEntryIndexes
		: Array.from({ length: args.toIndex - args.fromIndex }, (_, index) => args.fromIndex + index + 1);

	for (const index of entryIndexesToScan) {
		const entry = sourceEntries[index];
		if (!entry) {
			continue;
		}

		const changedFiles =
			args.fileFixture.timelineData.backend === 'git'
				? entry.isWorkingTree
					? await listGitWorkingTreeFiles({ repoRoot: args.repoRoot })
					: await listGitRevisionFiles({ repoRoot: args.repoRoot, revision: entry.revision })
				: entry.isWorkingTree
					? await listJjRevisionFiles({ repoRoot: args.repoRoot, revision: '@' })
					: await listJjRevisionFiles({ repoRoot: args.repoRoot, revision: entry.revision });

		for (const relativePath of changedFiles) {
			if (!relativePath || (!workspaceFileSet.has(relativePath) && relativePath !== args.currentRelativePath)) {
				continue;
			}

			countedPaths.set(relativePath, (countedPaths.get(relativePath) || 0) + 1);
		}
	}

	return [...countedPaths.entries()]
		.map(([relativePath, changeCount]) => ({
			relativePath,
			changeCount,
			isCurrentFile: relativePath === args.currentRelativePath,
		}))
		.toSorted((left, right) => {
			if (left.changeCount !== right.changeCount) {
				return right.changeCount - left.changeCount;
			}

			if (left.isCurrentFile !== right.isCurrentFile) {
				return Number(right.isCurrentFile) - Number(left.isCurrentFile);
			}

			return left.relativePath.localeCompare(right.relativePath);
		})
		.slice(0, 150);
}

async function getWorkspaceFiles(repoRoot: string): Promise<string[]> {
	try {
		const { stdout } = await run({ command: 'jj', args: ['file', 'list'], cwd: repoRoot });
		return stdout
			.split(/\r?\n/)
			.filter(Boolean)
			.toSorted((left, right) => left.localeCompare(right));
	} catch {
		try {
			const { stdout } = await run({
				command: 'git',
				args: ['ls-files', '--cached'],
				cwd: repoRoot,
			});
			return stdout
				.split(/\r?\n/)
				.filter(Boolean)
				.toSorted((left, right) => left.localeCompare(right));
		} catch {
			const files: string[] = [];
			await collectWorkspaceFiles({ repoRoot, currentDir: repoRoot, files });
			return files.toSorted((left, right) => left.localeCompare(right));
		}
	}
}

async function collectWorkspaceFiles(args: { repoRoot: string; currentDir: string; files: string[] }): Promise<void> {
	const entries = await fs.readdir(args.currentDir, { withFileTypes: true });
	for (const entry of entries) {
		if (ignoredWorkspaceEntries.has(entry.name)) {
			continue;
		}

		const absolutePath = path.join(args.currentDir, entry.name);
		if (entry.isDirectory()) {
			await collectWorkspaceFiles({ repoRoot: args.repoRoot, currentDir: absolutePath, files: args.files });
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}

		args.files.push(normalizePath(path.relative(args.repoRoot, absolutePath)));
	}
}

async function makeWorkingTreeEntry(args: {
	repoRoot: string;
	previousEntry?: FileRevisionEntry;
	relativePath: string;
	backend: HistoryBackend;
	remoteBaseUrl?: string;
}): Promise<FileRevisionEntry | null> {
	let content = '';
	let stats: Awaited<ReturnType<typeof fs.stat>> | null = null;
	try {
		stats = await fs.stat(path.join(args.repoRoot, args.relativePath));
		content = await fs.readFile(path.join(args.repoRoot, args.relativePath), 'utf8');
	} catch (error) {
		if (!isMissingFileError(error)) {
			throw error;
		}
	}

	const previousContent = args.previousEntry
		? args.previousEntry.isWorkingTree
			? content
			: args.backend === 'jj'
				? await showJjFileAtRevision({
						repoRoot: args.repoRoot,
						revision: args.previousEntry.revision,
						relativePath: args.previousEntry.filePath || args.relativePath,
					})
				: await showGitFileAtRevision({
						repoRoot: args.repoRoot,
						revision: args.previousEntry.revision,
						relativePath: args.previousEntry.filePath || args.relativePath,
					})
		: '';
	if (content === previousContent) {
		return null;
	}

	return makeEntry({
		id: `working-tree:${args.relativePath}`,
		index: args.previousEntry ? (args.previousEntry.index || 0) + 1 : 0,
		revision: 'WORKTREE',
		shortRevision: 'Current',
		changeId: undefined,
		authorDate: (stats?.mtime || new Date()).toISOString(),
		authorName: process.env.GIT_AUTHOR_NAME || process.env.USER || 'CLI User',
		description: 'Working tree',
		touchesFile: true,
		isWorkingTree: true,
		filePath: args.relativePath,
		remoteBaseUrl: args.remoteBaseUrl,
	});
}

function makeEntry(args: {
	id: string;
	index: number;
	revision: string;
	shortRevision: string;
	changeId?: string;
	bookmarkNames?: string[];
	branchNames?: string[];
	authorDate: string;
	authorName: string;
	description: string;
	touchesFile: boolean;
	isWorkingTree: boolean;
	filePath?: string;
	operationId?: string;
	operationIndex?: number;
	operationKey?: string;
	remoteBaseUrl?: string;
}): FileRevisionEntry {
	const timestamp = Date.parse(args.authorDate);
	return {
		id: args.id,
		index: args.index,
		revision: args.revision,
		shortRevision: args.shortRevision,
		changeId: args.changeId,
		bookmarkNames: args.bookmarkNames,
		branchNames: args.branchNames,
		authorDate: args.authorDate,
		authorName: args.authorName,
		description: args.description || '',
		isWorkingTree: args.isWorkingTree,
		touchesFile: args.touchesFile,
		timestamp,
		filePath: args.filePath,
		operationId: args.operationId,
		operationIndex: args.operationIndex,
		operationKey: args.operationKey,
		monthLabel: monthFormatter.format(timestamp),
		shortDate: shortDateFormatter.format(timestamp),
		relativeDate: relativeTime(timestamp),
		hasPreviousEntry: args.index > 0,
		remoteUrl: args.isWorkingTree || !args.remoteBaseUrl ? undefined : `${args.remoteBaseUrl}/commit/${args.revision}`,
	};
}

function reindexEntries(entries: FileRevisionEntry[]): FileRevisionEntry[] {
	return entries.map((entry, index) => ({ ...entry, index, hasPreviousEntry: index > 0 }));
}

function normalizeSnapshotAuthorDate(authorDate: string, fallbackAuthorDate: string): string {
	const value = String(authorDate || '').trim();
	if (value && !Number.isNaN(Date.parse(value))) {
		return value;
	}

	return fallbackAuthorDate;
}

function normalizeSnapshotDescription(description: string, operationDescription: string): string {
	const trimmed = String(description || '').trim();
	if (!trimmed || trimmed === '(no description set)' || trimmed === '(empty) (no description set)') {
		return operationDescription || 'Snapshot';
	}

	return trimmed;
}

function relativeTime(timestamp: number): string {
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

async function resolveRepoContext(workspacePath: string): Promise<RepoContext> {
	const [gitResult, jjResult] = await Promise.allSettled([
		run({ command: 'git', args: ['rev-parse', '--show-toplevel'], cwd: workspacePath }),
		run({ command: 'jj', args: ['root'], cwd: workspacePath }),
	]);
	const gitRoot = gitResult.status === 'fulfilled' ? gitResult.value.stdout.trim() : undefined;
	const jjRoot = jjResult.status === 'fulfilled' ? jjResult.value.stdout.trim() : undefined;
	const backend = resolvePreferredHistoryBackend({ workspacePath, gitRoot, jjRoot });

	if (backend === 'jj' && jjRoot) {
		return { backend: 'jj', repoRoot: jjRoot, remoteBaseUrl: await resolveRemoteBaseUrl(jjRoot) };
	}

	if (backend === 'git' && gitRoot) {
		return { backend: 'git', repoRoot: gitRoot, remoteBaseUrl: await resolveRemoteBaseUrl(gitRoot) };
	}

	throw new Error('Standalone timeline requires a Git or JJ repository.');
}

async function resolveRemoteBaseUrl(repoRoot: string): Promise<string | undefined> {
	try {
		const { stdout } = await run({ command: 'git', args: ['remote', 'get-url', 'origin'], cwd: repoRoot });
		return getGitHubRemoteBaseUrl(stdout.trim());
	} catch {
		return undefined;
	}
}

function extractPersistedPreferences(
	command: Extract<TimelineCommand, { command: 'persist-state' }>,
): Partial<TimelinePreferences> {
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
		themePreference: command.themePreference,
	};
}

function getFixturePreview(args: {
	fileFixture: TimelineFixtureFile;
	fromIndex: number;
	toIndex: number;
	comparisonSource: ComparisonSource;
}): DiffPreview {
	const normalizedFromIndex = Math.min(args.fromIndex, args.toIndex);
	const normalizedToIndex = Math.max(args.fromIndex, args.toIndex);
	const key = `${normalizedFromIndex}:${normalizedToIndex}`;
	const previewMap = args.fileFixture.previews[args.comparisonSource] || args.fileFixture.previews.revision || {};
	const preview = previewMap[key];
	if (preview) {
		return clone(preview);
	}

	return {
		index: normalizedToIndex,
		title: 'No diff available',
		subtitle: '',
		diffCount: 0,
		additions: 0,
		deletions: 0,
		hunkCount: 0,
		hasChanges: false,
		fromIndex: normalizedFromIndex,
		toIndex: normalizedToIndex,
		comparisonSource: args.comparisonSource,
		beforePath: '',
		afterPath: '',
		beforeText: '',
		afterText: '',
		nonTextualDetails: [],
	};
}

function resolveNonEmptyRange(
	fileFixture: TimelineFixtureFile,
	candidateIndexes: number[],
): { fromIndex: number; toIndex: number } | null {
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

function getUnitPreview(args: {
	fileFixture: TimelineFixtureFile;
	entryIndex: number;
	comparisonSource: ComparisonSource;
}): DiffPreview | null {
	const sourceEntries = getEntriesForSource(args.fileFixture.timelineData, args.comparisonSource);
	const currentIndex = sourceEntries.findIndex((entry) => entry.index === args.entryIndex);
	if (currentIndex <= 0) {
		return null;
	}

	return getFixturePreview({
		fileFixture: args.fileFixture,
		fromIndex: sourceEntries[currentIndex - 1].index || 0,
		toIndex: sourceEntries[currentIndex].index || 0,
		comparisonSource: args.comparisonSource,
	});
}

async function openPreviewDocument(args: { preview: DiffPreview; relativePath: string }): Promise<void> {
	const previewDirectory = path.join(os.tmpdir(), 'jj-range-diff-previews');
	await fs.mkdir(previewDirectory, { recursive: true });
	const sanitizedPath = args.relativePath.replace(/[^a-zA-Z0-9._-]+/g, '_');
	const previewPath = path.join(previewDirectory, `${Date.now()}-${sanitizedPath}.diff.txt`);
	await fs.writeFile(previewPath, renderPreviewText(args.preview, args.relativePath), 'utf8');
	await openTarget(previewPath);
}

export function renderPreviewText(preview: DiffPreview, relativePath: string): string {
	const summary = `+${preview.additions} -${preview.deletions} ${preview.hunkCount} hunks`;
	const detailLines = preview.nonTextualDetails?.length ? [...preview.nonTextualDetails, ''] : [];
	const pathLines = [`--- ${preview.beforePath || relativePath}`, `+++ ${preview.afterPath || relativePath}`, ''];
	const contentLines = ['===== before =====', preview.beforeText, '===== after =====', preview.afterText];

	return [
		relativePath,
		preview.title,
		preview.subtitle,
		summary,
		'',
		...detailLines,
		...pathLines,
		...contentLines,
		'',
	].join('\n');
}

async function openTarget(target: string): Promise<void> {
	const launcher = getSystemLauncher(target);
	await new Promise<void>((resolve, reject) => {
		const child = spawn(launcher.command, launcher.args, { detached: true, stdio: 'ignore' });
		child.once('error', reject);
		child.once('spawn', () => {
			child.unref();
			resolve();
		});
	});
}

function getSystemLauncher(target: string): { command: string; args: string[] } {
	if (process.platform === 'darwin') {
		return { command: 'open', args: [target] };
	}
	if (process.platform === 'win32') {
		return { command: 'cmd', args: ['/c', 'start', '', target] };
	}
	return { command: 'xdg-open', args: [target] };
}

async function ensureDistReady(): Promise<void> {
	const assetPaths = distAssets.map((assetPath) => path.join(distDir, assetPath));
	const hasAllAssets = assetPaths.every((assetPath) => fsSync.existsSync(assetPath));
	if (!hasAllAssets || (await isDistStale(assetPaths))) {
		await buildWebviewDist();
	}

	if (!assetPaths.every((assetPath) => fsSync.existsSync(assetPath))) {
		throw new Error('Missing webview-dist assets. Run pnpm build:webview before launching the standalone timeline.');
	}
}

async function isDistStale(assetPaths: string[]): Promise<boolean> {
	const sourcePaths = await collectBuildInputFiles(path.join(rootDir, 'webview'));
	const newestSourceTime = sourcePaths.length
		? Math.max(...(await Promise.all(sourcePaths.map((filePath) => fs.stat(filePath).then((stats) => stats.mtimeMs)))))
		: 0;
	const oldestDistTime = Math.min(
		...(await Promise.all(assetPaths.map((assetPath) => fs.stat(assetPath).then((stats) => stats.mtimeMs)))),
	);
	return newestSourceTime > oldestDistTime;
}

async function collectBuildInputFiles(currentPath: string): Promise<string[]> {
	const entries = await fs.readdir(currentPath, { withFileTypes: true });
	const filePaths: string[] = [];

	for (const entry of entries) {
		const absolutePath = path.join(currentPath, entry.name);
		if (entry.isDirectory()) {
			filePaths.push(...(await collectBuildInputFiles(absolutePath)));
			continue;
		}

		if (entry.isFile()) {
			filePaths.push(absolutePath);
		}
	}

	return filePaths;
}

async function buildWebviewDist(): Promise<void> {
	const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
	try {
		await run({ command: pnpmCommand, args: ['build:webview'], cwd: rootDir });
		return;
	} catch (error) {
		const spawnError =
			error && typeof error === 'object' && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
		if (spawnError === 'ENOENT') {
			try {
				await run({ command: 'corepack', args: ['pnpm', 'build:webview'], cwd: rootDir });
				return;
			} catch {
				// Fall through to wrapped error.
			}
		}

		const cause = error instanceof Error ? error : new Error(String(error));
		cause.message = `Failed to build the standalone webview assets automatically: ${cause.message}`;
		throw cause;
	}
}

function resolveStaticPath(requestPath: string): string | null {
	const rawPath = requestPath === '/' ? '/index.html' : requestPath;
	const decodedPath = decodeURIComponent(rawPath);
	const candidatePath = path.normalize(path.join(distDir, decodedPath));
	if (candidatePath !== distDir && !candidatePath.startsWith(`${distDir}${path.sep}`)) {
		return null;
	}
	return candidatePath;
}

function getContentType(filePath: string): string {
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let totalBytes = 0;
	for await (const chunk of request) {
		const bufferChunk = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
		totalBytes += bufferChunk.length;
		if (totalBytes > 1024 * 1024) {
			throw new Error('Request body is too large.');
		}
		chunks.push(bufferChunk);
	}

	const text = Buffer.concat(chunks).toString('utf8');
	return text ? JSON.parse(text) : {};
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
	response.writeHead(statusCode, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	});
	response.end(JSON.stringify(payload));
}

function isMissingFileAtRevisionError(error: unknown): boolean {
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

function isMissingFileError(error: unknown): boolean {
	return Boolean(
		error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT',
	);
}

function normalizePath(relativePath: string): string {
	return relativePath.split(path.sep).join('/');
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

async function run(args: {
	command: string;
	args: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
}): Promise<{ stdout: string; stderr: string }> {
	return execFileAsync(args.command, args.args, {
		cwd: args.cwd,
		env: { ...process.env, ...args.env },
	}) as Promise<{ stdout: string; stderr: string }>;
}
