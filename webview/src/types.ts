import type {
	ComparisonMode,
	ComparisonSource,
	ContentMode,
	DiffPreview,
	FileRevisionEntry as SharedFileRevisionEntry,
	FileSwitcherMode,
	HistoryBackend,
	LayoutMode,
	RangeOverviewItem,
	RangeStackPreviewPayload,
	DiffBlamePayload,
	FileOpLogPayload,
	HistorySearchPayload,
	ThemePreference,
	TimelineCommand,
	TimelineData as SharedTimelineData,
	TimelineFixture as SharedTimelineFixture,
	TimelineFixtureFile as SharedTimelineFixtureFile,
	TimelinePreferences,
	TimelinePreset,
} from '../../src/shared/timeline-types.ts';

export type {
	ComparisonMode,
	ComparisonSource,
	ContentMode,
	DiffPreview,
	DiffBlamePayload,
	FileOpLogPayload,
	HistorySearchPayload,
	FileSwitcherMode,
	HistoryBackend,
	LayoutMode,
	RangeOverviewItem,
	RangeStackPreviewPayload,
	ThemePreference,
	TimelineCommand,
	TimelinePreferences,
	TimelinePreset,
};

export type FileRevisionEntry = Omit<SharedFileRevisionEntry, 'index'> & {
	index: number;
};

export type TimelineData = Omit<SharedTimelineData, 'entries' | 'snapshotEntries'> & {
	entries: Array<FileRevisionEntry>;
	snapshotEntries: Array<FileRevisionEntry>;
};

export type TimelineInboundMessage =
	| { type: 'timeline-data'; payload: TimelineData }
	| { type: 'diff-preview'; payload: DiffPreview }
	| { type: 'snapshot-entries'; payload: Pick<TimelineData, 'snapshotEntries' | 'snapshotState'> }
	| { type: 'workspace-files'; payload: { workspaceFiles: Array<string> } }
	| { type: 'revision-tree-files'; payload: { revision: string; files: Array<string> } }
	| {
			type: 'entries-updated';
			payload: {
				entries: Array<FileRevisionEntry>;
				hasIntermediateRevisions: boolean;
			};
	  }
	| {
			type: 'range-overview';
			payload: {
				fromIndex: number;
				toIndex: number;
				comparisonSource: ComparisonSource;
				selectedEntryIndexes?: Array<number>;
				items: Array<RangeOverviewItem>;
			};
	  }
	| {
			type: 'entry-diff-counts';
			payload: {
				comparisonSource: ComparisonSource;
				counts: Array<{
					entryIndex: number;
					diffCount: number;
				}>;
			};
	  }
	| { type: 'resolved-range'; payload: { fromIndex: number; toIndex: number } | null }
	| { type: 'debug-measure-layout' }
	| { type: 'debug-set-layout-mode'; layoutMode: LayoutMode }
	| { type: 'range-stack-previews'; payload: RangeStackPreviewPayload }
	| { type: 'diff-blame'; payload: DiffBlamePayload }
	| { type: 'file-oplog'; payload: FileOpLogPayload }
	| { type: 'history-search'; payload: HistorySearchPayload };

export type TimelineFixtureFile = Omit<SharedTimelineFixtureFile, 'timelineData' | 'previews'> & {
	timelineData: TimelineData;
	previews: Partial<Record<ComparisonSource, Record<string, DiffPreview>>>;
};

export type TimelineFixture = Omit<SharedTimelineFixture, 'timelineData' | 'previews' | 'files'> & {
	timelineData: TimelineData;
	previews: Partial<Record<ComparisonSource, Record<string, DiffPreview>>>;
	files?: Record<string, TimelineFixtureFile>;
};

export type TimelineHost = {
	send: (command: TimelineCommand) => void;
	subscribe: (listener: (message: TimelineInboundMessage) => void) => () => void;
};
