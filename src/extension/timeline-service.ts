import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { textsMatchIgnoringLineEndings } from '../shared/diff-helpers.ts';
import type {
	ComparisonSource,
	DiffPreview,
	DiffRow,
	FileRevisionEntry,
	RangeOverviewItem,
	TimelineData,
	TimelinePreferences,
} from '../shared/timeline-types.ts';
import { MAX_SNAPSHOT_HYDRATION_CHANGES } from './constants.ts';
import { resolveHistoryAdapter } from './history-adapters.ts';
import type {
	CommandRunner,
	ExtensionTimelineSession,
	HistoryAdapter,
	SessionAction,
	TimelinePayloadArgs,
} from './types.ts';

const DEFAULT_TIMELINE_PREFERENCES: Required<TimelinePreferences> = {
	sidebarWidth: 276,
	sidebarCollapsed: false,
	timelinePaneHeight: 278,
	timelinePaneCollapsed: false,
	layoutMode: 'split',
	contentMode: 'diffs',
	comparisonMode: 'range',
	comparisonSource: 'revision',
	showIntermediateRevisions: false,
	preset: 'year',
};

const IGNORED_WORKSPACE_DIRECTORIES = new Set(['.git', '.jj', 'node_modules', 'dist', 'build', 'out', 'coverage']);

function getComparisonEntries(request: {
	entries: FileRevisionEntry[];
	fromIndex: number;
	toIndex: number;
}): { fromEntry: FileRevisionEntry; toEntry: FileRevisionEntry } | undefined {
	const normalizedFromIndex = Math.max(0, Math.min(request.fromIndex, request.toIndex));
	const normalizedToIndex = Math.max(normalizedFromIndex, Math.max(request.fromIndex, request.toIndex));
	const fromEntry = request.entries[normalizedFromIndex];
	const toEntry = request.entries[normalizedToIndex];
	if (!fromEntry || !toEntry) {
		return undefined;
	}

	return { fromEntry, toEntry };
}

function syncSession(request: { target: ExtensionTimelineSession; source: ExtensionTimelineSession }): void {
	request.target.adapter = request.source.adapter;
	request.target.backend = request.source.backend;
	request.target.workspacePath = request.source.workspacePath;
	request.target.relativePath = request.source.relativePath;
	request.target.absolutePath = request.source.absolutePath;
	request.target.fileName = request.source.fileName;
	request.target.entries = request.source.entries;
	request.target.snapshotEntries = request.source.snapshotEntries;
	request.target.snapshotLoadedChangeIds = request.source.snapshotLoadedChangeIds;
	request.target.snapshotPendingChangeIds = request.source.snapshotPendingChangeIds;
	request.target.workspaceFiles = request.source.workspaceFiles;
	request.target.contentCache = request.source.contentCache;
	request.target.previewCache = request.source.previewCache;
	request.target.rangeOverviewCache = request.source.rangeOverviewCache;
	request.target.entryDiffCountCache = request.source.entryDiffCountCache;
	request.target.pathCache = request.source.pathCache;
	request.target.activeActionAbortController = request.source.activeActionAbortController;
}

async function getContentForRevset(request: {
	session: ExtensionTimelineSession;
	revset: string;
	filePath: string;
}): Promise<string> {
	const cacheKey = `revset:${request.revset}:${request.filePath}`;
	const cached = request.session.contentCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const content = await request.session.adapter.showFileAtRevision({
		workspacePath: request.session.workspacePath,
		revset: request.revset,
		filePath: request.filePath,
	});
	request.session.contentCache.set(cacheKey, content);
	return content;
}

async function resolvePreviousPathAcrossRevision(request: {
	session: ExtensionTimelineSession;
	entry: FileRevisionEntry;
	currentPath: string;
}): Promise<string> {
	const cacheKey = `${request.entry.revision}:${request.currentPath}`;
	const cached = request.session.pathCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const previousPath = await request.session.adapter.resolvePreviousPath({
		workspacePath: request.session.workspacePath,
		revision: request.entry.revision,
		currentPath: request.currentPath,
	});
	request.session.pathCache.set(cacheKey, previousPath);
	return previousPath;
}

export function createTimelineService(args: { runner: CommandRunner }) {
	const { runner } = args;

	return {
		buildSession,
		buildPayload,
		findNearestNonEmptyVisibleRange,
		getComparisonEntries,
		getDiffPreview,
		getEntryDiffCounts,
		getEntriesForSource,
		getRangeOverview,
		hydrateSnapshotEntries,
		runSessionAction,
		resolveEntryFilePath,
		syncSession,
	};

	async function buildSession(request: {
		workspacePath: string;
		absolutePath: string;
	}): Promise<ExtensionTimelineSession> {
		const relativePath = path.relative(request.workspacePath, request.absolutePath).replace(/\\/g, '/');
		const adapter = await resolveHistoryAdapter({ workspacePath: request.workspacePath, runner });
		const workspaceFiles = await listWorkspaceFiles({ adapter, workspacePath: request.workspacePath });
		const fileEntries = await adapter.getFileRevisionHistory({
			workspacePath: request.workspacePath,
			relativePath,
		});
		const entries = await buildTimelineEntries({
			adapter,
			workspacePath: request.workspacePath,
			absolutePath: request.absolutePath,
			relativePath,
			fileEntries,
		});
		const snapshotEntries = adapter.backend === 'jj' ? [] : [...entries];
		const remoteBaseUrl = await adapter.getRemoteBaseUrl({ workspacePath: request.workspacePath });

		if (remoteBaseUrl) {
			for (const entry of entries) {
				if (!entry.isWorkingTree) {
					entry.remoteUrl = `${remoteBaseUrl}/commit/${entry.revision}`;
				}
			}
		}

		return {
			adapter,
			backend: adapter.backend,
			workspacePath: request.workspacePath,
			absolutePath: request.absolutePath,
			relativePath,
			fileName: path.basename(request.absolutePath),
			entries,
			snapshotEntries,
			snapshotLoadedChangeIds: new Set(),
			snapshotPendingChangeIds: new Set(),
			workspaceFiles,
			contentCache: new Map(),
			previewCache: new Map(),
			rangeOverviewCache: new Map(),
			entryDiffCountCache: new Map(),
			pathCache: new Map(),
			activeActionAbortController: undefined,
		};
	}

	function buildPayload(request: TimelinePayloadArgs): TimelineData {
		const mapEntries = (entries: FileRevisionEntry[]) =>
			entries.map((entry, index) => ({
				...entry,
				index,
				hasPreviousEntry: index > 0,
				monthLabel: formatEntryMonthLabel(entry.authorDate),
				shortDate: formatEntryShortDate(entry.authorDate),
				relativeDate: formatRelativeTime(entry.timestamp),
			}));

		return {
			backend: request.session.backend,
			workspacePath: request.session.workspacePath,
			relativePath: request.session.relativePath,
			fileName: request.session.fileName,
			version: request.version,
			presets: request.presets,
			defaultIndex: Math.max(0, request.session.entries.length - 1),
			latestIndex: Math.max(0, request.session.entries.length - 1),
			preferences: normalizeTimelinePreferences(request.preferences),
			workspaceFiles: request.session.workspaceFiles,
			hasIntermediateRevisions: request.session.entries.some((entry) => !entry.touchesFile),
			entries: mapEntries(request.session.entries),
			snapshotEntries: mapEntries(request.session.snapshotEntries),
			snapshotState: {
				loadedChangeIds: [...request.session.snapshotLoadedChangeIds],
			},
		};
	}

	function getEntriesForSource(request: {
		session: ExtensionTimelineSession;
		comparisonSource: ComparisonSource;
	}): FileRevisionEntry[] {
		if (request.session.backend !== 'jj' || request.comparisonSource !== 'snapshot') {
			return request.session.entries;
		}

		return composeSnapshotEntries({
			revisionEntries: request.session.entries,
			snapshotEntries: request.session.snapshotEntries,
			loadedChangeIds: request.session.snapshotLoadedChangeIds,
		});
	}

	async function getDiffPreview(request: {
		session: ExtensionTimelineSession;
		fromIndex: number;
		toIndex: number;
		comparisonSource?: ComparisonSource;
	}): Promise<DiffPreview> {
		const comparisonSource = request.comparisonSource || 'revision';
		const sourceEntries = getEntriesForSource({
			session: request.session,
			comparisonSource,
		});
		const normalizedFromIndex = Math.max(0, Math.min(request.fromIndex, request.toIndex));
		const normalizedToIndex = Math.max(normalizedFromIndex, Math.max(request.fromIndex, request.toIndex));
		const cacheKey = `${comparisonSource}:${normalizedFromIndex}:${normalizedToIndex}`;
		const cached = request.session.previewCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		if (request.session.backend === 'jj' && comparisonSource === 'snapshot') {
			const preview = await getJjSnapshotPreview({
				session: request.session,
				fromIndex: normalizedFromIndex,
				toIndex: normalizedToIndex,
			});
			request.session.previewCache.set(cacheKey, preview);
			return preview;
		}

		const comparison = getComparisonEntries({
			entries: sourceEntries,
			fromIndex: normalizedFromIndex,
			toIndex: normalizedToIndex,
		});
		if (!comparison) {
			return createEmptyPreview({
				index: normalizedToIndex,
				fromIndex: normalizedFromIndex,
				toIndex: normalizedToIndex,
				comparisonSource,
				title: 'No revision selected',
			});
		}

		const beforePath = comparison.fromEntry
			? await resolveEntryFilePath({
					session: request.session,
					entry: comparison.fromEntry,
					entryIndex: normalizedFromIndex,
				})
			: '';
		const afterPath = await resolveEntryFilePath({
			session: request.session,
			entry: comparison.toEntry,
			entryIndex: normalizedToIndex,
		});
		const beforeText = comparison.fromEntry
			? await getRevisionContent({
					session: request.session,
					entry: comparison.fromEntry,
					entryIndex: normalizedFromIndex,
				})
			: '';
		const afterText = await getRevisionContent({
			session: request.session,
			entry: comparison.toEntry,
			entryIndex: normalizedToIndex,
		});
		const preview = buildDiffPreview({
			index: normalizedToIndex,
			previousEntry: comparison.fromEntry,
			currentEntry: comparison.toEntry,
			beforeText,
			afterText,
			fromIndex: normalizedFromIndex,
			toIndex: normalizedToIndex,
			beforePath,
			afterPath,
			comparisonSource,
		});
		request.session.previewCache.set(cacheKey, preview);
		return preview;
	}

	async function hydrateSnapshotEntries(request: {
		session: ExtensionTimelineSession;
		revisionIndexes: number[];
	}): Promise<boolean> {
		if (request.session.backend !== 'jj') {
			return false;
		}

		const uniqueTargets = request.revisionIndexes
			.map((index) => request.session.entries[index])
			.filter((entry): entry is FileRevisionEntry =>
				Boolean(
					entry &&
					!entry.isWorkingTree &&
					entry.touchesFile &&
					entry.changeId &&
					!request.session.snapshotLoadedChangeIds.has(entry.changeId) &&
					!request.session.snapshotPendingChangeIds.has(entry.changeId),
				),
			)
			.reduce<FileRevisionEntry[]>((entries, entry) => {
				if (!entry.changeId || entries.some((candidate) => candidate.changeId === entry.changeId)) {
					return entries;
				}

				entries.push(entry);
				return entries;
			}, [])
			.slice(-MAX_SNAPSHOT_HYDRATION_CHANGES);

		if (!uniqueTargets.length) {
			return false;
		}

		let didUpdate = false;
		for (const entry of uniqueTargets) {
			const changeId = entry.changeId;
			if (!changeId) {
				continue;
			}

			request.session.snapshotPendingChangeIds.add(changeId);
			const expandedEntries = await request.session.adapter.getSnapshotEntriesForFile({
				workspacePath: request.session.workspacePath,
				relativePath: request.session.relativePath,
				entry,
			});
			request.session.snapshotPendingChangeIds.delete(changeId);
			request.session.snapshotLoadedChangeIds.add(changeId);

			if (expandedEntries.length) {
				request.session.snapshotEntries.push(...expandedEntries);
				didUpdate = true;
			}
		}

		if (!didUpdate) {
			return true;
		}

		request.session.snapshotEntries = request.session.snapshotEntries.toSorted(
			(left, right) => left.timestamp - right.timestamp || left.revision.localeCompare(right.revision),
		);
		for (const cacheKey of request.session.previewCache.keys()) {
			if (cacheKey.startsWith('snapshot:')) {
				request.session.previewCache.delete(cacheKey);
			}
		}
		for (const cacheKey of request.session.rangeOverviewCache.keys()) {
			if (cacheKey.startsWith('snapshot:')) {
				request.session.rangeOverviewCache.delete(cacheKey);
			}
		}
		for (const cacheKey of request.session.entryDiffCountCache.keys()) {
			if (cacheKey.startsWith('snapshot:')) {
				request.session.entryDiffCountCache.delete(cacheKey);
			}
		}

		return true;
	}

	async function findNearestNonEmptyVisibleRange(request: {
		session: ExtensionTimelineSession;
		candidateIndexes: number[];
	}): Promise<{ fromIndex: number; toIndex: number } | null> {
		if (request.candidateIndexes.length < 2) {
			return null;
		}

		for (let index = request.candidateIndexes.length - 1; index > 0; index -= 1) {
			const fromIndex = request.candidateIndexes[index - 1];
			const toIndex = request.candidateIndexes[index];
			const preview = await getDiffPreview({
				session: request.session,
				fromIndex,
				toIndex,
			});
			if (preview.hasChanges) {
				return { fromIndex, toIndex };
			}
		}

		return null;
	}

	async function getRangeOverview(request: {
		session: ExtensionTimelineSession;
		fromIndex: number;
		toIndex: number;
		comparisonSource?: ComparisonSource;
		selectedEntryIndexes?: number[];
	}): Promise<RangeOverviewItem[]> {
		const comparisonSource = request.comparisonSource || 'revision';
		const normalizedFromIndex = Math.max(0, Math.min(request.fromIndex, request.toIndex));
		const normalizedToIndex = Math.max(normalizedFromIndex, Math.max(request.fromIndex, request.toIndex));
		const selectedEntryIndexes = (request.selectedEntryIndexes || []).filter((value) => Number.isInteger(value));
		const selectedKey = selectedEntryIndexes.length ? selectedEntryIndexes.join(',') : 'all';
		const cacheKey = `${comparisonSource}:${normalizedFromIndex}:${normalizedToIndex}:${selectedKey}`;
		const cached = request.session.rangeOverviewCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		const sourceEntries = getEntriesForSource({
			session: request.session,
			comparisonSource,
		});
		const countedPaths = new Map<string, number>();
		const workspaceFileSet = new Set(request.session.workspaceFiles);
		const entryIndexesToScan = selectedEntryIndexes.length
			? selectedEntryIndexes
			: Array.from({ length: normalizedToIndex - normalizedFromIndex }, (_, index) => normalizedFromIndex + index + 1);

		for (const index of entryIndexesToScan) {
			const entry = sourceEntries[index];
			if (!entry) {
				continue;
			}

			const changedFiles = entry.isWorkingTree
				? await request.session.adapter.listWorkingTreeFiles({ workspacePath: request.session.workspacePath })
				: await request.session.adapter.listRevisionFiles({
						workspacePath: request.session.workspacePath,
						revision: entry.revision,
					});

			for (const relativePath of changedFiles) {
				if (!relativePath || (!workspaceFileSet.has(relativePath) && relativePath !== request.session.relativePath)) {
					continue;
				}

				countedPaths.set(relativePath, (countedPaths.get(relativePath) || 0) + 1);
			}
		}

		const items = [...countedPaths.entries()]
			.map(([relativePath, changeCount]) => ({
				relativePath,
				changeCount,
				isCurrentFile: relativePath === request.session.relativePath,
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

		request.session.rangeOverviewCache.set(cacheKey, items);
		return items;
	}

	async function getEntryDiffCounts(request: {
		session: ExtensionTimelineSession;
		entryIndexes: number[];
		comparisonSource?: ComparisonSource;
	}): Promise<Array<{ entryIndex: number; diffCount: number }>> {
		const comparisonSource = request.comparisonSource || 'revision';
		const sourceEntries = getEntriesForSource({
			session: request.session,
			comparisonSource,
		});

		return Promise.all(
			request.entryIndexes.map(async (entryIndex) => {
				const cacheKey = `${comparisonSource}:${entryIndex}`;
				const cached = request.session.entryDiffCountCache.get(cacheKey);
				if (cached !== undefined) {
					return { entryIndex, diffCount: cached };
				}

				const entry = sourceEntries[entryIndex];
				if (!entry || entryIndex <= 0) {
					request.session.entryDiffCountCache.set(cacheKey, 0);
					return { entryIndex, diffCount: 0 };
				}

				let diffCount = 0;
				if (entry.isWorkingTree) {
					const previousEntry = sourceEntries[entryIndex - 1];
					if (previousEntry) {
						const plan = await request.session.adapter.buildRangeMultiDiffPlan({
							workspacePath: request.session.workspacePath,
							fromEntry: previousEntry,
							toEntry: entry,
							comparisonSource,
							sourceEntries,
						});
						diffCount = plan.files.length;
					}
				} else {
					const plan = await request.session.adapter.buildRevisionMultiDiffPlan({
						workspacePath: request.session.workspacePath,
						entry,
						entryIndex,
						comparisonSource,
						sourceEntries,
					});
					diffCount = plan.files.length;
				}

				request.session.entryDiffCountCache.set(cacheKey, diffCount);
				return { entryIndex, diffCount };
			}),
		);
	}

	async function resolveEntryFilePath(request: {
		session: ExtensionTimelineSession;
		entry: FileRevisionEntry;
		entryIndex: number;
	}): Promise<string> {
		if (request.entry.isWorkingTree) {
			return request.session.relativePath;
		}

		if (request.entry.filePath) {
			return request.entry.filePath;
		}

		await ensureEntryFilePath(request);
		return request.entry.filePath || request.session.relativePath;
	}

	async function runSessionAction(request: {
		session: ExtensionTimelineSession;
		action: SessionAction;
	}): Promise<void> {
		request.session.activeActionAbortController?.abort();
		const controller = new AbortController();
		request.session.activeActionAbortController = controller;

		try {
			await request.action(controller.signal);
		} catch (error) {
			if (isAbortError(error) || controller.signal.aborted) {
				return;
			}
			throw error;
		} finally {
			if (request.session.activeActionAbortController === controller) {
				request.session.activeActionAbortController = undefined;
			}
		}
	}

	async function buildTimelineEntries(request: {
		adapter: HistoryAdapter;
		workspacePath: string;
		absolutePath: string;
		relativePath: string;
		fileEntries: FileRevisionEntry[];
	}): Promise<FileRevisionEntry[]> {
		const touchingEntries = request.fileEntries.map((entry) => ({
			...entry,
			touchesFile: true,
		}));

		if (touchingEntries.length) {
			touchingEntries[touchingEntries.length - 1].filePath = request.relativePath;
		}

		let entries = touchingEntries;
		if (touchingEntries.length >= 2) {
			try {
				const repositoryEntries = await request.adapter.getRepositoryRevisionHistory({
					workspacePath: request.workspacePath,
				});
				entries = mergeTimelineEntries({ repositoryEntries, fileEntries: touchingEntries });
			} catch {
				entries = touchingEntries;
			}
		}

		if (request.adapter.backend === 'jj') {
			entries = dedupeAdjacentTimelineEntries(entries);
		}

		return appendWorkingTreeEntry({
			adapter: request.adapter,
			workspacePath: request.workspacePath,
			absolutePath: request.absolutePath,
			relativePath: request.relativePath,
			entries,
		});
	}

	async function listWorkspaceFiles(request: { adapter: HistoryAdapter; workspacePath: string }): Promise<string[]> {
		if (request.adapter.backend === 'git') {
			try {
				const { stdout } = await runner.runGit({
					workspacePath: request.workspacePath,
					args: ['ls-files', '--cached', '-z'],
				});
				const files = stdout
					.split('\u0000')
					.map((value) => value.trim())
					.filter(Boolean)
					.toSorted((left, right) => left.localeCompare(right));
				if (files.length) {
					return files;
				}
			} catch {
				// Fall back to filesystem traversal.
			}
		}

		if (request.adapter.backend === 'jj') {
			try {
				const { stdout } = await runner.runJj({
					workspacePath: request.workspacePath,
					args: ['file', 'list'],
				});
				const files = stdout
					.split(/\r?\n/u)
					.map((value) => value.trim())
					.filter(Boolean)
					.toSorted((left, right) => left.localeCompare(right));
				if (files.length) {
					return files;
				}
			} catch {
				// Fall back to filesystem traversal.
			}
		}

		const files: string[] = [];
		await collectWorkspaceFiles({
			workspacePath: request.workspacePath,
			currentDirectory: request.workspacePath,
			files,
		});
		return files.toSorted((left, right) => left.localeCompare(right));
	}

	async function collectWorkspaceFiles(request: {
		workspacePath: string;
		currentDirectory: string;
		files: string[];
	}): Promise<void> {
		const directoryEntries = await readdir(request.currentDirectory, { withFileTypes: true });
		for (const directoryEntry of directoryEntries) {
			if (directoryEntry.isDirectory() && IGNORED_WORKSPACE_DIRECTORIES.has(directoryEntry.name)) {
				continue;
			}

			const absolutePath = path.join(request.currentDirectory, directoryEntry.name);
			if (directoryEntry.isDirectory()) {
				await collectWorkspaceFiles({
					workspacePath: request.workspacePath,
					currentDirectory: absolutePath,
					files: request.files,
				});
				continue;
			}

			if (!directoryEntry.isFile()) {
				continue;
			}

			request.files.push(path.relative(request.workspacePath, absolutePath).replace(/\\/g, '/'));
		}
	}

	async function appendWorkingTreeEntry(request: {
		adapter: HistoryAdapter;
		workspacePath: string;
		absolutePath: string;
		relativePath: string;
		entries: FileRevisionEntry[];
	}): Promise<FileRevisionEntry[]> {
		if (!(await runner.fileExists({ filePath: request.absolutePath }))) {
			return request.entries;
		}

		const lastEntry = request.entries.at(-1);
		const lastTouchingEntry = request.entries.filter((entry) => entry.touchesFile && !entry.isWorkingTree).at(-1);
		if (lastEntry?.isWorkingTree) {
			return request.entries;
		}

		if (lastTouchingEntry) {
			const currentContent = await readFile(request.absolutePath, 'utf8');
			const previousContent = await request.adapter.showFileAtRevision({
				workspacePath: request.workspacePath,
				revset: lastTouchingEntry.revision,
				filePath: lastTouchingEntry.filePath || request.relativePath,
			});
			if (
				currentContent === previousContent &&
				(lastTouchingEntry.filePath || request.relativePath) === request.relativePath
			) {
				return request.entries;
			}
		}

		const now = new Date();
		return [
			...request.entries,
			{
				id: 'working-tree',
				revision: 'WORKTREE',
				shortRevision: 'Current',
				changeId: undefined,
				authorDate: now.toISOString(),
				authorName: '',
				description: 'Working tree',
				isWorkingTree: true,
				touchesFile: true,
				timestamp: now.getTime(),
				filePath: request.relativePath,
			},
		];
	}

	function composeSnapshotEntries(request: {
		revisionEntries: FileRevisionEntry[];
		snapshotEntries: FileRevisionEntry[];
		loadedChangeIds: Set<string>;
	}): FileRevisionEntry[] {
		if (!request.loadedChangeIds.size) {
			return request.revisionEntries;
		}

		const snapshotEntriesByChangeId = request.snapshotEntries.reduce((groups, entry) => {
			if (!entry.changeId) {
				return groups;
			}
			const existing = groups.get(entry.changeId) || [];
			existing.push(entry);
			groups.set(entry.changeId, existing);
			return groups;
		}, new Map<string, FileRevisionEntry[]>());

		return request.revisionEntries.flatMap((entry) => {
			if (
				entry.isWorkingTree ||
				!entry.touchesFile ||
				!entry.changeId ||
				!request.loadedChangeIds.has(entry.changeId)
			) {
				return [entry];
			}

			return snapshotEntriesByChangeId.get(entry.changeId) || [entry];
		});
	}

	async function getJjSnapshotPreview(request: {
		session: ExtensionTimelineSession;
		fromIndex: number;
		toIndex: number;
	}): Promise<DiffPreview> {
		const sourceEntries = getEntriesForSource({ session: request.session, comparisonSource: 'snapshot' });
		const normalizedFromIndex = Math.max(0, Math.min(request.fromIndex, request.toIndex));
		const normalizedToIndex = Math.max(normalizedFromIndex, Math.max(request.fromIndex, request.toIndex));
		const entry = sourceEntries[normalizedToIndex];
		if (!entry) {
			return createEmptyPreview({
				index: normalizedToIndex,
				fromIndex: normalizedFromIndex,
				toIndex: normalizedToIndex,
				comparisonSource: 'snapshot',
				title: 'No revision selected',
			});
		}

		const afterPath = await resolveEntryFilePath({
			session: request.session,
			entry,
			entryIndex: normalizedToIndex,
		});
		const previousEntryIndex = normalizedFromIndex === normalizedToIndex ? normalizedToIndex - 1 : normalizedFromIndex;
		const previousEntry = previousEntryIndex >= 0 ? sourceEntries[previousEntryIndex] : undefined;
		const previousPath = previousEntry
			? await resolveEntryFilePath({
					session: request.session,
					entry: previousEntry,
					entryIndex: previousEntryIndex,
				})
			: entry.isWorkingTree
				? request.session.relativePath
				: await resolvePreviousPathAcrossRevision({
						session: request.session,
						entry,
						currentPath: afterPath,
					});
		const beforeText = previousEntry
			? await getRevisionContent({
					session: request.session,
					entry: previousEntry,
					entryIndex: previousEntryIndex,
				})
			: entry.isWorkingTree
				? ''
				: await getContentForRevset({
						session: request.session,
						revset: `${entry.revision}-`,
						filePath: previousPath,
					});
		const afterText = await getRevisionContent({
			session: request.session,
			entry,
			entryIndex: normalizedToIndex,
		});

		return {
			...buildDiffPreview({
				index: normalizedToIndex,
				previousEntry,
				currentEntry: entry,
				beforeText,
				afterText,
				fromIndex: normalizedFromIndex,
				toIndex: normalizedToIndex,
				beforePath: previousPath,
				afterPath,
				comparisonSource: 'snapshot',
			}),
			title: entry.isWorkingTree ? `Snapshot @ ${entry.shortRevision}` : `Snapshot ${entry.shortRevision}`,
		};
	}

	async function getRevisionContent(request: {
		session: ExtensionTimelineSession;
		entry: FileRevisionEntry;
		entryIndex: number;
	}): Promise<string> {
		const resolvedPath = request.entry.isWorkingTree
			? request.session.relativePath
			: await resolveEntryFilePath(request);
		const cacheKey = `${request.entry.id}:${resolvedPath}`;
		const cached = request.session.contentCache.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}

		const content = request.entry.isWorkingTree
			? await readFile(request.session.absolutePath, 'utf8')
			: await request.session.adapter.showFileAtRevision({
					workspacePath: request.session.workspacePath,
					revset: request.entry.revision,
					filePath: resolvedPath,
				});
		request.session.contentCache.set(cacheKey, content);
		return content;
	}

	async function ensureEntryFilePath(request: {
		session: ExtensionTimelineSession;
		entry: FileRevisionEntry;
		entryIndex: number;
	}): Promise<void> {
		const targetEntry = request.session.entries[request.entryIndex];
		if (!targetEntry || targetEntry.filePath || targetEntry.isWorkingTree) {
			return;
		}

		let knownIndex = -1;
		for (let index = request.entryIndex + 1; index < request.session.entries.length; index += 1) {
			if (request.session.entries[index]?.filePath) {
				knownIndex = index;
				break;
			}
		}

		if (knownIndex < 0) {
			targetEntry.filePath = request.session.relativePath;
			return;
		}

		let currentPath = request.session.entries[knownIndex].filePath || request.session.relativePath;
		for (let index = knownIndex; index > request.entryIndex; index -= 1) {
			const currentEntry = request.session.entries[index];
			const previousEntry = request.session.entries[index - 1];
			if (!previousEntry) {
				break;
			}

			if (!previousEntry.filePath) {
				let previousPath = currentPath;
				if (currentEntry.touchesFile && !currentEntry.isWorkingTree) {
					previousPath = await resolvePreviousPathAcrossRevision({
						session: request.session,
						entry: currentEntry,
						currentPath,
					});
				}
				previousEntry.filePath = previousPath;
			}

			currentPath = previousEntry.filePath || currentPath;
		}
	}
}

export function normalizeTimelinePreferences(
	preferences: TimelinePreferences | null | undefined,
): Required<TimelinePreferences> {
	if (!preferences) {
		return { ...DEFAULT_TIMELINE_PREFERENCES };
	}

	return {
		sidebarWidth:
			typeof preferences.sidebarWidth === 'number'
				? preferences.sidebarWidth
				: DEFAULT_TIMELINE_PREFERENCES.sidebarWidth,
		sidebarCollapsed: preferences.sidebarCollapsed === true,
		timelinePaneHeight:
			typeof preferences.timelinePaneHeight === 'number'
				? preferences.timelinePaneHeight
				: DEFAULT_TIMELINE_PREFERENCES.timelinePaneHeight,
		timelinePaneCollapsed: preferences.timelinePaneCollapsed === true,
		layoutMode: preferences.layoutMode === 'unified' ? 'unified' : DEFAULT_TIMELINE_PREFERENCES.layoutMode,
		contentMode: preferences.contentMode === 'full' ? 'full' : DEFAULT_TIMELINE_PREFERENCES.contentMode,
		comparisonMode: preferences.comparisonMode === 'step' ? 'step' : DEFAULT_TIMELINE_PREFERENCES.comparisonMode,
		comparisonSource:
			preferences.comparisonSource === 'snapshot' ? 'snapshot' : DEFAULT_TIMELINE_PREFERENCES.comparisonSource,
		showIntermediateRevisions: preferences.showIntermediateRevisions === true,
		preset:
			preferences.preset && Object.hasOwn(DEFAULT_TIMELINE_PREFERENCES, 'preset')
				? preferences.preset
				: DEFAULT_TIMELINE_PREFERENCES.preset,
	};
}

function createEmptyPreview(args: {
	index: number;
	fromIndex: number;
	toIndex: number;
	comparisonSource: ComparisonSource;
	title: string;
}): DiffPreview {
	return {
		index: args.index,
		title: args.title,
		subtitle: '',
		diffCount: 0,
		additions: 0,
		deletions: 0,
		hunkCount: 0,
		hasChanges: false,
		fromIndex: args.fromIndex,
		toIndex: args.toIndex,
		comparisonSource: args.comparisonSource,
		rows: [],
		nonTextualDetails: [],
	};
}

function buildDiffPreview(args: {
	index: number;
	previousEntry?: FileRevisionEntry;
	currentEntry: FileRevisionEntry;
	beforeText: string;
	afterText: string;
	fromIndex: number;
	toIndex: number;
	beforePath: string;
	afterPath: string;
	comparisonSource: ComparisonSource;
}): DiffPreview {
	const textsMatch = textsMatchIgnoringLineEndings(args.beforeText, args.afterText);
	const title = args.previousEntry
		? `${args.previousEntry.shortRevision} -> ${args.currentEntry.shortRevision}`
		: `Initial revision -> ${args.currentEntry.shortRevision}`;
	const subtitle = args.currentEntry.isWorkingTree
		? 'Working tree'
		: `${formatEntryDateTime(args.currentEntry.authorDate)} · ${args.currentEntry.description}`;

	if (textsMatch) {
		return {
			index: args.index,
			title,
			subtitle,
			diffCount: 0,
			additions: 0,
			deletions: 0,
			hunkCount: 0,
			hasChanges: false,
			fromIndex: args.fromIndex,
			toIndex: args.toIndex,
			comparisonSource: args.comparisonSource,
			rows: buildNoChangeRows(splitIntoLines(args.afterText)),
			nonTextualDetails: buildNonTextualDetails(args),
		};
	}

	const beforeLines = splitIntoLines(args.beforeText);
	const afterLines = splitIntoLines(args.afterText);
	const operations = diffLineOperations({ beforeLines, afterLines });
	const rows = materializeDiffRows(operations);
	const additions = rows.filter((row) => row.type === 'add').length;
	const deletions = rows.filter((row) => row.type === 'remove').length;
	const hunkCount = countDiffHunks(rows);
	const hasChanges = additions > 0 || deletions > 0;

	return {
		index: args.index,
		title,
		subtitle,
		diffCount: 0,
		additions,
		deletions,
		hunkCount,
		hasChanges,
		fromIndex: args.fromIndex,
		toIndex: args.toIndex,
		comparisonSource: args.comparisonSource,
		rows,
		nonTextualDetails: hasChanges ? [] : buildNonTextualDetails(args),
	};
}

function buildNonTextualDetails(args: {
	previousEntry?: FileRevisionEntry;
	currentEntry: FileRevisionEntry;
	beforeText: string;
	afterText: string;
	beforePath: string;
	afterPath: string;
}): string[] {
	const details: string[] = [];

	if (args.previousEntry && args.beforePath && args.afterPath && args.beforePath !== args.afterPath) {
		details.push(`Path changed: ${args.beforePath} -> ${args.afterPath}`);
	}

	if (args.beforeText !== args.afterText && textsMatchIgnoringLineEndings(args.beforeText, args.afterText)) {
		details.push('Line endings changed.');
	}

	if (!details.length && args.currentEntry.isWorkingTree) {
		details.push('The working tree differs in a way this preview does not render as a textual line diff.');
	}

	if (!details.length) {
		details.push(
			'This selection changed file metadata or another non-text detail that is not shown in the inline preview.',
		);
	}

	return details;
}

function mergeTimelineEntries(args: {
	repositoryEntries: FileRevisionEntry[];
	fileEntries: FileRevisionEntry[];
}): FileRevisionEntry[] {
	const touchingByRevision = new Map(args.fileEntries.map((entry) => [entry.revision, entry]));
	const repoIndexes = args.fileEntries
		.map((entry) => args.repositoryEntries.findIndex((candidate) => candidate.revision === entry.revision))
		.filter((index) => index >= 0);

	if (!repoIndexes.length) {
		return args.fileEntries;
	}

	const startIndex = Math.min(...repoIndexes);
	const endIndex = Math.max(...repoIndexes);
	const merged = args.repositoryEntries
		.slice(startIndex, endIndex + 1)
		.map((entry) => touchingByRevision.get(entry.revision) || entry);

	for (const entry of args.fileEntries) {
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

function countDiffHunks(rows: DiffRow[]): number {
	let hunks = 0;
	let inChange = false;

	for (const row of rows) {
		const isChange = row.type === 'add' || row.type === 'remove';
		if (isChange && !inChange) {
			hunks += 1;
			inChange = true;
			continue;
		}

		if (!isChange) {
			inChange = false;
		}
	}

	return hunks;
}

function splitIntoLines(value: string): string[] {
	if (!value) {
		return [];
	}

	const normalized = value.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	if (lines.at(-1) === '') {
		lines.pop();
	}
	return lines;
}

function diffLineOperations(args: {
	beforeLines: string[];
	afterLines: string[];
}): Array<{ type: 'context' | 'add' | 'remove'; text: string }> {
	if (!args.beforeLines.length) {
		return args.afterLines.map((text) => ({ type: 'add' as const, text }));
	}

	if (!args.afterLines.length) {
		return args.beforeLines.map((text) => ({ type: 'remove' as const, text }));
	}

	if (args.beforeLines.length * args.afterLines.length > 1_200_000) {
		return buildFallbackOperations(args);
	}

	const matrix = Array.from({ length: args.beforeLines.length + 1 }, () => new Uint32Array(args.afterLines.length + 1));

	for (let leftIndex = args.beforeLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
		for (let rightIndex = args.afterLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
			matrix[leftIndex][rightIndex] =
				args.beforeLines[leftIndex] === args.afterLines[rightIndex]
					? matrix[leftIndex + 1][rightIndex + 1] + 1
					: Math.max(matrix[leftIndex + 1][rightIndex], matrix[leftIndex][rightIndex + 1]);
		}
	}

	const operations: Array<{ type: 'context' | 'add' | 'remove'; text: string }> = [];
	let leftIndex = 0;
	let rightIndex = 0;

	while (leftIndex < args.beforeLines.length && rightIndex < args.afterLines.length) {
		if (args.beforeLines[leftIndex] === args.afterLines[rightIndex]) {
			operations.push({ type: 'context', text: args.beforeLines[leftIndex] });
			leftIndex += 1;
			rightIndex += 1;
			continue;
		}

		if (matrix[leftIndex + 1][rightIndex] >= matrix[leftIndex][rightIndex + 1]) {
			operations.push({ type: 'remove', text: args.beforeLines[leftIndex] });
			leftIndex += 1;
			continue;
		}

		operations.push({ type: 'add', text: args.afterLines[rightIndex] });
		rightIndex += 1;
	}

	while (leftIndex < args.beforeLines.length) {
		operations.push({ type: 'remove', text: args.beforeLines[leftIndex] });
		leftIndex += 1;
	}

	while (rightIndex < args.afterLines.length) {
		operations.push({ type: 'add', text: args.afterLines[rightIndex] });
		rightIndex += 1;
	}

	return operations;
}

function buildFallbackOperations(args: {
	beforeLines: string[];
	afterLines: string[];
}): Array<{ type: 'context' | 'add' | 'remove'; text: string }> {
	const operations: Array<{ type: 'context' | 'add' | 'remove'; text: string }> = [];
	let prefix = 0;
	while (
		prefix < args.beforeLines.length &&
		prefix < args.afterLines.length &&
		args.beforeLines[prefix] === args.afterLines[prefix]
	) {
		prefix += 1;
	}

	let beforeSuffix = args.beforeLines.length - 1;
	let afterSuffix = args.afterLines.length - 1;
	while (
		beforeSuffix >= prefix &&
		afterSuffix >= prefix &&
		args.beforeLines[beforeSuffix] === args.afterLines[afterSuffix]
	) {
		beforeSuffix -= 1;
		afterSuffix -= 1;
	}

	for (const text of args.beforeLines.slice(0, prefix)) {
		operations.push({ type: 'context', text });
	}
	for (const text of args.beforeLines.slice(prefix, beforeSuffix + 1)) {
		operations.push({ type: 'remove', text });
	}
	for (const text of args.afterLines.slice(prefix, afterSuffix + 1)) {
		operations.push({ type: 'add', text });
	}
	for (const text of args.beforeLines.slice(beforeSuffix + 1)) {
		operations.push({ type: 'context', text });
	}

	return operations;
}

function materializeDiffRows(operations: Array<{ type: 'context' | 'add' | 'remove'; text: string }>): DiffRow[] {
	const rows: DiffRow[] = [];
	let leftNumber = 1;
	let rightNumber = 1;

	for (const operation of operations) {
		if (operation.type === 'context') {
			rows.push({
				type: 'context',
				leftNumber,
				rightNumber,
				text: operation.text,
			});
			leftNumber += 1;
			rightNumber += 1;
			continue;
		}

		if (operation.type === 'remove') {
			rows.push({
				type: 'remove',
				leftNumber,
				rightNumber: null,
				text: operation.text,
			});
			leftNumber += 1;
			continue;
		}

		rows.push({
			type: 'add',
			leftNumber: null,
			rightNumber,
			text: operation.text,
		});
		rightNumber += 1;
	}

	return rows;
}

function buildNoChangeRows(afterLines: string[]): DiffRow[] {
	return afterLines.slice(0, 80).map((text, index) => ({
		type: 'context',
		leftNumber: index + 1,
		rightNumber: index + 1,
		text,
	}));
}

function formatEntryMonthLabel(authorDate: string): string {
	const date = new Date(authorDate);
	if (Number.isNaN(date.getTime())) {
		return 'Unknown month';
	}

	return new Intl.DateTimeFormat('en', { month: 'long' }).format(date);
}

function formatEntryShortDate(authorDate: string): string {
	const date = new Date(authorDate);
	if (Number.isNaN(date.getTime())) {
		return 'Unknown date';
	}

	return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatRelativeTime(timestamp: number): string {
	const deltaSeconds = Math.round((timestamp - Date.now()) / 1000);
	const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	const divisions: Array<[Intl.RelativeTimeFormatUnit, number]> = [
		['day', 60 * 60 * 24],
		['hour', 60 * 60],
		['minute', 60],
	];

	for (const [unit, amount] of divisions) {
		if (Math.abs(deltaSeconds) >= amount || unit === 'minute') {
			return formatter.format(Math.round(deltaSeconds / amount), unit);
		}
	}

	return formatter.format(deltaSeconds, 'second');
}

function formatEntryDateTime(authorDate: string): string {
	const date = new Date(authorDate);
	if (Number.isNaN(date.getTime())) {
		return 'Unknown time';
	}

	return date.toLocaleString();
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message));
}
