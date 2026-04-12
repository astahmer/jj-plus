import { createContext, useContext, type Accessor, type JSX } from 'solid-js';
import type {
	ComparisonMode,
	ComparisonSource,
	ContentMode,
	DiffPreview,
	FileRevisionEntry,
	HistoryBackend,
	LayoutMode,
	TimelinePreset,
} from './types';

export type TimelineStateContext = {
	backend: Accessor<HistoryBackend | null>;
	visibleEntries: Accessor<FileRevisionEntry[]>;
	sidebarEntries: Accessor<FileRevisionEntry[]>;
	workspaceFiles: Accessor<string[]>;
	fileInputValue: Accessor<string>;
	fromIndex: Accessor<number>;
	toIndex: Accessor<number>;
	pendingSelectionIndex: Accessor<number | null>;
	hoveredSelectionIndex: Accessor<number | null>;
	rangeLabel: Accessor<string>;
	rangeSubtitle: Accessor<string>;
	selectionMeta: Accessor<string>;
	stepStatus: Accessor<string>;
	version: Accessor<string>;
	comparisonMode: Accessor<ComparisonMode>;
	comparisonSource: Accessor<ComparisonSource>;
	layoutMode: Accessor<LayoutMode>;
	contentMode: Accessor<ContentMode>;
	intermediateLabel: Accessor<string>;
	preset: Accessor<TimelinePreset>;
	showIntermediateRevisions: Accessor<boolean>;
	hasIntermediateRevisions: Accessor<boolean>;
	sidebarCollapsed: Accessor<boolean>;
	timelinePaneCollapsed: Accessor<boolean>;
	actionsMenuOpen: Accessor<boolean>;
	hotkeysOpen: Accessor<boolean>;
	showSnapshotStatus: Accessor<boolean>;
	snapshotStatusLabel: Accessor<string>;
	diffFocusMode: Accessor<boolean>;
	canStepBackward: Accessor<boolean>;
	canStepForward: Accessor<boolean>;
	currentFromEntry: Accessor<FileRevisionEntry | undefined>;
	currentToEntry: Accessor<FileRevisionEntry | undefined>;
	preview: Accessor<DiffPreview | null>;
	previewForEntry: (entryIndex: number) => DiffPreview | null;
	sidebarSearchQuery: Accessor<string>;
	visibleEntryCount: Accessor<number>;
	oldestFirst: Accessor<boolean>;
};

export type TimelineActionsContext = {
	selectEntry: (entryIndex: number) => void;
	hoverEntry: (entryIndex: number | null) => void;
	setSidebarSearchQuery: (value: string) => void;
	toggleSortOrder: () => void;
	openSelectionDiffs: () => void;
	openRevisionFilesDiff: (entryIndex: number) => void;
	openRevisionRemote: (entryIndex: number) => void;
	showInfoTooltip: (event: MouseEvent, label: string | null, value: string) => void;
	hideInfoTooltip: () => void;
	submitFile: (value: string) => void;
	toggleSidebar: () => void;
	toggleSidebarFromMenu: () => void;
	toggleTimelinePane: () => void;
	toggleHotkeys: () => void;
	toggleActionsMenu: () => void;
	openCurrentFile: () => void;
	openEditorDiff: () => void;
	cancelActiveRequest: () => void;
	refreshTimeline: () => void;
	resetPreferences: () => void;
	setComparisonMode: (value: ComparisonMode) => void;
	setComparisonSource: (value: ComparisonSource) => void;
	setLayoutMode: (value: LayoutMode) => void;
	setContentMode: (value: ContentMode) => void;
	setPreset: (value: TimelinePreset) => void;
	toggleIntermediateRevisions: () => void;
	stepSelection: (amount: number) => void;
	showAnchorTooltip: (entryIndex: number, target: HTMLElement) => void;
	hideRangeTooltip: () => void;
	submitRevision: (side: 'from' | 'to', value: string) => void;
	toggleDiffFocus: () => void;
};

export type TimelineContextValue = {
	state: TimelineStateContext;
	actions: TimelineActionsContext;
};

const TimelineContext = createContext<TimelineContextValue>();

export function TimelineProvider(props: { value: TimelineContextValue; children: JSX.Element }) {
	return <TimelineContext.Provider value={props.value}>{props.children}</TimelineContext.Provider>;
}

export function useTimelineContext() {
	const context = useContext(TimelineContext);
	if (!context) {
		throw new Error('Timeline context is unavailable.');
	}

	return context;
}
