export type HistoryBackend = 'jj' | 'git';
export type ComparisonMode = 'range' | 'step';
export type ComparisonSource = 'revision' | 'snapshot';
export type LayoutMode = 'split' | 'unified';
export type ContentMode = 'diffs' | 'full';
export type TimelinePreset = 'year' | '7d' | '30d' | '90d' | 'all';

export type FileRevisionEntry = {
  id: string;
  index: number;
  revision: string;
  shortRevision: string;
  changeId?: string;
  authorDate: string;
  authorName?: string;
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

export type DiffRow = {
  type: 'context' | 'add' | 'remove' | 'skip';
  leftNumber: number | null;
  rightNumber: number | null;
  text: string;
  previewKey?: string;
  rangeKey?: string;
};

export type DiffPreview = {
  index: number;
  title: string;
  subtitle: string;
  additions: number;
  deletions: number;
  hunkCount: number;
  hasChanges: boolean;
  fromIndex: number;
  toIndex: number;
  comparisonSource?: ComparisonSource;
  rows: DiffRow[];
  nonTextualDetails?: string[];
};

export type TimelineInboundMessage =
  | { type: 'timeline-data'; payload: TimelineData }
  | { type: 'diff-preview'; payload: DiffPreview }
  | { type: 'snapshot-entries'; payload: Pick<TimelineData, 'snapshotEntries' | 'snapshotState'> }
  | { type: 'resolved-range'; payload: { fromIndex: number; toIndex: number } | null };

export type TimelineCommand =
  | { command: 'ready' }
  | { command: 'refresh' }
  | { command: 'cancel-active-request' }
  | { command: 'open-current-file' }
  | { command: 'select-entry'; fromIndex: number; toIndex: number; comparisonSource: ComparisonSource }
  | { command: 'open-editor-diff'; fromIndex: number; toIndex: number; comparisonSource: ComparisonSource }
  | { command: 'open-range-files-diff'; fromIndex: number; toIndex: number; comparisonSource: ComparisonSource }
  | { command: 'open-revision-files-diff'; entryIndex: number; comparisonSource: ComparisonSource }
  | { command: 'open-revision-remote'; entryIndex: number; comparisonSource: ComparisonSource }
  | { command: 'hydrate-snapshot-entries'; revisionIndexes: number[] }
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

export type TimelineHost = {
  send: (command: TimelineCommand) => void;
  subscribe: (listener: (message: TimelineInboundMessage) => void) => () => void;
};

export type TimelineFixtureFile = {
  timelineData: TimelineData;
  previews: Partial<Record<ComparisonSource, Record<string, DiffPreview>>>;
};

export type TimelineFixture = TimelineFixtureFile & {
  files?: Record<string, TimelineFixtureFile>;
};
