export type HistoryBackend = 'git' | 'jj';

export type ComparisonSource = 'revision' | 'snapshot';

export type ComparisonMode = 'range' | 'step';

export type LayoutMode = 'split' | 'unified';

export type ContentMode = 'diffs' | 'full';

export type TimelinePreset = 'year' | '7d' | '30d' | '90d' | 'all';

export type FileSwitcherMode = 'workspace' | 'overview';

export type FileRevisionEntry = {
	id: string;
	revision: string;
	shortRevision: string;
	changeId?: string;
	authorDate: string;
	authorName: string;
	description: string;
	isWorkingTree: boolean;
	touchesFile: boolean;
	timestamp: number;
	filePath?: string;
	operationId?: string;
	operationIndex?: number;
	operationKey?: string;
	remoteUrl?: string;
	hasPreviousEntry?: boolean;
	monthLabel?: string;
	shortDate?: string;
	relativeDate?: string;
	index?: number;
};

export type TimelinePreferences = {
	sidebarWidth?: number;
	sidebarCollapsed?: boolean;
	timelinePaneHeight?: number;
	timelinePaneCollapsed?: boolean;
	layoutMode?: LayoutMode;
	contentMode?: ContentMode;
	comparisonMode?: ComparisonMode;
	comparisonSource?: ComparisonSource;
	showIntermediateRevisions?: boolean;
	preset?: TimelinePreset;
};

export type DiffRow = {
	type: 'context' | 'add' | 'remove' | 'skip';
	leftNumber: number | null;
	rightNumber: number | null;
	text: string;
};

export type DiffPreview = {
	index: number;
	title: string;
	subtitle: string;
	diffCount: number;
	additions: number;
	deletions: number;
	hunkCount: number;
	hasChanges: boolean;
	fromIndex: number;
	toIndex: number;
	comparisonSource: ComparisonSource;
	rows: DiffRow[];
	nonTextualDetails: string[];
};

export type RangeOverviewItem = {
	relativePath: string;
	changeCount: number;
	isCurrentFile?: boolean;
};

export type TimelineSession = {
	backend: HistoryBackend;
	workspacePath: string;
	relativePath: string;
	absolutePath: string;
	fileName: string;
	entries: FileRevisionEntry[];
	snapshotEntries: FileRevisionEntry[];
	snapshotLoadedChangeIds: Set<string>;
	snapshotPendingChangeIds: Set<string>;
	workspaceFiles: string[];
	contentCache: Map<string, string>;
	previewCache: Map<string, DiffPreview>;
	rangeOverviewCache: Map<string, RangeOverviewItem[]>;
	entryDiffCountCache: Map<string, number>;
	pathCache: Map<string, string>;
	activeActionAbortController?: AbortController;
};

export type TimelineData = {
	backend: HistoryBackend;
	workspacePath: string;
	relativePath: string;
	fileName: string;
	version?: string;
	presets: Record<string, number>;
	defaultIndex: number;
	latestIndex: number;
	preferences: TimelinePreferences;
	workspaceFiles: string[];
	hasIntermediateRevisions: boolean;
	entries: FileRevisionEntry[];
	snapshotEntries: FileRevisionEntry[];
	snapshotState?: {
		loadedChangeIds: string[];
	};
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
				selectedEntryIndexes?: number[];
				items: RangeOverviewItem[];
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

export type TimelineCommand =
	| { command: 'ready' }
	| { command: 'refresh' }
	| { command: 'cancel-active-request' }
	| { command: 'open-current-file' }
	| { command: 'select-entry'; fromIndex: number; toIndex: number; comparisonSource: ComparisonSource }
	| { command: 'open-editor-diff'; fromIndex: number; toIndex: number; comparisonSource: ComparisonSource }
	| {
			command: 'open-range-files-diff';
			fromIndex: number;
			toIndex: number;
			comparisonSource: ComparisonSource;
			selectedEntryIndexes?: number[];
			editorCommand?: string;
	  }
	| {
			command: 'open-revision-files-diff';
			entryIndex: number;
			comparisonSource: ComparisonSource;
			editorCommand?: string;
	  }
	| { command: 'open-revision-remote'; entryIndex: number; comparisonSource: ComparisonSource }
	| { command: 'hydrate-snapshot-entries'; revisionIndexes: number[] }
	| {
			command: 'load-range-overview';
			fromIndex: number;
			toIndex: number;
			comparisonSource: ComparisonSource;
			selectedEntryIndexes?: number[];
	  }
	| {
			command: 'load-entry-diff-counts';
			entryIndexes: number[];
			comparisonSource: ComparisonSource;
	  }
	| { command: 'resolve-nonempty-range'; candidateIndexes: number[] }
	| { command: 'switch-file'; relativePath: string }
	| {
			command: 'persist-state';
			sidebarWidth: number;
			sidebarCollapsed: boolean;
			timelinePaneHeight: number;
			timelinePaneCollapsed: boolean;
			layoutMode: LayoutMode;
			contentMode: ContentMode;
			comparisonMode: ComparisonMode;
			comparisonSource: ComparisonSource;
			showIntermediateRevisions: boolean;
			preset: TimelinePreset;
	  };

export type TimelineFixtureFile = {
	timelineData: TimelineData;
	previews: Partial<Record<ComparisonSource, Record<string, DiffPreview>>>;
};

export type TimelineFixture = TimelineFixtureFile & {
	files?: Record<string, TimelineFixtureFile>;
};
