import { Schema as S } from 'effect';
import { m } from 'foldkit/message';

// MESSAGE

export const BootedApp = m('BootedApp');
export const CompletedSendHost = m('CompletedSendHost');
export const CompletedPersistState = m('CompletedPersistState');
export const CompletedFocusElement = m('CompletedFocusElement');
export const CompletedScrollToEntry = m('CompletedScrollToEntry');
export const CompletedSyncPass = m('CompletedSyncPass');

export const GotHostMessage = m('GotHostMessage', { payload: S.Unknown });

// Sidebar / entries
export const ClickedHistoryEntry = m('ClickedHistoryEntry', { entryIndex: S.Number });
export const HoveredEntry = m('HoveredEntry', { entryIndex: S.Number });
export const UnhoveredEntry = m('UnhoveredEntry');
export const ClickedOpenRevisionRemote = m('ClickedOpenRevisionRemote', { entryIndex: S.Number });
export const ClickedOpenRevisionFilesDiff = m('ClickedOpenRevisionFilesDiff', { entryIndex: S.Number });
export const ClickedScrollToEntry = m('ClickedScrollToEntry', { entryIndex: S.Number });

// Sidebar controls
export const UpdatedSidebarSearchQuery = m('UpdatedSidebarSearchQuery', { value: S.String });
export const ToggledSortOrder = m('ToggledSortOrder');
export const ClickedOpenSelectionDiffs = m('ClickedOpenSelectionDiffs');
export const ClickedOpenEditorDiff = m('ClickedOpenEditorDiff');

// Timeline pane / actions menu
export const ClickedToggleSidebar = m('ClickedToggleSidebar');
export const ClickedToggleSidebarFromMenu = m('ClickedToggleSidebarFromMenu');
export const ClickedToggleTimelinePane = m('ClickedToggleTimelinePane');
export const ClickedToggleActionsMenu = m('ClickedToggleActionsMenu');
export const ClickedToggleViewMenu = m('ClickedToggleViewMenu');
export const ClickedToggleHotkeys = m('ClickedToggleHotkeys');
export const ClickedOpenCurrentFile = m('ClickedOpenCurrentFile');
export const ClickedCancelActiveRequest = m('ClickedCancelActiveRequest');
export const ClickedRefreshTimeline = m('ClickedRefreshTimeline');
export const ClickedClearLineHistory = m('ClickedClearLineHistory');
export const ClickedResetPreferences = m('ClickedResetPreferences');
export const ClickedToggleDiffFocus = m('ClickedToggleDiffFocus');

// Comparison / layout
export const SelectedComparisonMode = m('SelectedComparisonMode', { value: S.Literals(['range', 'step']) });
export const SelectedComparisonSource = m('SelectedComparisonSource', {
	value: S.Literals(['revision', 'snapshot']),
});
export const SelectedLayoutMode = m('SelectedLayoutMode', { value: S.Literals(['split', 'unified']) });
export const SelectedContentMode = m('SelectedContentMode', { value: S.Literals(['diffs', 'full']) });
export const SelectedPreset = m('SelectedPreset', { value: S.Literals(['year', '7d', '30d', '90d', 'all']) });
export const UpdatedCustomRevset = m('UpdatedCustomRevset', { value: S.String });
export const AppliedCustomRevset = m('AppliedCustomRevset');
export const ToggledIntermediate = m('ToggledIntermediate');

// Track
export const ClickedTrackAnchor = m('ClickedTrackAnchor', { entryIndex: S.Number });
export const ClickedStepBackward = m('ClickedStepBackward');
export const ClickedStepFastBackward = m('ClickedStepFastBackward');
export const ClickedStepForward = m('ClickedStepForward');
export const ClickedStepFastForward = m('ClickedStepFastForward');

// Track drag interactions
export const PressedTrackAnchor = m('PressedTrackAnchor', {
	entryIndex: S.Number,
	clientX: S.Number,
	clientY: S.Number,
	button: S.Number,
});
export const PressedRangeFill = m('PressedRangeFill', { clientX: S.Number, button: S.Number });
export const PressedMarker = m('PressedMarker', {
	side: S.Literals(['from', 'to']),
	clientX: S.Number,
	button: S.Number,
});
export const PressedTrack = m('PressedTrack', { clientX: S.Number, button: S.Number });
export const PointerMovedDuringDrag = m('PointerMovedDuringDrag', {
	clientX: S.Number,
	clientY: S.Number,
});
export const ReleasedPointerDuringDrag = m('ReleasedPointerDuringDrag');

// Track hover tooltip
export const MovedOverTrack = m('MovedOverTrack', {
	clientX: S.Number,
	clientY: S.Number,
	anchorEntryIndex: S.NullOr(S.Number),
});
export const LeftTrack = m('LeftTrack');

// File switcher
export const SelectedFileSwitcherMode = m('SelectedFileSwitcherMode', { value: S.Literals(['workspace', 'overview']) });
export const SubmittedFileSwitcher = m('SubmittedFileSwitcher', { value: S.String });

// Revision pickers / combobox drafts
export const SubmittedFromRevision = m('SubmittedFromRevision', { value: S.String });
export const SubmittedToRevision = m('SubmittedToRevision', { value: S.String });
export const OpenedCombobox = m('OpenedCombobox', { id: S.String });
export const ClosedCombobox = m('ClosedCombobox', { id: S.String });
export const UpdatedComboboxDraft = m('UpdatedComboboxDraft', { id: S.String, value: S.String });

// Keyboard shortcut
export const PressedShortcut = m('PressedShortcut', {
	key: S.String,
	shiftKey: S.Boolean,
	metaKey: S.Boolean,
	ctrlKey: S.Boolean,
	altKey: S.Boolean,
	targetId: S.String,
	isEditableTarget: S.Boolean,
});

// Sync sub-messages
export const SettledPreview = m('SettledPreview');
export const SettledRangeOverview = m('SettledRangeOverview', { key: S.String });
export const SettledEntryDiffCounts = m('SettledEntryDiffCounts', { key: S.String });
export const SettledSidebarPreview = m('SettledSidebarPreview', { key: S.String });

// Diff-panel
export const ClickedSkipRange = m('ClickedSkipRange', { previewKey: S.String, rangeKey: S.String });

// Combobox commit (fallback to a specific message per input)
export const IgnoredMouseClick = m('IgnoredMouseClick');
export const CompletedCloseOverlays = m('CompletedCloseOverlays');

export const Message = S.Union([
	BootedApp,
	CompletedSendHost,
	CompletedPersistState,
	CompletedFocusElement,
	CompletedScrollToEntry,
	CompletedSyncPass,
	GotHostMessage,
	ClickedHistoryEntry,
	HoveredEntry,
	UnhoveredEntry,
	ClickedOpenRevisionRemote,
	ClickedOpenRevisionFilesDiff,
	ClickedScrollToEntry,
	UpdatedSidebarSearchQuery,
	ToggledSortOrder,
	ClickedOpenSelectionDiffs,
	ClickedOpenEditorDiff,
	ClickedToggleSidebar,
	ClickedToggleSidebarFromMenu,
	ClickedToggleTimelinePane,
	ClickedToggleActionsMenu,
	ClickedToggleViewMenu,
	ClickedToggleHotkeys,
	ClickedOpenCurrentFile,
	ClickedCancelActiveRequest,
	ClickedRefreshTimeline,
	ClickedClearLineHistory,
	ClickedResetPreferences,
	ClickedToggleDiffFocus,
	SelectedComparisonMode,
	SelectedComparisonSource,
	SelectedLayoutMode,
	SelectedContentMode,
	SelectedPreset,
	UpdatedCustomRevset,
	AppliedCustomRevset,
	ToggledIntermediate,
	ClickedTrackAnchor,
	ClickedStepBackward,
	ClickedStepFastBackward,
	ClickedStepForward,
	ClickedStepFastForward,
	PressedTrackAnchor,
	PressedRangeFill,
	PressedMarker,
	PressedTrack,
	PointerMovedDuringDrag,
	ReleasedPointerDuringDrag,
	MovedOverTrack,
	LeftTrack,
	SelectedFileSwitcherMode,
	SubmittedFileSwitcher,
	SubmittedFromRevision,
	SubmittedToRevision,
	OpenedCombobox,
	ClosedCombobox,
	UpdatedComboboxDraft,
	PressedShortcut,
	SettledPreview,
	SettledRangeOverview,
	SettledEntryDiffCounts,
	SettledSidebarPreview,
	ClickedSkipRange,
	IgnoredMouseClick,
	CompletedCloseOverlays,
]);
export type Message = typeof Message.Type;
