import type {
	ComparisonMode,
	ComparisonSource,
	ContentMode,
	DiffPreview as SharedDiffPreview,
	DiffRow as SharedDiffRow,
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
} from '../../src/shared/timeline-types';

export type {
	ComparisonMode,
	ComparisonSource,
	ContentMode,
	FileSwitcherMode,
	HistoryBackend,
	LayoutMode,
	RangeOverviewItem,
	TimelineCommand,
	TimelinePreferences,
	TimelinePreset,
};

export type DiffRow = SharedDiffRow & {
	previewKey?: string;
	rangeKey?: string;
};

export type DiffPreview = Omit<SharedDiffPreview, 'rows'> & {
	rows: DiffRow[];
};

export type FileRevisionEntry = Omit<SharedFileRevisionEntry, 'index'> & {
	index: number;
};

export type TimelineData = Omit<SharedTimelineData, 'entries' | 'snapshotEntries'> & {
	entries: FileRevisionEntry[];
	snapshotEntries: FileRevisionEntry[];
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
				items: RangeOverviewItem[];
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
