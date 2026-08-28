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
	files: Array<string>;
};

export type RepoTimelineCommand =
	| { command: 'ready' }
	| { command: 'refresh'; revset?: string }
	| { command: 'select-revision'; index: number }
	| { command: 'open-revision-remote'; index: number };

export type RepoTimelineInboundMessage =
	| { type: 'repo-timeline-data'; payload: RepoTimelineData }
	| { type: 'repo-timeline-diff'; payload: RepoTimelineDiff }
	| { type: 'repo-timeline-error'; payload: { message: string } };
