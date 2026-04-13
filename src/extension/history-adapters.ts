import {
	dedupeAdjacentEntriesByChangeId,
	getGitHubRemoteBaseUrl,
	normalizeSnapshotOperationKey,
	parseJjEvolutionSummaryEntries,
	parseJjSummaryChangedPaths,
	parseJjSummaryRenameLines,
} from '../shared/history-helpers.ts';
import type { FileRevisionEntry } from '../shared/timeline-types.ts';
import { MAX_TIMELINE_ENTRIES } from './constants.ts';
import type { CommandRunner, HistoryAdapter } from './types.ts';

export async function resolveHistoryAdapter(args: {
	workspacePath: string;
	runner: CommandRunner;
}): Promise<HistoryAdapter> {
	try {
		await args.runner.runJj({
			workspacePath: args.workspacePath,
			args: ['root'],
		});
		return createJjHistoryAdapter({ runner: args.runner });
	} catch {
		return createGitHistoryAdapter({ runner: args.runner });
	}
}

function createGitHistoryAdapter(args: { runner: CommandRunner }): HistoryAdapter {
	const { runner } = args;

	return {
		backend: 'git',
		async getFileRevisionHistory({ workspacePath, relativePath }) {
			const { stdout } = await runner.runGit({
				workspacePath,
				args: [
					'log',
					'--follow',
					'--date=iso-strict',
					'--format=%H%x09%ad%x09%an%x09%s',
					`--max-count=${MAX_TIMELINE_ENTRIES}`,
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
		async getRepositoryRevisionHistory({ workspacePath }) {
			const { stdout } = await runner.runGit({
				workspacePath,
				args: ['log', '--date=iso-strict', '--format=%H%x09%ad%x09%an%x09%s', `--max-count=${MAX_TIMELINE_ENTRIES}`],
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
			const { stdout } = await runner.runGit({
				workspacePath,
				args: ['diff-tree', '--root', '--no-commit-id', '--name-status', '--find-renames', '-r', revision],
			});

			const rename = parseGitRenameLines(stdout).find((entry) => entry.toPath === currentPath);
			return rename ? rename.fromPath : currentPath;
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

			try {
				const { stdout } = await runner.runGit({
					workspacePath,
					args: ['ls-files', '--others', '--exclude-standard'],
					options: { signal },
				});
				for (const relativePath of parseOutputLines(stdout)) {
					files.add(relativePath);
				}
			} catch {
				// Ignore ls-files errors in detached test repos.
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
		async getFileRevisionHistory({ workspacePath, relativePath }) {
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
			const { stdout } = await runner.runJj({
				workspacePath,
				args: [
					'log',
					'--no-graph',
					'--limit',
					String(MAX_TIMELINE_ENTRIES),
					'-T',
					template,
					toJjRootFileFileset(relativePath),
				],
			});

			return dedupeAdjacentEntriesByChangeId(
				stdout
					.split(/\r?\n/u)
					.map((line) => line.trim())
					.filter(Boolean)
					.map(parseJjHistoryLine)
					.toReversed(),
			);
		},
		async getRepositoryRevisionHistory({ workspacePath }) {
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
			const { stdout } = await runner.runJj({
				workspacePath,
				args: ['log', '--no-graph', '--limit', String(MAX_TIMELINE_ENTRIES), '-T', template],
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
					args: ['file', 'show', '-r', revset, filePath],
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
				return rename ? rename.fromPath : currentPath;
			} catch {
				return currentPath;
			}
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
					.map((evolutionEntry) => ({
						id: `snapshot:${evolutionEntry.operationId || evolutionEntry.changeKey || evolutionEntry.revision}`,
						revision: evolutionEntry.revision,
						shortRevision:
							normalizeSnapshotOperationKey(evolutionEntry.changeKey) || evolutionEntry.revision.slice(0, 8),
						changeId: entry.changeId,
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
			const revisionFiles = await parseRevisionFilesForJj({
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
	const [revision = '', authorDate = '', authorName = '', ...descriptionParts] = line.split('\t');
	return {
		id: revision,
		revision,
		shortRevision: revision.slice(0, 8),
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
	const [revision = '', changeId = '', authorDate = '', authorName = '', ...descriptionParts] = line.split('\t');
	return {
		id: revision,
		revision,
		shortRevision: changeId || revision.slice(0, 8),
		changeId: changeId || undefined,
		authorDate,
		authorName: authorName || 'Unknown author',
		description: descriptionParts.join('\t') || 'No description',
		isWorkingTree: false,
		touchesFile: true,
		timestamp: Date.parse(authorDate) || 0,
	};
}

function parseOutputLines(output: string): string[] {
	return output
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

function parseGitRenameLines(output: string): Array<{ fromPath: string; toPath: string }> {
	return parseOutputLines(output)
		.map((line) => {
			const [status = '', fromPath = '', toPath = ''] = line.split('\t');
			if (!status.startsWith('R') && !status.startsWith('C')) {
				return null;
			}

			return fromPath && toPath ? { fromPath, toPath } : null;
		})
		.filter((entry): entry is { fromPath: string; toPath: string } => entry !== null);
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

function toJjRootFileFileset(relativePath: string): string {
	return `root-file:${JSON.stringify(relativePath)}`;
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
