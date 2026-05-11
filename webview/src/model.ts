import { Option, Schema as S } from 'effect';
import { DragIdle, DragState } from './machine/drag.ts';
import { SelectionState } from './machine/selection.ts';
import { SessionState } from './machine/session.ts';

export const ComparisonMode = S.Literals(['range', 'step']);
export const ComparisonSource = S.Literals(['revision', 'snapshot']);
export const LayoutMode = S.Literals(['split', 'unified']);
export const ContentMode = S.Literals(['diffs', 'full']);
export const Preset = S.Literals(['year', '7d', '30d', '90d', 'all']);
export const FileSwitcherMode = S.Literals(['workspace', 'overview']);

// Complex host-shaped values. We keep Model Schema-based but treat these payloads as opaque
// because their nested arrays and maps are validated at the host boundary.
export const Model = S.Struct({
	session: SessionState,
	selection: SelectionState,
	data: S.NullOr(S.Unknown),
	fromIndex: S.Number,
	toIndex: S.Number,
	comparisonMode: ComparisonMode,
	comparisonSource: ComparisonSource,
	layoutMode: LayoutMode,
	contentMode: ContentMode,
	preset: Preset,
	showIntermediateRevisions: S.Boolean,
	sidebarSearchQuery: S.String,
	sidebarWidth: S.Number,
	sidebarCollapsed: S.Boolean,
	responsiveSidebarHeight: S.Number,
	timelinePaneHeight: S.Number,
	timelinePaneCollapsed: S.Boolean,
	diffFocusMode: S.Boolean,
	actionsMenuOpen: S.Boolean,
	hotkeysOpen: S.Boolean,
	oldestFirst: S.Boolean,
	fileInputValue: S.String,
	fileSwitcherMode: FileSwitcherMode,
	rangeOverviewByRange: S.Record(S.String, S.Unknown),
	rangeOverviewLoadingKey: S.String,
	entryDiffCountByKey: S.Record(S.String, S.Number),
	entryDiffCountLoadingKey: S.String,
	previewByRange: S.Record(S.String, S.Unknown),
	sidebarPreviewInFlightKey: S.String,
	pendingRangeResolutionKey: S.String,
	maybeHoveredSelectionIndex: S.Option(S.Number),
	shortcutFocusedInputId: S.Option(S.String),
	sessionKey: S.Number,
	previewRequestId: S.Number,
	dragState: DragState,
	suppressAnchorClick: S.Boolean,
});
export type Model = typeof Model.Type;

export const initialModel: Model = {
	session: { _tag: 'Idle' },
	selection: { _tag: 'IdlePick' },
	data: null,
	fromIndex: 0,
	toIndex: 0,
	comparisonMode: 'range',
	comparisonSource: 'revision',
	layoutMode: 'split',
	contentMode: 'diffs',
	preset: 'year',
	showIntermediateRevisions: false,
	sidebarSearchQuery: '',
	sidebarWidth: 280,
	sidebarCollapsed: false,
	responsiveSidebarHeight: 248,
	timelinePaneHeight: 278,
	timelinePaneCollapsed: false,
	diffFocusMode: false,
	actionsMenuOpen: false,
	hotkeysOpen: false,
	oldestFirst: false,
	fileInputValue: '',
	fileSwitcherMode: 'workspace',
	rangeOverviewByRange: {},
	rangeOverviewLoadingKey: '',
	entryDiffCountByKey: {},
	entryDiffCountLoadingKey: '',
	previewByRange: {},
	sidebarPreviewInFlightKey: '',
	pendingRangeResolutionKey: '',
	maybeHoveredSelectionIndex: Option.none(),
	shortcutFocusedInputId: Option.none(),
	sessionKey: 0,
	previewRequestId: 0,
	dragState: DragIdle(),
	suppressAnchorClick: false,
};
