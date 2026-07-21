import type { FileRevisionEntry, HistoryBackend } from '../shared/timeline-types.ts';

export type TimelineJsonEntry = {
	rev: string;
	changeId?: string;
	date: string;
	desc: string;
	path?: string;
	flags?: {
		empty?: boolean;
		conflict?: boolean;
		immutable?: boolean;
	};
};

export type TimelineJsonSummary = {
	backend: HistoryBackend;
	path: string;
	workspacePath: string;
	entries: TimelineJsonEntry[];
};

export function compactTimelineJsonEntry(entry: FileRevisionEntry): TimelineJsonEntry {
	const flags = {
		...(entry.isEmpty ? { empty: true as const } : {}),
		...(entry.hasConflict ? { conflict: true as const } : {}),
		...(entry.isImmutable ? { immutable: true as const } : {}),
	};
	return {
		rev: entry.revision,
		...(entry.changeId ? { changeId: entry.changeId } : {}),
		date: entry.authorDate,
		desc: entry.description,
		...(entry.filePath ? { path: entry.filePath } : {}),
		...(Object.keys(flags).length ? { flags } : {}),
	};
}

export function buildTimelineJsonSummary(args: {
	backend: HistoryBackend;
	relativePath: string;
	workspacePath: string;
	entries: ReadonlyArray<FileRevisionEntry>;
}): TimelineJsonSummary {
	return {
		backend: args.backend,
		path: args.relativePath,
		workspacePath: args.workspacePath,
		entries: args.entries.filter((entry) => !entry.isWorkingTree).map(compactTimelineJsonEntry),
	};
}
