import type * as vscode from 'vscode';
import type {
	ComparisonSource,
	FileRevisionEntry,
	HistoryBackend,
	LineHistoryRange,
	TimelinePreferences,
	TimelineSession,
} from '../shared/timeline-types.ts';

export type RangeDiffArgs = {
	from?: string;
	to?: string;
	base?: string;
	target?: string;
	title?: string;
	workspacePath?: string;
	confirm?: boolean;
	verbose?: boolean;
	source?: string;
};

export type SnapshotQuery = {
	workspacePath?: string;
	filePath?: string;
	revset?: string;
	backend?: HistoryBackend;
	contentId?: string;
};

export type CommandResult = {
	stdout: string;
	stderr: string;
};

export type RunCommandOptions = {
	signal?: AbortSignal;
};

export type MultiDiffResourceDescriptor = {
	relativePath: string;
	originalRevset: string;
	modifiedRevset: string;
	backend: HistoryBackend;
};

export type MultiDiffPlan = {
	title: string;
	files: MultiDiffResourceDescriptor[];
};

export type HistoryAdapter = {
	backend: HistoryBackend;
	getFileRevisionHistory(args: {
		workspacePath: string;
		relativePath: string;
		limit?: number;
		/** Optional jj revset intersected with the default file history window. */
		customRevset?: string;
	}): Promise<FileRevisionEntry[]>;
	getRepositoryRevisionHistory(args: { workspacePath: string; limit?: number }): Promise<FileRevisionEntry[]>;
	showFileAtRevision(args: { workspacePath: string; revset: string; filePath: string }): Promise<string>;
	resolvePreviousPath(args: { workspacePath: string; revision: string; currentPath: string }): Promise<string>;
	listRevisionFiles(args: { workspacePath: string; revision: string; signal?: AbortSignal }): Promise<string[]>;
	listWorkingTreeFiles(args: { workspacePath: string; signal?: AbortSignal }): Promise<string[]>;
	getRemoteBaseUrl(args: { workspacePath: string }): Promise<string | undefined>;
	getSnapshotEntriesForFile(args: {
		workspacePath: string;
		relativePath: string;
		entry: FileRevisionEntry;
	}): Promise<FileRevisionEntry[]>;
	buildRangeMultiDiffPlan(args: {
		workspacePath: string;
		fromEntry: FileRevisionEntry;
		toEntry: FileRevisionEntry;
		comparisonSource: ComparisonSource;
		sourceEntries: FileRevisionEntry[];
		signal?: AbortSignal;
	}): Promise<MultiDiffPlan>;
	buildRevisionMultiDiffPlan(args: {
		workspacePath: string;
		entry: FileRevisionEntry;
		entryIndex: number;
		comparisonSource: ComparisonSource;
		sourceEntries: FileRevisionEntry[];
		signal?: AbortSignal;
	}): Promise<MultiDiffPlan>;
};

export type CommandRunner = {
	runGit(args: { workspacePath: string; args: string[]; options?: RunCommandOptions }): Promise<CommandResult>;
	runJj(args: { workspacePath: string; args: string[]; options?: RunCommandOptions }): Promise<CommandResult>;
	fileExists(args: { filePath: string }): Promise<boolean>;
	quoteShellArg(value: string): string;
};

export type ExtensionTimelineSession = TimelineSession & {
	adapter: HistoryAdapter;
	historyLimit: number;
	workspaceFilesLoaded: boolean;
	intermediateRevisionsLoaded: boolean;
	lineHistory?: LineHistoryRange;
	customRevset?: string;
};

export type TimelineDebugState = {
	panelOpen: boolean;
	panelCount: number;
	panelTitle: string;
	backend: string;
	workspacePath: string;
	relativePath: string;
	fileName: string;
	entryCount: number;
	snapshotEntryCount: number;
	lineHistory: { startLine: number; endLine: number } | null;
	usesBundledWebview: boolean;
	viewReady: boolean;
	readyCount: number;
	lastMessageCommand: string;
	lastReadyAt: number;
	entries: Array<{ index: number; description: string; shortRevision: string }>;
};

export type TimelinePanelController = {
	openFileRevisionTimeline(args: {
		context: vscode.ExtensionContext;
		absolutePath?: string;
		lineHistory?: LineHistoryRange;
	}): Promise<void>;
	getDebugState(): TimelineDebugState;
	getDiffLayoutMetrics(): Promise<import('../shared/timeline-types.ts').DiffLayoutMetrics>;
	selectTimelineRange(args: {
		fromIndex: number;
		toIndex: number;
		comparisonSource?: 'revision' | 'snapshot';
	}): Promise<void>;
	setLayoutMode(layoutMode: 'split' | 'unified'): Promise<void>;
	dispose(): void;
};

export type TimelinePayloadArgs = {
	session: ExtensionTimelineSession;
	preferences: TimelinePreferences;
	version: string;
	presets: Record<string, number>;
};

export type SessionAction = (signal: AbortSignal) => Promise<void>;
