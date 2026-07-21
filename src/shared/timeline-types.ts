export type HistoryBackend = 'git' | 'jj';

export type ComparisonSource = 'revision' | 'snapshot';

export type ComparisonMode = 'range' | 'step';

export type LayoutMode = 'split' | 'unified';

export type ContentMode = 'diffs' | 'full';

export type TimelinePreset = 'year' | '7d' | '30d' | '90d' | 'all';

export type FileSwitcherMode = 'workspace' | 'overview';

export type LineHistoryRange = {
	startLine: number;
	endLine: number;
};

export type FileRevisionEntry = {
	id: string;
	revision: string;
	shortRevision: string;
	changeId?: string;
	bookmarkNames?: string[];
	branchNames?: string[];
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
	customRevset?: string;
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
	beforePath: string;
	afterPath: string;
	beforeText: string;
	afterText: string;
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
	/** False until host finishes lazy `jj file list` / `git ls-files` fill. */
	workspaceFilesLoaded?: boolean;
	hasIntermediateRevisions: boolean;
	entries: FileRevisionEntry[];
	snapshotEntries: FileRevisionEntry[];
	snapshotState?: {
		loadedChangeIds: string[];
	};
	/** Present when timeline is filtered to revisions that touched these lines. */
	lineHistory?: LineHistoryRange;
	customRevset?: string;
};

export type RangeStackPreviewPayload = {
	fromIndex: number;
	toIndex: number;
	comparisonSource: ComparisonSource;
	items: Array<{ relativePath: string; preview: DiffPreview }>;
};

export type TimelineInboundMessage =
	| { type: 'timeline-data'; payload: TimelineData }
	| { type: 'diff-preview'; payload: DiffPreview }
	| { type: 'snapshot-entries'; payload: Pick<TimelineData, 'snapshotEntries' | 'snapshotState'> }
	| { type: 'workspace-files'; payload: { workspaceFiles: string[] } }
	| {
			type: 'entries-updated';
			payload: {
				entries: FileRevisionEntry[];
				hasIntermediateRevisions: boolean;
			};
	  }
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
	| { type: 'resolved-range'; payload: { fromIndex: number; toIndex: number } | null }
	| { type: 'debug-measure-layout' }
	| { type: 'debug-set-layout-mode'; layoutMode: LayoutMode }
	| { type: 'range-stack-previews'; payload: RangeStackPreviewPayload };

export type DiffLayoutMetrics = {
	viewportH: number;
	portalH: number;
	portalTop: number;
	hostH: number;
	hostScrollH: number;
	rowsH: number;
	contentH: number;
	timelineH: number;
	maxLineH: number;
	minLineH: number;
	lineCount: number;
	maxCodeScrollH: number;
	minCodeClientH: number;
	portalFillRatio: number;
	paintedH: number;
	paintedRatio: number;
	/** Vertical span of [data-line] tops (layout space, not just viewport). */
	lineTopSpan: number;
	uniqueLineTops: number;
	isCrushed: boolean;
};

export type TimelineCommand =
	| { command: 'ready' }
	| { command: 'refresh' }
	| { command: 'cancel-active-request' }
	| { command: 'layout-metrics'; metrics: DiffLayoutMetrics }
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
	| { command: 'clear-line-history' }
	| { command: 'set-custom-revset'; customRevset: string }
	| {
			command: 'load-range-stack';
			fromIndex: number;
			toIndex: number;
			comparisonSource: ComparisonSource;
			relativePaths: string[];
	  }
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
			customRevset?: string;
	  };

export type TimelineFixtureFile = {
	timelineData: TimelineData;
	previews: Partial<Record<ComparisonSource, Record<string, DiffPreview>>>;
};

export type TimelineFixture = TimelineFixtureFile & {
	files?: Record<string, TimelineFixtureFile>;
};
