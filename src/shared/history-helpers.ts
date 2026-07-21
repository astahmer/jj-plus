import path from 'node:path';

import type { FileRevisionEntry } from './timeline-types.ts';

type RenameEntry = {
	fromPath: string;
	toPath: string;
};

type ParsedEvolutionLine = {
	revision: string;
	changeId?: string;
	authorDate: string;
	authorName: string;
	description: string;
	operationDescription: string;
};

type ParsedEvolutionSummaryEntry = {
	changeKey: string;
	changeId?: string;
	operationIndex?: number;
	bookmarkNames?: string[];
	authorDate: string;
	authorName: string;
	revision: string;
	description: string;
	operationId?: string;
	operationDescription: string;
	summaryLines: string[];
};

type ParsedEvolutionSummaryHeader = {
	changeKey: string;
	changeId?: string;
	operationIndex?: number;
	bookmarkNames?: string[];
	authorDate: string;
	authorName: string;
	revision: string;
};

function parseMarkerNames(rawValue: string): string[] | undefined {
	const names = rawValue
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);

	return names.length ? [...new Set(names)] : undefined;
}

export function parseGitBranchNames(decorations: string): string[] | undefined {
	const names = decorations
		.split(',')
		.map((value) => value.trim())
		.flatMap((value) => {
			if (!value || value === 'HEAD' || value.startsWith('tag: ')) {
				return [];
			}

			const [left, right] = value.split('->').map((part) => part.trim());
			if (right) {
				return right === 'HEAD' ? [] : [right];
			}

			return left ? [left] : [];
		})
		.filter(Boolean);

	return names.length ? [...new Set(names)] : undefined;
}

export function parseJjSummaryRenameLines(output: string): RenameEntry[] {
	return output
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.reduce<RenameEntry[]>((entries, line) => {
			const match = /^R\s+(.+?)\s+=>\s+(.+)$/u.exec(line);
			if (!match) {
				return entries;
			}

			const fromPath = match[1].trim();
			const toPath = match[2].trim();
			const braceStart = fromPath.indexOf('{');
			const braceEnd = toPath.lastIndexOf('}');

			if (braceStart >= 0 && braceEnd >= 0) {
				const prefix = fromPath.slice(0, braceStart);
				const fromSuffix = fromPath.slice(braceStart + 1);
				const toPrefix = toPath.slice(0, braceEnd);
				const suffix = toPath.slice(braceEnd + 1);

				entries.push({
					fromPath: `${prefix}${fromSuffix}${suffix}`,
					toPath: `${prefix}${toPrefix}${suffix}`,
				});
				return entries;
			}

			entries.push({
				fromPath,
				toPath,
			});
			return entries;
		}, []);
}

export function parseJjEvolutionLine(line: string): ParsedEvolutionLine {
	const [
		revision = '',
		changeId = '',
		authorDate = '',
		authorName = '',
		operationDescription = '',
		...descriptionParts
	] = line.split('\t');
	const description = descriptionParts.join('\t') || operationDescription || 'Snapshot';
	return {
		revision,
		changeId: changeId || undefined,
		authorDate,
		authorName: authorName || 'Unknown author',
		description,
		operationDescription: operationDescription || 'snapshot working copy',
	};
}

function parseJjEvolutionSummaryHeader(line: string): ParsedEvolutionSummaryHeader | null {
	const tokens = line.trim().split(/\s+/u);
	if (tokens.length < 5) {
		return null;
	}

	const dateIndex = tokens.findIndex((token) => /^\d{4}-\d{2}-\d{2}$/u.test(token));
	if (dateIndex < 2 || dateIndex + 2 >= tokens.length) {
		return null;
	}

	const timeToken = tokens[dateIndex + 1];
	if (!/^\d{2}:\d{2}:\d{2}$/u.test(timeToken)) {
		return null;
	}

	const revisionIndex = tokens.findLastIndex((token) => /^[0-9a-f]{8,}$/u.test(token));
	if (revisionIndex <= dateIndex + 1) {
		return null;
	}

	const changeKey = tokens[0];
	const [changeId = '', operationIndexRaw = ''] = changeKey.split('/');
	const operationIndex = Number.parseInt(operationIndexRaw, 10);
	const bookmarkNames = tokens.slice(dateIndex + 2, revisionIndex).filter(Boolean);

	return {
		changeKey,
		changeId: changeId || undefined,
		operationIndex: Number.isInteger(operationIndex) ? operationIndex : undefined,
		...(bookmarkNames.length ? { bookmarkNames } : {}),
		authorDate: `${tokens[dateIndex]}T${timeToken}`,
		authorName: tokens.slice(1, dateIndex).join(' ') || 'Unknown author',
		revision: tokens[revisionIndex] || '',
	};
}

export function normalizeSnapshotOperationKey(changeKey?: string): string | undefined {
	const trimmed = String(changeKey || '').trim();
	if (!trimmed) {
		return undefined;
	}

	return trimmed.includes('/') ? trimmed : `${trimmed}/0`;
}

export function toJjRootFileFileset(relativePath: string): string {
	return `root-file:${JSON.stringify(relativePath)}`;
}

export function resolvePreferredHistoryBackend(args: {
	workspacePath: string;
	gitRoot?: string;
	jjRoot?: string;
}): 'git' | 'jj' | undefined {
	const workspacePath = normalizeFilesystemPath(args.workspacePath);
	const gitRoot = normalizeCandidateRoot(args.gitRoot, workspacePath);
	const jjRoot = normalizeCandidateRoot(args.jjRoot, workspacePath);

	if (gitRoot && jjRoot) {
		if (gitRoot === jjRoot) {
			return 'jj';
		}

		if (isPathWithinRoot({ candidatePath: gitRoot, rootPath: jjRoot })) {
			return 'git';
		}

		if (isPathWithinRoot({ candidatePath: jjRoot, rootPath: gitRoot })) {
			return 'jj';
		}

		return gitRoot.length >= jjRoot.length ? 'git' : 'jj';
	}

	if (jjRoot) {
		return 'jj';
	}

	if (gitRoot) {
		return 'git';
	}

	return undefined;
}

function normalizeCandidateRoot(root: string | undefined, workspacePath: string): string | undefined {
	const trimmed = String(root || '').trim();
	if (!trimmed) {
		return undefined;
	}

	const normalizedRoot = normalizeFilesystemPath(trimmed);
	return isPathWithinRoot({ candidatePath: workspacePath, rootPath: normalizedRoot }) ? normalizedRoot : undefined;
}

function normalizeFilesystemPath(value: string): string {
	return path.resolve(value.trim());
}

function isPathWithinRoot(args: { candidatePath: string; rootPath: string }): boolean {
	const relativePath = path.relative(args.rootPath, args.candidatePath);
	return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

export function parseJjEvolutionSummaryEntries(output: string): ParsedEvolutionSummaryEntry[] {
	const lines = output.split(/\r?\n/u);
	const entries: ParsedEvolutionSummaryEntry[] = [];
	let current: ParsedEvolutionSummaryEntry | null = null;
	let descriptionCaptured = false;

	const pushCurrent = () => {
		if (!current) {
			return;
		}

		entries.push(current);
		current = null;
		descriptionCaptured = false;
	};

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		const header = parseJjEvolutionSummaryHeader(line);
		if (header) {
			pushCurrent();
			current = {
				...header,
				description: 'Snapshot',
				operationId: undefined,
				operationDescription: 'snapshot working copy',
				summaryLines: [],
			};
			continue;
		}

		if (!current) {
			continue;
		}

		if (!descriptionCaptured) {
			current.description = line;
			descriptionCaptured = true;
			continue;
		}

		const operationMatch = /^-- operation ([0-9a-f]+)\s*(.*)$/u.exec(line);
		if (operationMatch) {
			current.operationId = operationMatch[1] || undefined;
			current.operationDescription = operationMatch[2] || 'snapshot working copy';
			continue;
		}

		current.summaryLines.push(line);
	}

	pushCurrent();
	return entries;
}

export function parseJjBookmarkNames(rawValue: string): string[] | undefined {
	return parseMarkerNames(rawValue);
}

/** jj template prints `true`/`false` for empty/conflict/immutable. */
export function parseJjBooleanFlag(rawValue: string | undefined): boolean {
	const value = (rawValue || '').trim().toLowerCase();
	return value === 'true' || value === '1' || value === 'yes';
}

/**
 * Shared jj log template fields for file/repo history lines:
 * revision, changeId, date, author, bookmarks, empty, conflict, immutable, description
 */
export function buildJjHistoryLogTemplate(): string {
	return [
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
		'if(empty, "true", "false")',
		'"\\t"',
		'if(conflict, "true", "false")',
		'"\\t"',
		'if(immutable, "true", "false")',
		'"\\t"',
		'description.first_line()',
		'"\\n"',
	].join(' ++ ');
}

export function parseJjHistoryLine(line: string): FileRevisionEntry {
	const parts = line.split('\t');
	const revision = parts[0] || '';
	const changeId = parts[1] || '';
	const authorDate = parts[2] || '';
	const authorName = parts[3] || '';
	const bookmarkNames = parts[4] || '';

	// New format: … bookmarks, empty, conflict, immutable, description…
	// Legacy: … bookmarks, description…
	const looksLikeFlags =
		parts.length >= 8 &&
		/^(true|false|0|1)$/iu.test((parts[5] || '').trim()) &&
		/^(true|false|0|1)$/iu.test((parts[6] || '').trim()) &&
		/^(true|false|0|1)$/iu.test((parts[7] || '').trim());

	const isEmpty = looksLikeFlags ? parseJjBooleanFlag(parts[5]) : undefined;
	const hasConflict = looksLikeFlags ? parseJjBooleanFlag(parts[6]) : undefined;
	const isImmutable = looksLikeFlags ? parseJjBooleanFlag(parts[7]) : undefined;
	const description = looksLikeFlags ? parts.slice(8).join('\t') : parts.slice(5).join('\t');

	return {
		id: revision,
		revision,
		shortRevision: changeId || revision.slice(0, 8),
		changeId: changeId || undefined,
		bookmarkNames: parseJjBookmarkNames(bookmarkNames),
		authorDate,
		authorName: authorName || 'Unknown author',
		description: description || 'No description',
		isWorkingTree: false,
		touchesFile: true,
		timestamp: Date.parse(authorDate) || 0,
		...(isEmpty ? { isEmpty: true } : {}),
		...(hasConflict ? { hasConflict: true } : {}),
		...(isImmutable ? { isImmutable: true } : {}),
	};
}

export function parseJjSummaryChangedPaths(summaryLines: string[] | string): string[] {
	const lines = Array.isArray(summaryLines) ? summaryLines : String(summaryLines || '').split(/\r?\n/u);
	const renameLines = parseJjSummaryRenameLines(lines.join('\n'));
	const renamePaths = renameLines.flatMap((entry) => [entry.fromPath, entry.toPath]);
	const directPaths = lines.reduce<string[]>((paths, rawLine) => {
		const line = rawLine.trim();
		if (!line || /^R\s+/u.test(line)) {
			return paths;
		}

		const match = /^[A-Z?]\s+(.+)$/u.exec(line);
		if (match) {
			paths.push(match[1].trim());
		}

		return paths;
	}, []);

	return [...new Set([...directPaths, ...renamePaths])];
}

export function getGitHubRemoteBaseUrl(remote: string): string | undefined {
	const trimmed = remote.trim();
	if (!trimmed) {
		return undefined;
	}

	const httpsMatch = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/u.exec(trimmed);
	if (httpsMatch) {
		return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}`;
	}

	const sshMatch = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/u.exec(trimmed);
	if (sshMatch) {
		return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`;
	}

	return undefined;
}

export function dedupeAdjacentEntriesByChangeId<T extends { changeId?: string }>(entries: T[]): T[] {
	return entries.filter((entry, index) => {
		if (!entry.changeId || index === 0) {
			return true;
		}

		return entries[index - 1]?.changeId !== entry.changeId;
	});
}
