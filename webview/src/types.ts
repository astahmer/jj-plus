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
	FileSwitcherMode,
	HistoryBackend,
	LayoutMode,
	RangeOverviewItem,
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
	| { type: 'resolved-range'; payload: { fromIndex: number; toIndex: number } | null };

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
