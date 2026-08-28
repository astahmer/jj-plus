import type { FileRevisionEntry, HistoryBackend } from './timeline-types.ts';

export type RepoRevisionEntry = Omit<FileRevisionEntry, 'index'> & {
	index: number;
	fileCount?: number;
};

export type RepoTimelineData = {
	backend: HistoryBackend;
	workspacePath: string;
	repositoryName: string;
	version?: string;
	entries: Array<RepoRevisionEntry>;
	bookmarks: Array<string>;
	truncated: boolean;
};

export type RepoTimelineDiff = {
	revision: string;
	patch: string;
	files: Array<RepoTimelineDiffFile>;
};

export type RepoTimelineDiffFile = {
	path: string;
	before: string;
	after: string;
};

export type RepoTimelineSearchMode = 'all' | 'metadata' | 'changes' | 'snapshot';
export type RepoTimelineMatchMode = 'literal' | 'regex' | 'fuzzy';

export type RepoTimelineSearchRequest = {
	requestId: number;
	query: string;
	mode: RepoTimelineSearchMode;
	matchMode: RepoTimelineMatchMode;
	path?: string;
	after?: string;
	until?: string;
	selectedIndex?: number;
};

export type RepoTimelineSearchResult = {
	entryIndex: number;
	lane?: Exclude<RepoTimelineSearchMode, 'all'>;
	filePath?: string;
	line?: number;
	detail?: string;
};

export type RepoTimelineSearchPayload = {
	requestId: number;
	mode: RepoTimelineSearchMode;
	results: Array<RepoTimelineSearchResult>;
	truncated: boolean;
};

export type RepoTimelineCommand =
	| { command: 'ready' }
	| { command: 'refresh'; revset?: string }
	| { command: 'select-revision'; index: number }
	| { command: 'search'; request: RepoTimelineSearchRequest }
	| { command: 'open-file-result'; entryIndex: number; filePath: string; line?: number }
	| { command: 'open-revision-remote'; index: number };

export type RepoTimelineInboundMessage =
	| { type: 'repo-timeline-data'; payload: RepoTimelineData }
	| { type: 'repo-timeline-diff'; payload: RepoTimelineDiff }
	| { type: 'repo-timeline-search'; payload: RepoTimelineSearchPayload }
	| { type: 'repo-timeline-error'; payload: { message: string } };
