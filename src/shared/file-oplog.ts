import type { FileRevisionEntry } from './timeline-types.ts';

export type FileOpLogEntry = {
	operationId: string;
	description: string;
	authorDate?: string;
	/** Snapshot/revision entry index to jump to when present. */
	entryIndex?: number;
	changeId?: string;
	operationIndex?: number;
};

export function parseJjOpLogLine(line: string): FileOpLogEntry | null {
	const [operationId = '', description = '', authorDate = ''] = line.split('\t');
	const id = operationId.trim();
	if (!id) {
		return null;
	}
	return {
		operationId: id,
		description: description.trim() || 'Operation',
		authorDate: authorDate.trim() || undefined,
	};
}

export function parseJjOpLogOutput(output: string): FileOpLogEntry[] {
	const seen = new Set<string>();
	const entries: FileOpLogEntry[] = [];
	for (const raw of output.split(/\r?\n/u)) {
		const line = raw.trim();
		if (!line) {
			continue;
		}
		const parsed = parseJjOpLogLine(line);
		if (!parsed || seen.has(parsed.operationId)) {
			continue;
		}
		seen.add(parsed.operationId);
		entries.push(parsed);
	}
	return entries;
}

/** Prefer longer prefix matches so short op ids still link. */
function findEntryForOperation(
	entries: ReadonlyArray<FileRevisionEntry>,
	operationId: string,
): FileRevisionEntry | undefined {
	const needle = operationId.toLowerCase();
	let best: FileRevisionEntry | undefined;
	let bestLen = -1;
	for (const entry of entries) {
		const id = (entry.operationId || '').toLowerCase();
		if (!id) {
			continue;
		}
		if (id === needle || id.startsWith(needle) || needle.startsWith(id)) {
			const len = Math.min(id.length, needle.length);
			if (len > bestLen) {
				best = entry;
				bestLen = len;
			}
		}
	}
	return best;
}

/**
 * Keep recent ops that touched the file (linked via known snapshot/revision ops),
 * or whose description mentions the relative path.
 */
export function filterFileOpLogPeek(args: {
	opLog: ReadonlyArray<FileOpLogEntry>;
	fileEntries: ReadonlyArray<FileRevisionEntry>;
	relativePath: string;
	limit?: number;
}): FileOpLogEntry[] {
	const limit = args.limit ?? 12;
	const pathNeedle = args.relativePath.trim().toLowerCase();
	const fileName = pathNeedle.includes('/') ? pathNeedle.slice(pathNeedle.lastIndexOf('/') + 1) : pathNeedle;
	const result: FileOpLogEntry[] = [];

	for (const op of args.opLog) {
		const linked = findEntryForOperation(args.fileEntries, op.operationId);
		const desc = op.description.toLowerCase();
		const pathHit = Boolean(pathNeedle) && (desc.includes(pathNeedle) || (fileName.length > 2 && desc.includes(fileName)));
		if (!linked && !pathHit) {
			continue;
		}
		result.push({
			...op,
			entryIndex: linked?.index,
			changeId: linked?.changeId,
			operationIndex: linked?.operationIndex,
			description: op.description || linked?.description || 'Operation',
		});
		if (result.length >= limit) {
			break;
		}
	}
	return result;
}

export const JJ_OP_LOG_TEMPLATE = [
	'self.id().short(12)',
	'"\\t"',
	'description.first_line()',
	'"\\t"',
	'time.end().local().format("%Y-%m-%dT%H:%M:%S")',
	'"\\n"',
].join(' ++ ');
