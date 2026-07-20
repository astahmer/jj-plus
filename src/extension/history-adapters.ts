import path from 'node:path';

import {
	dedupeAdjacentEntriesByChangeId,
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
import type { FileRevisionEntry } from '../shared/timeline-types.ts';
import { MAX_TIMELINE_ENTRIES } from './constants.ts';
import type { CommandRunner, HistoryAdapter } from './types.ts';

export async function resolveHistoryAdapter(args: {
	workspacePath: string;
	runner: CommandRunner;
}): Promise<HistoryAdapter> {
	const { gitRoot, jjRoot } = await resolveRepositoryRoots(args);
	if (resolvePreferredHistoryBackend({ workspacePath: args.workspacePath, gitRoot, jjRoot }) === 'jj') {
		return createJjHistoryAdapter({ runner: args.runner });
	}

	return createGitHistoryAdapter({ runner: args.runner });
}

export async function resolveHistoryWorkspacePath(args: {
	workspacePath: string;
	runner: CommandRunner;
}): Promise<string> {
	const { gitRoot, jjRoot } = await resolveRepositoryRoots(args);
	const preferredBackend = resolvePreferredHistoryBackend({
		workspacePath: args.workspacePath,
		gitRoot,
		jjRoot,
	});

	if (preferredBackend === 'jj') {
		return jjRoot || args.workspacePath;
	}

	if (preferredBackend === 'git') {
		return gitRoot || args.workspacePath;
	}

	return args.workspacePath;
}

async function resolveRepositoryRoots(args: {
	workspacePath: string;
	runner: CommandRunner;
}): Promise<{ gitRoot?: string; jjRoot?: string }> {
	const [gitResult, jjResult] = await Promise.allSettled([
		args.runner.runGit({
			workspacePath: args.workspacePath,
			args: ['rev-parse', '--show-toplevel'],
		}),
		args.runner.runJj({
			workspacePath: args.workspacePath,
			args: ['root'],
		}),
	]);

	return {
		gitRoot: gitResult.status === 'fulfilled' ? gitResult.value.stdout.trim() : undefined,
		jjRoot: jjResult.status === 'fulfilled' ? jjResult.value.stdout.trim() : undefined,
	};
}

function createGitHistoryAdapter(args: { runner: CommandRunner }): HistoryAdapter {
	const { runner } = args;

	return {
		backend: 'git',
		async getFileRevisionHistory({ workspacePath, relativePath, limit }) {
			const { stdout } = await runner.runGit({
				workspacePath,
				args: [
					'log',
					'--follow',
					'--decorate=short',
					'--date=iso-strict',
					'--format=%H%x09%ad%x09%an%x09%D%x09%s',
					`--max-count=${limit ?? MAX_TIMELINE_ENTRIES}`,
					'--',
					relativePath,
				],
			});

			return stdout
				.split(/\r?\n/u)
				.map((line) => line.trim())
				.filter(Boolean)
				.map(parseGitHistoryLine)
				.toReversed();
		},
		async getRepositoryRevisionHistory({ workspacePath, limit }) {
			const { stdout } = await runner.runGit({
				workspacePath,
				args: [
					'log',
					'--decorate=short',
					'--date=iso-strict',
					'--format=%H%x09%ad%x09%an%x09%D%x09%s',
					`--max-count=${limit ?? MAX_TIMELINE_ENTRIES}`,
				],
			});

			return stdout
				.split(/\r?\n/u)
				.map((line) => line.trim())
				.filter(Boolean)
				.map(parseGitHistoryLine)
				.map((entry) => ({
					...entry,
					touchesFile: false,
				}))
				.toReversed();
		},
		async showFileAtRevision({ workspacePath, revset, filePath }) {
			if (revset === 'EMPTY') {
				return '';
			}

			try {
				const { stdout } = await runner.runGit({
					workspacePath,
					args: ['show', `${revset}:${filePath}`],
				});
				return stdout;
			} catch (error) {
				if (isMissingFileAtRevisionError(error)) {
					return '';
				}
				throw error;
			}
		},
		async resolvePreviousPath({ workspacePath, revision, currentPath }) {
			const previousTransition = await resolvePreviousGitPath({
				runner,
				workspacePath,
				revision,
				currentPath,
			});

			return previousTransition?.fromPath || currentPath;
		},
		async listRevisionFiles({ workspacePath, revision, signal }) {
			const { stdout } = await runner.runGit({
				workspacePath,
				args: ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', revision],
				options: { signal },
			});

			return parseOutputLines(stdout);
		},
		async listWorkingTreeFiles({ workspacePath, signal }) {
			const files = new Set<string>();

			try {
				const { stdout } = await runner.runGit({
					workspacePath,
					args: ['diff', '--name-only', 'HEAD', '--'],
					options: { signal },
				});
				for (const relativePath of parseOutputLines(stdout)) {
					files.add(relativePath);
				}
			} catch {
				// Ignore missing HEAD or empty repos.
			}

			return [...files].toSorted((left, right) => left.localeCompare(right));
		},
		async getRemoteBaseUrl({ workspacePath }) {
			try {
				const { stdout } = await runner.runGit({
					workspacePath,
					args: ['remote', 'get-url', 'origin'],
				});
				return getGitHubRemoteBaseUrl(stdout);
			} catch {
				return undefined;
			}
		},
		async getSnapshotEntriesForFile() {
			return [];
		},
		async buildRangeMultiDiffPlan({ workspacePath, fromEntry, toEntry, signal }) {
			const changedFiles = toEntry.isWorkingTree
				? await listGitChangedFiles({ runner, workspacePath, fromRevision: fromEntry.revision, signal })
				: await listGitChangedFiles({
						runner,
						workspacePath,
						fromRevision: fromEntry.revision,
						toRevision: toEntry.revision,
						signal,
					});

			return {
				title: `${fromEntry.shortRevision}..${toEntry.shortRevision}`,
				files: changedFiles.map((relativePath) => ({
					relativePath,
					originalRevset: fromEntry.revision,
					modifiedRevset: toEntry.isWorkingTree ? '@' : toEntry.revision,
					backend: 'git',
				})),
			};
		},
		async buildRevisionMultiDiffPlan({ workspacePath, entry, signal }) {
			const changedFiles = await runner.runGit({
				workspacePath,
				args: ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', entry.revision],
				options: { signal },
			});
			const files = parseOutputLines(changedFiles.stdout);
			const parentRevision = await resolveGitParentRevision({
				runner,
				workspacePath,
				revision: entry.revision,
				signal,
			});

			return {
				title: entry.shortRevision,
				files: files.map((relativePath) => ({
					relativePath,
					originalRevset: parentRevision || 'EMPTY',
					modifiedRevset: entry.revision,
					backend: 'git',
				})),
			};
		},
	};
}

function createJjHistoryAdapter(args: { runner: CommandRunner }): HistoryAdapter {
	const { runner } = args;

	return {
		backend: 'jj',
		async getFileRevisionHistory({ workspacePath, relativePath, limit }) {
			return collectJjFileRevisionHistory({
				runner,
				workspacePath,
				relativePath,
				limit: limit ?? MAX_TIMELINE_ENTRIES,
			});
		},
		async getRepositoryRevisionHistory({ workspacePath, limit }) {
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
			const { stdout } = await runner.runJj({
				workspacePath,
				args: [
					'log',
					'--no-graph',
					'--limit',
					String(limit ?? MAX_TIMELINE_ENTRIES),
					'-r',
					'ancestors(@)',
					'-T',
					template,
				],
			});

			return dedupeAdjacentEntriesByChangeId(
				stdout
					.split(/\r?\n/u)
					.map((line) => line.trim())
					.filter(Boolean)
					.map(parseJjHistoryLine)
					.map((entry) => ({
						...entry,
						touchesFile: false,
					}))
					.toReversed(),
			);
		},
		async showFileAtRevision({ workspacePath, revset, filePath }) {
			if (revset === 'EMPTY') {
				return '';
			}

			try {
				const { stdout } = await runner.runJj({
					workspacePath,
					args: ['file', 'show', '-r', revset, toJjRootFileFileset(filePath)],
				});
				return stdout;
			} catch (error) {
				if (isMissingFileAtRevisionError(error)) {
					return '';
				}
				throw error;
			}
		},
		async resolvePreviousPath({ workspacePath, revision, currentPath }) {
			try {
				const { stdout } = await runner.runJj({
					workspacePath,
					args: ['diff', '--summary', '-r', revision],
				});
				const rename = parseJjSummaryRenameLines(stdout).find((entry) => entry.toPath === currentPath);
				if (rename) {
					return rename.fromPath;
				}
			} catch {
				// Fall through to git-based predecessor detection when jj summary is insufficient.
			}

			const previousTransition = await resolvePreviousGitPath({
				runner,
				workspacePath,
				revision,
				currentPath,
			});
			return shouldFollowPredecessorTransition(previousTransition) ? previousTransition.fromPath : currentPath;
		},
		async listRevisionFiles({ workspacePath, revision, signal }) {
			const { stdout } = await runner.runJj({
				workspacePath,
				args: ['diff', '--name-only', '-r', revision],
				options: { signal },
			});

			return parseOutputLines(stdout);
		},
		async listWorkingTreeFiles({ workspacePath, signal }) {
			const { stdout } = await runner.runJj({
				workspacePath,
				args: ['diff', '--name-only', '-r', '@'],
				options: { signal },
			});

			return parseOutputLines(stdout);
		},
		async getRemoteBaseUrl({ workspacePath }) {
			try {
				const { stdout } = await runner.runGit({
					workspacePath,
					args: ['remote', 'get-url', 'origin'],
				});
				return getGitHubRemoteBaseUrl(stdout);
			} catch {
				return undefined;
			}
		},
		async getSnapshotEntriesForFile({ workspacePath, relativePath, entry }) {
			if (!entry.changeId || entry.isWorkingTree || !entry.touchesFile) {
				return [];
			}

			try {
				const { stdout } = await runner.runJj({
					workspacePath,
					args: ['evolog', '--no-graph', '--summary', '--limit', String(MAX_TIMELINE_ENTRIES), '-r', entry.revision],
				});
				return parseJjEvolutionSummaryEntries(stdout)
					.filter((evolutionEntry) => parseJjSummaryChangedPaths(evolutionEntry.summaryLines).includes(relativePath))
					.map((evolutionEntry, evolutionIndex) => ({
						id: `snapshot:${entry.changeId}:${evolutionEntry.operationId || evolutionEntry.changeKey || evolutionEntry.revision}:${evolutionIndex}`,
						revision: evolutionEntry.revision,
						shortRevision:
							normalizeSnapshotOperationKey(evolutionEntry.changeKey) || evolutionEntry.revision.slice(0, 8),
						changeId: entry.changeId,
						bookmarkNames: evolutionEntry.bookmarkNames,
						authorDate: normalizeSnapshotAuthorDate(evolutionEntry.authorDate, entry.authorDate),
						authorName: evolutionEntry.authorName || entry.authorName,
						description: normalizeSnapshotDescription(evolutionEntry.description, evolutionEntry.operationDescription),
						isWorkingTree: false,
						touchesFile: true,
						timestamp: parseSnapshotTimestamp(evolutionEntry.authorDate, entry.timestamp),
						filePath: relativePath,
						operationId: evolutionEntry.operationId,
						operationIndex: evolutionEntry.operationIndex,
						operationKey: evolutionEntry.changeKey,
					}))
					.toReversed();
			} catch {
				return [];
			}
		},
		async buildRangeMultiDiffPlan({ workspacePath, fromEntry, toEntry, signal }) {
			let changedFiles = await listChangedJjFiles({
				runner,
				workspacePath,
				base: fromEntry.revision,
				target: toEntry.isWorkingTree ? '@' : toEntry.revision,
				signal,
			});
			let originalRevset = fromEntry.revision;
			let modifiedRevset = toEntry.isWorkingTree ? '@' : toEntry.revision;
			let title = `${fromEntry.shortRevision}..${toEntry.shortRevision}`;

			if (!changedFiles.length && toEntry.isWorkingTree && fromEntry.revision !== modifiedRevset) {
				const revisionFiles = await parseRevisionFilesForJj({
					runner,
					workspacePath,
					revision: fromEntry.revision,
					signal,
				});
				if (revisionFiles.length) {
					changedFiles = revisionFiles;
					originalRevset = `${fromEntry.revision}-`;
					modifiedRevset = fromEntry.revision;
					title = fromEntry.shortRevision;
				}
			}

			return {
				title,
				files: changedFiles.map((relativePath) => ({
					relativePath,
					originalRevset,
					modifiedRevset,
					backend: 'jj',
				})),
			};
		},
		async buildRevisionMultiDiffPlan({ workspacePath, entry, entryIndex, comparisonSource, sourceEntries, signal }) {
			const baseRevision =
				comparisonSource === 'snapshot'
					? sourceEntries[Math.max(0, entryIndex - 1)]?.revision || `${entry.revision}-`
					: `${entry.revision}-`;
			const revisionFiles =
				comparisonSource === 'snapshot'
					? await listChangedJjFiles({
							runner,
							workspacePath,
							base: baseRevision,
							target: entry.revision,
							signal,
						})
					: await parseRevisionFilesForJj({
							runner,
							workspacePath,
							revision: entry.revision,
							signal,
						});

			return {
				title: entry.shortRevision,
				files: revisionFiles.map((relativePath) => ({
					relativePath,
					originalRevset: baseRevision,
					modifiedRevset: entry.revision,
					backend: 'jj',
				})),
			};
		},
	};
}

function parseGitHistoryLine(line: string): FileRevisionEntry {
	const [revision = '', authorDate = '', authorName = '', decorations = '', ...descriptionParts] = line.split('\t');
	return {
		id: revision,
		revision,
		shortRevision: revision.slice(0, 8),
		branchNames: parseGitBranchNames(decorations),
		changeId: undefined,
		authorDate,
		authorName: authorName || 'Unknown author',
		description: descriptionParts.join('\t') || 'No description',
		isWorkingTree: false,
		touchesFile: true,
		timestamp: Date.parse(authorDate) || 0,
	};
}

function parseJjHistoryLine(line: string): FileRevisionEntry {
	const [revision = '', changeId = '', authorDate = '', authorName = '', bookmarkNames = '', ...descriptionParts] =
		line.split('\t');
	return {
		id: revision,
		revision,
		shortRevision: changeId || revision.slice(0, 8),
		changeId: changeId || undefined,
		bookmarkNames: parseJjBookmarkNames(bookmarkNames),
		authorDate,
		authorName: authorName || 'Unknown author',
		description: descriptionParts.join('\t') || 'No description',
		isWorkingTree: false,
		touchesFile: true,
		timestamp: Date.parse(authorDate) || 0,
	};
}

type ParsedJjHistoryEntry = {
	entry: FileRevisionEntry;
	summaryLines: string[];
};

async function collectJjFileRevisionHistory(args: {
	runner: CommandRunner;
	workspacePath: string;
	relativePath: string;
	limit: number;
	ancestorLimitRevset?: string;
	seenSegments?: Set<string>;
}): Promise<FileRevisionEntry[]> {
	const ancestorLimitRevset = args.ancestorLimitRevset || '@';
	const seenSegments = args.seenSegments || new Set<string>();
	const segmentKey = `${args.relativePath}\u0000${ancestorLimitRevset}`;
	if (seenSegments.has(segmentKey)) {
		return [];
	}

	seenSegments.add(segmentKey);
	const segment = await loadJjFileHistorySegment(
		args.runner,
		args.workspacePath,
		args.relativePath,
		ancestorLimitRevset,
		args.limit,
	);
	const previousSource = await resolvePreviousJjPath({
		runner: args.runner,
		workspacePath: args.workspacePath,
		relativePath: args.relativePath,
		segment,
	});
	const previousEntries = previousSource
		? await collectJjFileRevisionHistory({
				runner: args.runner,
				workspacePath: args.workspacePath,
				relativePath: previousSource.relativePath,
				ancestorLimitRevset: previousSource.ancestorLimitRevset,
				seenSegments,
				limit: args.limit,
			})
		: [];

	return mergeJjHistoryEntries(
		previousEntries,
		segment.map(({ entry }) => entry),
	);
}

async function loadJjFileHistorySegment(
	runner: CommandRunner,
	workspacePath: string,
	relativePath: string,
	ancestorLimitRevset: string,
	limit: number,
): Promise<ParsedJjHistoryEntry[]> {
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
	const { stdout } = await runner.runJj({
		workspacePath,
		args: [
			'log',
			'--no-graph',
			'--reversed',
			'--summary',
			'--limit',
			String(limit),
			'-r',
			buildJjAncestorHistoryRevset(ancestorLimitRevset),
			'-T',
			template,
			toJjRootFileFileset(relativePath),
		],
	});

	return parseJjHistoryEntriesWithSummary(stdout);
}

function parseJjHistoryEntriesWithSummary(output: string): ParsedJjHistoryEntry[] {
	const entries: ParsedJjHistoryEntry[] = [];
	let currentEntry: ParsedJjHistoryEntry | null = null;

	for (const rawLine of output.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		if (line.includes('\t')) {
			if (currentEntry) {
				entries.push(currentEntry);
			}

			currentEntry = {
				entry: parseJjHistoryLine(line),
				summaryLines: [],
			};
			continue;
		}

		if (currentEntry) {
			currentEntry.summaryLines.push(line);
		}
	}

	if (currentEntry) {
		entries.push(currentEntry);
	}

	return entries;
}

function buildJjAncestorHistoryRevset(ancestorLimitRevset: string): string {
	return `ancestors(${ancestorLimitRevset})`;
}

async function resolvePreviousJjPath(args: {
	runner: CommandRunner;
	workspacePath: string;
	relativePath: string;
	segment: ParsedJjHistoryEntry[];
}): Promise<{ relativePath: string; ancestorLimitRevset: string } | undefined> {
	const boundaryEntry = args.segment[0];
	if (!boundaryEntry) {
		return undefined;
	}

	const boundarySummary = boundaryEntry.summaryLines.join('\n');
	const rename = parseJjSummaryRenameLines(boundarySummary).find((entry) => entry.toPath === args.relativePath);
	if (rename) {
		return {
			relativePath: rename.fromPath,
			ancestorLimitRevset: `${boundaryEntry.entry.revision}-`,
		};
	}

	const previousTransition = await resolvePreviousGitPath({
		runner: args.runner,
		workspacePath: args.workspacePath,
		revision: boundaryEntry.entry.revision,
		currentPath: args.relativePath,
	});
	if (!shouldFollowPredecessorTransition(previousTransition)) {
		return undefined;
	}

	return {
		relativePath: previousTransition.fromPath,
		ancestorLimitRevset: `${boundaryEntry.entry.revision}-`,
	};
}

function mergeJjHistoryEntries(...segments: FileRevisionEntry[][]): FileRevisionEntry[] {
	const seenRevisions = new Set<string>();
	const merged: FileRevisionEntry[] = [];

	for (const segment of segments) {
		for (const entry of segment) {
			if (seenRevisions.has(entry.revision)) {
				continue;
			}

			seenRevisions.add(entry.revision);
			merged.push(entry);
		}
	}

	return merged;
}

function parseOutputLines(output: string): string[] {
	return output
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

function parseGitPathTransitionLines(output: string): Array<{
	fromPath: string;
	toPath: string;
	kind: 'rename' | 'copy';
}> {
	return parseOutputLines(output)
		.map((line) => {
			const [status = '', fromPath = '', toPath = ''] = line.split('\t');
			if (!status.startsWith('R') && !status.startsWith('C')) {
				return null;
			}

			return fromPath && toPath
				? {
						fromPath,
						toPath,
						kind: status.startsWith('C') ? 'copy' : 'rename',
					}
				: null;
		})
		.filter((entry): entry is { fromPath: string; toPath: string; kind: 'rename' | 'copy' } => entry !== null);
}

function shouldFollowPredecessorTransition(
	transition: { fromPath: string; toPath: string; kind: 'rename' | 'copy' } | undefined,
): transition is { fromPath: string; toPath: string; kind: 'rename' | 'copy' } {
	if (!transition) {
		return false;
	}

	if (transition.kind === 'rename') {
		return true;
	}

	return path.basename(transition.fromPath) === path.basename(transition.toPath);
}

async function resolvePreviousGitPath(args: {
	runner: CommandRunner;
	workspacePath: string;
	revision: string;
	currentPath: string;
	signal?: AbortSignal;
}): Promise<{ fromPath: string; toPath: string; kind: 'rename' | 'copy' } | undefined> {
	try {
		const { stdout } = await args.runner.runGit({
			workspacePath: args.workspacePath,
			args: [
				'diff-tree',
				'--root',
				'--no-commit-id',
				'--name-status',
				'--find-renames=1%',
				'--find-copies=1%',
				'--find-copies-harder',
				'-r',
				args.revision,
			],
			options: { signal: args.signal },
		});

		return parseGitPathTransitionLines(stdout).find((entry) => entry.toPath === args.currentPath);
	} catch {
		return undefined;
	}
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

function normalizeSnapshotAuthorDate(authorDate: string, fallbackAuthorDate: string): string {
	const value = authorDate.trim();
	if (value && !Number.isNaN(Date.parse(value))) {
		return value;
	}

	return fallbackAuthorDate;
}

function parseSnapshotTimestamp(authorDate: string, fallbackTimestamp: number): number {
	const timestamp = Date.parse(authorDate);
	return Number.isNaN(timestamp) ? fallbackTimestamp : timestamp;
}

function normalizeSnapshotDescription(description: string, operationDescription: string): string {
	const trimmed = String(description || '').trim();
	if (!trimmed || trimmed === '(no description set)' || trimmed === '(empty) (no description set)') {
		return operationDescription || 'Snapshot';
	}

	return trimmed;
}

async function listGitChangedFiles(args: {
	runner: CommandRunner;
	workspacePath: string;
	fromRevision: string;
	toRevision?: string;
	signal?: AbortSignal;
}): Promise<string[]> {
	const commandArgs = args.toRevision
		? ['diff', '--name-only', args.fromRevision, args.toRevision, '--']
		: ['diff', '--name-only', args.fromRevision, '--'];
	const { stdout } = await args.runner.runGit({
		workspacePath: args.workspacePath,
		args: commandArgs,
		options: { signal: args.signal },
	});
	return parseOutputLines(stdout);
}

async function resolveGitParentRevision(args: {
	runner: CommandRunner;
	workspacePath: string;
	revision: string;
	signal?: AbortSignal;
}): Promise<string | undefined> {
	try {
		const { stdout } = await args.runner.runGit({
			workspacePath: args.workspacePath,
			args: ['rev-parse', `${args.revision}^`],
			options: { signal: args.signal },
		});
		const parentRevision = stdout.trim();
		return parentRevision || undefined;
	} catch {
		return undefined;
	}
}

async function listChangedJjFiles(args: {
	runner: CommandRunner;
	workspacePath: string;
	base: string;
	target: string;
	signal?: AbortSignal;
}): Promise<string[]> {
	const { stdout } = await args.runner.runJj({
		workspacePath: args.workspacePath,
		args: ['diff', '--name-only', '--from', args.base, '--to', args.target],
		options: { signal: args.signal },
	});

	return parseOutputLines(stdout);
}

async function parseRevisionFilesForJj(args: {
	runner: CommandRunner;
	workspacePath: string;
	revision: string;
	signal?: AbortSignal;
}): Promise<string[]> {
	const { stdout } = await args.runner.runJj({
		workspacePath: args.workspacePath,
		args: ['diff', '--name-only', '-r', args.revision],
		options: { signal: args.signal },
	});

	return parseOutputLines(stdout);
}
