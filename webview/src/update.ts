import { Match as M, Option } from 'effect';
import type { Command } from 'foldkit';
import { evo } from 'foldkit/struct';
import {
	buildEntryDiffCountKey,
	buildPreviewKey,
	buildRangeOverviewKey,
	adjustRangeBoundary,
	alignStepSelection,
	canNavigateSelection,
	dockRangeSelection,
	filterEntries,
	getDefaultSelection,
	getVisibleIndexForAbsoluteIndex,
	mapSelectionAcrossSources,
	normalizeSelection,
	shiftRangeSelection,
	shiftStepSelection,
} from './domain/timeline-selection.ts';
import {
	getEntriesForSource,
	findRevisionEntryMatch,
	getUnitPreviewRange,
	getVisibleIndexFromClientX,
} from './domain/timeline-model.ts';
import {
	buildPendingRangeTooltipPayload,
	buildRangeTooltipPayload,
	buildSegmentTooltipPayload,
} from './domain/timeline-tooltips.ts';
import {
	DragAnchorIntent,
	DragIdle,
	DragMarker,
	DragRange,
	DragSidebarResize,
	DragTimelineResize,
	isResponsiveLayout,
	RESPONSIVE_SIDEBAR_COLLAPSE_THRESHOLD,
	RESPONSIVE_SIDEBAR_MAX_HEIGHT,
	RESPONSIVE_SIDEBAR_MIN_HEIGHT,
	SIDEBAR_COLLAPSE_THRESHOLD,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	SIDEBAR_REOPEN_THRESHOLD,
	TIMELINE_COLLAPSED_HEIGHT,
	TIMELINE_RESIZE_MAX_HEIGHT,
	TIMELINE_RESIZE_MIN_HEIGHT,
	TRACK_ANCHOR_DRAG_START_DISTANCE,
	type DragState,
} from './machine/drag.ts';
import {
	mergePreviewCaches,
	readCachedFileSession,
	rememberFileSession,
	type FileSessionSnapshot,
} from './domain/file-session-cache.ts';
import { getEditableShortcutBehavior, resolveTimelineShortcut } from './domain/timeline-shortcuts.ts';
import { buildTimelineSyncPlan } from './domain/timeline-sync.ts';
import {
	selectionMachine,
	CommittedSelection,
	ClickedEntry as SelectionClickedEntry,
	CancelledSelection,
} from './machine/selection.ts';
import { ReceivedTimelineData, RefreshedSession, SwitchedFile } from './machine/session.ts';
import { sessionMachine, BootedSession } from './machine/session.ts';
import {
	Closed,
	ClosedOverlays,
	overlayFlagsFromState,
	overlayMachine,
	ToggledActionsMenu,
	ToggledHotkeys,
	ToggledViewMenu,
} from './machine/overlay.ts';
import type { Model } from './model.ts';
import { initialModel } from './model.ts';
import { BootSession, FocusElement, PersistState, ScrollToEntry, SendHostCommand } from './commands.ts';
import type { Message } from './messages.ts';
import { pickRangeStackPaths } from '../../src/shared/range-stack.ts';
import { findEntryIndexForBlameRevision } from '../../src/shared/blame.ts';
import { extractSidebarContentNeedle } from '../../src/shared/sidebar-search.ts';
import {
	getActivePreviewKey,
	getActiveRangeOverviewKey,
	getActiveRangeOverviewItems,
	getData,
	getEffectiveComparisonSource,
	getFilteredSidebarEntries,
	getPendingSnapshotRevisionIndexesSelector,
	getSelectedDiffEntryIndexesSelector,
	getSourceEntries,
	getVisibleEntries,
} from './selectors.ts';
import type {
	ComparisonMode,
	ComparisonSource,
	DiffPreview,
	RangeOverviewItem,
	TimelineCommand,
	TimelineData,
	TimelineInboundMessage,
	TimelinePreset,
} from './types.ts';

const TIMELINE_EXPANDED_MIN_HEIGHT = 176;

type UpdateReturn = readonly [Model, ReadonlyArray<Command.Command<Message>>];

function clampSidebarWidth(width: number) {
	const max =
		typeof window === 'undefined'
			? SIDEBAR_MAX_WIDTH
			: Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - 220));
	return Math.max(SIDEBAR_MIN_WIDTH, Math.min(max, Math.round(width)));
}

function clampResponsiveSidebarHeight(height: number) {
	const max =
		typeof window === 'undefined'
			? RESPONSIVE_SIDEBAR_MAX_HEIGHT
			: Math.max(RESPONSIVE_SIDEBAR_MIN_HEIGHT, Math.min(RESPONSIVE_SIDEBAR_MAX_HEIGHT, window.innerHeight - 220));
	return Math.max(RESPONSIVE_SIDEBAR_MIN_HEIGHT, Math.min(max, Math.round(height)));
}

function clampTimelinePaneHeight(height: number) {
	return Math.max(TIMELINE_RESIZE_MIN_HEIGHT, Math.min(TIMELINE_RESIZE_MAX_HEIGHT, Math.round(height)));
}

function persistCommand(model: Model): Command.Command<Message> {
	const command: TimelineCommand = {
		command: 'persist-state',
		sidebarWidth: model.sidebarWidth,
		sidebarCollapsed: model.sidebarCollapsed,
		timelinePaneHeight: model.timelinePaneHeight,
		timelinePaneCollapsed: model.timelinePaneCollapsed,
		layoutMode: model.layoutMode,
		contentMode: model.contentMode,
		comparisonMode: model.comparisonMode,
		comparisonSource: getEffectiveComparisonSource(model),
		showIntermediateRevisions: model.showIntermediateRevisions,
		preset: model.preset,
		customRevset: model.customRevset,
		themePreference: model.themePreference,
		heatmapOpen: model.heatmapOpen,
	};
	return PersistState({ command });
}

function withPersist(model: Model, extraCommands: ReadonlyArray<Command.Command<Message>> = []): UpdateReturn {
	if (model.session._tag !== 'Ready') {
		return [model, extraCommands];
	}
	return [model, [...extraCommands, persistCommand(model)]];
}

function clearCaches(model: Model): Model {
	return evo(model, {
		previewByRange: () => ({}),
		rangeOverviewByRange: () => ({}),
		rangeStackByPath: () => ({}),
		blameLines: () => initialModel.blameLines,
		blameLoading: () => false,
		entryDiffCountByKey: () => ({}),
		rangeOverviewLoadingKey: () => '',
		entryDiffCountLoadingKey: () => '',
		sidebarPreviewInFlightKey: () => '',
		sidebarPreviewInFlightKeys: () => ({}),
		pendingRangeResolutionKey: () => '',
	});
}

function rangeStackLoadCommand(model: Model): Command.Command<Message> | null {
	if (!model.rangeStackOpen || model.session._tag !== 'Ready') {
		return null;
	}
	const data = getData(model);
	if (!data) {
		return null;
	}
	const overview = getActiveRangeOverviewItems(model);
	const paths = pickRangeStackPaths(
		overview.length ? overview : [{ relativePath: data.relativePath, changeCount: 1, isCurrentFile: true }],
		data.relativePath,
	);
	if (!paths.length) {
		return null;
	}
	return SendHostCommand({
		command: {
			command: 'load-range-stack',
			fromIndex: model.fromIndex,
			toIndex: model.toIndex,
			comparisonSource: getEffectiveComparisonSource(model),
			relativePaths: paths,
		},
	});
}

function applySyncPlan(model: Model): UpdateReturn {
	const commands: Array<Command.Command<Message>> = [];
	const data = getData(model);
	const ready = model.session._tag === 'Ready';
	const visible = getVisibleEntries(model);
	const filteredSidebar = getFilteredSidebarEntries(model);

	const plan = buildTimelineSyncPlan({
		ready,
		data,
		visibleEntries: visible,
		filteredSidebarEntries: filteredSidebar,
		fromIndex: model.fromIndex,
		toIndex: model.toIndex,
		comparisonMode: model.comparisonMode,
		comparisonSource: getEffectiveComparisonSource(model),
		activePreviewKey: getActivePreviewKey(model),
		previewByRange: model.previewByRange as Record<string, DiffPreview>,
		activeRangeOverviewKey: getActiveRangeOverviewKey(model),
		rangeOverviewByRange: model.rangeOverviewByRange as Record<string, Array<RangeOverviewItem>>,
		rangeOverviewLoadingKey: model.rangeOverviewLoadingKey,
		selectedEntryIndexes: getSelectedDiffEntryIndexesSelector(model),
		entryDiffCountByKey: model.entryDiffCountByKey as Record<string, number>,
		entryDiffCountLoadingKey: model.entryDiffCountLoadingKey,
		pendingSnapshotRevisionIndexes: getPendingSnapshotRevisionIndexesSelector(model),
		sidebarPreviewInFlightKeys: model.sidebarPreviewInFlightKeys as Record<string, boolean>,
	});

	let nextModel = model;

	if (plan.normalizedSelection) {
		nextModel = evo(nextModel, {
			fromIndex: () => plan.normalizedSelection!.fromIndex,
			toIndex: () => plan.normalizedSelection!.toIndex,
		});
		return [nextModel, []];
	}

	if (plan.previewRequest) {
		commands.push(
			SendHostCommand({
				command: {
					command: 'select-entry',
					fromIndex: plan.previewRequest.fromIndex,
					toIndex: plan.previewRequest.toIndex,
					comparisonSource: plan.previewRequest.comparisonSource,
				},
			}),
		);
	}

	if (plan.rangeOverviewRequest) {
		nextModel = evo(nextModel, {
			rangeOverviewLoadingKey: () => getActiveRangeOverviewKey(nextModel),
		});
		commands.push(
			SendHostCommand({
				command: {
					command: 'load-range-overview',
					fromIndex: plan.rangeOverviewRequest.fromIndex,
					toIndex: plan.rangeOverviewRequest.toIndex,
					comparisonSource: plan.rangeOverviewRequest.comparisonSource,
					selectedEntryIndexes: plan.rangeOverviewRequest.selectedEntryIndexes,
				},
			}),
		);
	}

	if (plan.entryDiffCountsRequest) {
		const loadingKey = `${plan.entryDiffCountsRequest.comparisonSource}:${plan.entryDiffCountsRequest.entryIndexes.join(',')}`;
		nextModel = evo(nextModel, {
			entryDiffCountLoadingKey: () => loadingKey,
		});
		commands.push(
			SendHostCommand({
				command: {
					command: 'load-entry-diff-counts',
					entryIndexes: plan.entryDiffCountsRequest.entryIndexes,
					comparisonSource: plan.entryDiffCountsRequest.comparisonSource,
				},
			}),
		);
	}

	if (plan.snapshotHydrationRequest) {
		commands.push(
			SendHostCommand({
				command: {
					command: 'hydrate-snapshot-entries',
					revisionIndexes: plan.snapshotHydrationRequest.revisionIndexes,
				},
			}),
		);
	}

	if (plan.sidebarPreviewRequests?.length) {
		const nextInFlight = { ...(nextModel.sidebarPreviewInFlightKeys as Record<string, boolean>) };
		for (const request of plan.sidebarPreviewRequests) {
			nextInFlight[request.key] = true;
			commands.push(
				SendHostCommand({
					command: {
						command: 'select-entry',
						fromIndex: request.fromIndex,
						toIndex: request.toIndex,
						comparisonSource: request.comparisonSource,
					},
				}),
			);
		}
		nextModel = evo(nextModel, {
			sidebarPreviewInFlightKeys: () => nextInFlight,
			sidebarPreviewInFlightKey: () => plan.sidebarPreviewRequests![0]!.key,
		});
	}

	if (nextModel.rangeStackOpen && Object.keys(nextModel.rangeStackByPath).length === 0) {
		const stackCommand = rangeStackLoadCommand(nextModel);
		if (stackCommand) {
			commands.push(stackCommand);
		}
	}

	if (
		(nextModel.blameOverlayOpen || nextModel.heatmapOpen) &&
		!(Array.isArray(nextModel.blameLines) && nextModel.blameLines.length > 0) &&
		!nextModel.blameLoading
	) {
		nextModel = evo(nextModel, { blameLoading: () => true });
		commands.push(
			SendHostCommand({
				command: {
					command: 'load-diff-blame',
					fromIndex: nextModel.fromIndex,
					toIndex: nextModel.toIndex,
					comparisonSource: getEffectiveComparisonSource(nextModel),
				},
			}),
		);
	}

	return [nextModel, commands];
}

function afterMutate(model: Model, extraCommands: ReadonlyArray<Command.Command<Message>> = []): UpdateReturn {
	const withDrafts = syncRevisionDrafts(model);
	const [syncedModel, syncCommands] = applySyncPlan(withDrafts);
	if (syncedModel !== withDrafts && syncCommands.length === 0) {
		// Normalized selection changed; run sync again once.
		const [next, cmds] = applySyncPlan(syncRevisionDrafts(syncedModel));
		return [next, [...extraCommands, ...cmds]];
	}
	return [syncRevisionDrafts(syncedModel), [...extraCommands, ...syncCommands]];
}

function stepSession(model: Model, message: Parameters<typeof sessionMachine.transition>[1]): Model {
	const [nextSession] = sessionMachine.transition(model.session, message);
	return evo(model, { session: () => nextSession });
}

function stepSelection(model: Model, message: Parameters<typeof selectionMachine.transition>[1]): Model {
	const [nextSelection] = selectionMachine.transition(model.selection, message);
	return evo(model, { selection: () => nextSelection });
}

function stepOverlay(model: Model, message: Parameters<typeof overlayMachine.transition>[1]): Model {
	const [nextOverlay] = overlayMachine.transition(model.overlay, message);
	const flags = overlayFlagsFromState(nextOverlay);
	let next = evo(model, {
		overlay: () => nextOverlay,
		hotkeysOpen: () => flags.hotkeysOpen,
		viewMenuOpen: () => flags.viewMenuOpen,
		actionsMenuOpen: () => flags.actionsMenuOpen,
	});
	const dismissCombobox = nextOverlay._tag !== 'Closed' || message._tag === 'ClosedOverlays';
	if (dismissCombobox && model.openComboboxId._tag === 'Some') {
		next = syncRevisionDrafts(evo(next, { openComboboxId: () => Option.none() }));
	}
	return next;
}

function handleTrackAnchorClick(model: Model, entryIndex: number): UpdateReturn {
	if (model.comparisonMode === 'step') {
		const entries = getVisibleEntries(model);
		const visibleIndex = entries.findIndex((entry) => entry.index === entryIndex);
		if (visibleIndex <= 0) {
			return [model, []];
		}
		const next = stepSelection(
			evo(stepOverlay(model, ClosedOverlays()), {
				fromIndex: () => entries[visibleIndex - 1].index,
				toIndex: () => entries[visibleIndex].index,
				maybeHoveredSelectionIndex: () => Option.none(),
			}),
			CancelledSelection(),
		);
		return afterMutate(next, [persistCommand(next)]);
	}

	const pending = model.selection._tag === 'PendingAnchor' ? model.selection.entryIndex : null;
	if (pending === null) {
		const next = stepSelection(
			evo(stepOverlay(model, ClosedOverlays()), {
				maybeHoveredSelectionIndex: () => Option.none(),
			}),
			SelectionClickedEntry({ entryIndex }),
		);
		return [next, []];
	}

	if (pending === entryIndex) {
		return [stepSelection(model, CancelledSelection()), []];
	}

	const next = stepSelection(
		evo(stepOverlay(model, ClosedOverlays()), {
			fromIndex: () => Math.min(pending, entryIndex),
			toIndex: () => Math.max(pending, entryIndex),
			maybeHoveredSelectionIndex: () => Option.none(),
		}),
		CommittedSelection(),
	);
	return afterMutate(next, [persistCommand(next)]);
}

function handleStep(model: Model, amount: number): UpdateReturn {
	const entries = getVisibleEntries(model);
	if (!entries.length) {
		return [model, []];
	}

	let next = stepSelection(model, CancelledSelection());
	if (next.comparisonMode === 'step') {
		const [fromIndex, toIndex] = shiftStepSelection(entries, next.toIndex, amount);
		next = evo(next, {
			fromIndex: () => fromIndex,
			toIndex: () => toIndex,
			maybeHoveredSelectionIndex: () => Option.none(),
		});
	} else {
		const [fromIndex, toIndex] = shiftRangeSelection(entries, next.fromIndex, next.toIndex, amount);
		next = evo(next, {
			fromIndex: () => fromIndex,
			toIndex: () => toIndex,
			maybeHoveredSelectionIndex: () => Option.none(),
		});
	}
	return afterMutate(next, [persistCommand(next)]);
}

function handleDock(model: Model, edge: 'start' | 'end'): UpdateReturn {
	const entries = getVisibleEntries(model);
	if (entries.length < 2) {
		return [model, []];
	}

	let next = stepSelection(model, CancelledSelection());
	if (next.comparisonMode === 'step') {
		const nextToVisibleIndex = edge === 'start' ? 1 : entries.length - 1;
		next = evo(next, {
			fromIndex: () => entries[nextToVisibleIndex - 1].index,
			toIndex: () => entries[nextToVisibleIndex].index,
			maybeHoveredSelectionIndex: () => Option.none(),
		});
	} else {
		const [fromIndex, toIndex] = dockRangeSelection(entries, next.fromIndex, next.toIndex, edge);
		next = evo(next, {
			fromIndex: () => fromIndex,
			toIndex: () => toIndex,
			maybeHoveredSelectionIndex: () => Option.none(),
		});
	}
	return afterMutate(next, [persistCommand(next)]);
}

function getTrackWidth(): number {
	const track = typeof document === 'undefined' ? null : document.getElementById('track');
	return Math.max(1, track?.getBoundingClientRect().width || 1);
}

function applyRangeShift(model: Model, drag: typeof DragRange.Type, clientX: number): UpdateReturn {
	const entries = getVisibleEntries(model);
	if (!entries.length) {
		return [model, []];
	}
	const trackWidth = getTrackWidth();
	const denominator = Math.max(1, entries.length - 1);
	const width = Math.max(1, drag.startToVisibleIndex - drag.startFromVisibleIndex);
	const deltaRatio = (clientX - drag.startClientX) / trackWidth;
	const deltaSteps = Math.round(deltaRatio * denominator);
	const nextFromVisibleIndex = Math.min(
		Math.max(drag.startFromVisibleIndex + deltaSteps, 0),
		Math.max(0, entries.length - 1 - width),
	);
	const nextToVisibleIndex = nextFromVisibleIndex + width;
	const next = evo(model, {
		fromIndex: () => entries[nextFromVisibleIndex].index,
		toIndex: () => entries[nextToVisibleIndex].index,
	});
	return [next, []];
}

function applyMarkerShift(model: Model, side: 'from' | 'to', clientX: number): UpdateReturn {
	const entries = getVisibleEntries(model);
	if (!entries.length) {
		return [model, []];
	}
	const nextVisibleIndex = getVisibleIndexFromClientX(entries, clientX);
	if (nextVisibleIndex < 0) {
		return [model, []];
	}
	const fromVisibleIndex = getVisibleIndexForAbsoluteIndex(entries, model.fromIndex);
	const toVisibleIndex = getVisibleIndexForAbsoluteIndex(entries, model.toIndex);
	if (fromVisibleIndex < 0 || toVisibleIndex < 0) {
		return [model, []];
	}

	let nextFrom = model.fromIndex;
	let nextTo = model.toIndex;

	if (side === 'from') {
		const clampedVisibleIndex = Math.min(nextVisibleIndex, Math.max(0, toVisibleIndex - 1));
		nextFrom = entries[clampedVisibleIndex].index;
	} else {
		const clampedVisibleIndex = Math.max(nextVisibleIndex, Math.min(entries.length - 1, fromVisibleIndex + 1));
		nextTo = entries[clampedVisibleIndex].index;
	}

	// Ensure minimum width of 1 visible step.
	let nextFromVisible = entries.findIndex((entry) => entry.index === nextFrom);
	let nextToVisible = entries.findIndex((entry) => entry.index === nextTo);
	if (nextFromVisible === nextToVisible && entries.length >= 2) {
		if (side === 'from') {
			nextFromVisible = Math.max(0, nextToVisible - 1);
		} else {
			nextToVisible = Math.min(entries.length - 1, nextFromVisible + 1);
		}
		if (nextFromVisible === nextToVisible) {
			nextFromVisible = Math.max(0, nextToVisible - 1);
			nextToVisible = Math.min(entries.length - 1, nextFromVisible + 1);
		}
		nextFrom = entries[nextFromVisible].index;
		nextTo = entries[nextToVisible].index;
	}

	const next = evo(model, {
		fromIndex: () => nextFrom,
		toIndex: () => nextTo,
	});
	return [next, []];
}

function handlePressedTrackAnchor(
	model: Model,
	entryIndex: number,
	clientX: number,
	clientY: number,
	button: number,
): UpdateReturn {
	if (button !== 0 || !getVisibleEntries(model).length) {
		return [model, []];
	}
	const next = evo(model, {
		dragState: (): DragState => DragAnchorIntent({ entryIndex, startClientX: clientX, startClientY: clientY }),
	});
	return [next, []];
}

function handlePressedRangeFill(model: Model, clientX: number, button: number): UpdateReturn {
	if (button !== 0) {
		return [model, []];
	}
	return beginRangeDrag(model, clientX);
}

function handlePressedMarker(model: Model, side: 'from' | 'to', clientX: number, button: number): UpdateReturn {
	if (button !== 0) {
		return [model, []];
	}
	let next = stepSelection(
		evo(model, {
			comparisonMode: () => 'range' as ComparisonMode,
			maybeHoveredSelectionIndex: () => Option.none(),
			dragState: (): DragState => DragMarker({ side }),
		}),
		CancelledSelection(),
	);
	const [applied] = applyMarkerShift(next, side, clientX);
	next = applied;
	return [next, []];
}

function handlePressedTrack(model: Model, clientX: number, button: number): UpdateReturn {
	if (button !== 0 || model.dragState._tag !== 'DragIdle') {
		return [model, []];
	}
	const entries = getVisibleEntries(model);
	if (!entries.length) {
		return [model, []];
	}
	const visibleIndex = getVisibleIndexFromClientX(entries, clientX);
	if (visibleIndex < 0) {
		return [model, []];
	}
	const fromVisibleIndex = getVisibleIndexForAbsoluteIndex(entries, model.fromIndex);
	const toVisibleIndex = getVisibleIndexForAbsoluteIndex(entries, model.toIndex);
	if (fromVisibleIndex < 0 || toVisibleIndex < 0) {
		return [model, []];
	}
	if (
		visibleIndex < Math.min(fromVisibleIndex, toVisibleIndex) ||
		visibleIndex > Math.max(fromVisibleIndex, toVisibleIndex)
	) {
		return [model, []];
	}
	return beginRangeDrag(model, clientX);
}

function beginRangeDrag(model: Model, clientX: number): UpdateReturn {
	const entries = getVisibleEntries(model);
	if (!entries.length) {
		return [model, []];
	}
	const startFromVisibleIndex = getVisibleIndexForAbsoluteIndex(entries, model.fromIndex);
	const startToVisibleIndex = getVisibleIndexForAbsoluteIndex(entries, model.toIndex);
	if (startFromVisibleIndex < 0 || startToVisibleIndex < 0) {
		return [model, []];
	}
	const dragRange = DragRange({
		startClientX: clientX,
		startFromVisibleIndex,
		startToVisibleIndex,
	});
	const nextSelection = stepSelection(
		evo(model, {
			maybeHoveredSelectionIndex: () => Option.none(),
			dragState: (): DragState => dragRange,
		}),
		CancelledSelection(),
	);
	return [nextSelection, []];
}

function handlePressedSidebarResize(model: Model, clientX: number, clientY: number, button: number): UpdateReturn {
	if (button !== 0) {
		return [model, []];
	}
	const responsive = isResponsiveLayout();
	return [
		evo(model, {
			dragState: (): DragState =>
				DragSidebarResize({
					startClientX: clientX,
					startClientY: clientY,
					startWidth: model.sidebarWidth,
					startHeight: model.responsiveSidebarHeight,
					wasCollapsed: model.sidebarCollapsed,
					responsive,
				}),
		}),
		[],
	];
}

function handlePressedTimelineResize(model: Model, clientY: number, button: number): UpdateReturn {
	if (button !== 0) {
		return [model, []];
	}
	const startHeight = model.timelinePaneCollapsed ? TIMELINE_COLLAPSED_HEIGHT : model.timelinePaneHeight;
	return [
		evo(model, {
			timelinePaneCollapsed: () => false as boolean,
			dragState: (): DragState =>
				DragTimelineResize({
					startClientY: clientY,
					startHeight,
				}),
		}),
		[],
	];
}

function applySidebarResize(
	model: Model,
	drag: typeof DragSidebarResize.Type,
	clientX: number,
	clientY: number,
): UpdateReturn {
	if (drag.responsive) {
		const delta = clientY - drag.startClientY;
		if (drag.startHeight + delta < RESPONSIVE_SIDEBAR_COLLAPSE_THRESHOLD) {
			return [evo(model, { sidebarCollapsed: () => true as boolean }), []];
		}
		return [
			evo(model, {
				sidebarCollapsed: () => false as boolean,
				responsiveSidebarHeight: () => clampResponsiveSidebarHeight(drag.startHeight + delta),
			}),
			[],
		];
	}

	const delta = clientX - drag.startClientX;
	if (drag.wasCollapsed) {
		if (delta < SIDEBAR_REOPEN_THRESHOLD) {
			return [model, []];
		}
		return [
			evo(model, {
				sidebarCollapsed: () => false as boolean,
				sidebarWidth: () => clampSidebarWidth(SIDEBAR_MIN_WIDTH + (delta - SIDEBAR_REOPEN_THRESHOLD)),
			}),
			[],
		];
	}

	if (drag.startWidth + delta < SIDEBAR_COLLAPSE_THRESHOLD) {
		return [
			evo(model, {
				sidebarCollapsed: () => true as boolean,
				dragState: (): DragState => DragIdle(),
			}),
			[],
		];
	}

	return [
		evo(model, {
			sidebarCollapsed: () => false as boolean,
			sidebarWidth: () => clampSidebarWidth(drag.startWidth + delta),
		}),
		[],
	];
}

function applyTimelineResize(model: Model, drag: typeof DragTimelineResize.Type, clientY: number): UpdateReturn {
	const delta = clientY - drag.startClientY;
	return [
		evo(model, {
			timelinePaneHeight: () => clampTimelinePaneHeight(drag.startHeight + delta),
			timelinePaneCollapsed: () => false as boolean,
		}),
		[],
	];
}

function handlePointerMovedDuringDrag(model: Model, clientX: number, clientY: number): UpdateReturn {
	return M.value(model.dragState).pipe(
		M.withReturnType<UpdateReturn>(),
		M.tagsExhaustive({
			DragIdle: () => [model, []],
			DragAnchorIntent: (intent) => {
				const dx = Math.abs(clientX - intent.startClientX);
				const dy = Math.abs(clientY - intent.startClientY);
				if (Math.max(dx, dy) < TRACK_ANCHOR_DRAG_START_DISTANCE) {
					return [model, []];
				}
				const entries = getVisibleEntries(model);
				if (!entries.length) {
					return [evo(model, { dragState: (): DragState => DragIdle() }), []];
				}
				const startFromVisibleIndex = getVisibleIndexForAbsoluteIndex(entries, model.fromIndex);
				const startToVisibleIndex = getVisibleIndexForAbsoluteIndex(entries, model.toIndex);
				if (startFromVisibleIndex < 0 || startToVisibleIndex < 0) {
					return [evo(model, { dragState: (): DragState => DragIdle() }), []];
				}
				const dragRange = DragRange({
					startClientX: intent.startClientX,
					startFromVisibleIndex,
					startToVisibleIndex,
				});
				const promoted = stepSelection(
					evo(model, {
						maybeHoveredSelectionIndex: () => Option.none(),
						dragState: (): DragState => dragRange,
						suppressAnchorClick: () => true,
					}),
					CancelledSelection(),
				);
				return applyRangeShift(promoted, dragRange, clientX);
			},
			DragRange: (drag) => applyRangeShift(model, drag, clientX),
			DragMarker: (drag) => applyMarkerShift(model, drag.side, clientX),
			DragSidebarResize: (drag) => applySidebarResize(model, drag, clientX, clientY),
			DragTimelineResize: (drag) => applyTimelineResize(model, drag, clientY),
		}),
	);
}

function handleReleasedPointerDuringDrag(model: Model): UpdateReturn {
	if (model.dragState._tag === 'DragIdle') {
		return [model, []];
	}
	const wasLayoutResize =
		model.dragState._tag === 'DragRange' ||
		model.dragState._tag === 'DragMarker' ||
		model.dragState._tag === 'DragSidebarResize' ||
		model.dragState._tag === 'DragTimelineResize';
	const next = evo(model, {
		dragState: (): DragState => DragIdle(),
	});
	if (wasLayoutResize) {
		return afterMutate(next, [persistCommand(next)]);
	}
	return [next, []];
}

function handleAdjustBoundary(model: Model, side: 'from' | 'to', amount: number): UpdateReturn {
	if (model.comparisonMode === 'step') {
		return [model, []];
	}
	const entries = getVisibleEntries(model);
	const [fromIndex, toIndex] = adjustRangeBoundary(entries, model.fromIndex, model.toIndex, side, amount);
	const next = stepSelection(
		evo(model, {
			fromIndex: () => fromIndex,
			toIndex: () => toIndex,
			maybeHoveredSelectionIndex: () => Option.none(),
		}),
		CancelledSelection(),
	);
	return afterMutate(next, [persistCommand(next)]);
}

function handleSetComparisonMode(model: Model, value: ComparisonMode): UpdateReturn {
	if (value === model.comparisonMode) {
		return [model, []];
	}
	let next = model;
	if (value === 'step') {
		const [fromIndex, toIndex] = alignStepSelection(getVisibleEntries(model), model.toIndex);
		next = evo(next, {
			comparisonMode: () => value,
			fromIndex: () => fromIndex,
			toIndex: () => toIndex,
			pendingRangeResolutionKey: () => '',
			maybeHoveredSelectionIndex: () => Option.none(),
		});
	} else {
		next = evo(next, {
			comparisonMode: () => value,
			pendingRangeResolutionKey: () => '',
			maybeHoveredSelectionIndex: () => Option.none(),
		});
	}
	next = stepSelection(next, CancelledSelection());
	return afterMutate(next, [persistCommand(next)]);
}

function handleSetComparisonSource(model: Model, value: ComparisonSource): UpdateReturn {
	if (getData(model)?.backend !== 'jj' || value === model.comparisonSource) {
		return [model, []];
	}
	const data = getData(model);
	const previousEntries = filterEntries(
		getEntriesForSource(data, model.comparisonSource),
		data,
		model.preset,
		model.showIntermediateRevisions,
	);
	const nextVisibleEntries = filterEntries(
		getEntriesForSource(data, value),
		data,
		model.preset,
		model.showIntermediateRevisions,
	);
	const mapped = mapSelectionAcrossSources({
		previousEntries,
		nextEntries: nextVisibleEntries,
		fromIndex: model.fromIndex,
		toIndex: model.toIndex,
		comparisonMode: model.comparisonMode,
	});
	let next = evo(clearCaches(model), {
		comparisonSource: () => value,
		fromIndex: () => mapped.fromIndex,
		toIndex: () => mapped.toIndex,
		maybeHoveredSelectionIndex: () => Option.none(),
		timeLapsePlaying: () => false as boolean,
	});
	next = stepOverlay(next, ClosedOverlays());
	next = stepSelection(next, CancelledSelection());
	return afterMutate(next, [persistCommand(next)]);
}

function handleEvologEntryClick(model: Model, entryIndex: number): UpdateReturn {
	if (getData(model)?.backend !== 'jj') {
		return [model, []];
	}
	const snapshotEntries = getEntriesForSource(getData(model), 'snapshot');
	const target = snapshotEntries.find((entry) => entry.index === entryIndex);
	if (!target) {
		return [model, []];
	}
	const fromIndex = Math.max(0, entryIndex - 1);
	let next = clearCaches(model);
	next = evo(next, {
		comparisonSource: () => 'snapshot' as ComparisonSource,
		fromIndex: () => fromIndex,
		toIndex: () => entryIndex,
		maybeHoveredSelectionIndex: () => Option.none(),
	});
	next = stepSelection(next, CancelledSelection());
	return afterMutate(next, [persistCommand(next), ScrollToEntry({ entryIndex })]);
}

function handleFileOpLogEntryClick(model: Model, operationId: string): UpdateReturn {
	if (getData(model)?.backend !== 'jj') {
		return [model, []];
	}
	const ops = Array.isArray(model.fileOpLogEntries)
		? (model.fileOpLogEntries as Array<{ operationId: string; entryIndex?: number }>)
		: [];
	const op = ops.find((entry) => entry.operationId === operationId);
	const snapshotEntries = getEntriesForSource(getData(model), 'snapshot');
	const revisionEntries = getEntriesForSource(getData(model), 'revision');
	const byIndex =
		typeof op?.entryIndex === 'number'
			? snapshotEntries.find((entry) => entry.index === op.entryIndex) ||
				revisionEntries.find((entry) => entry.index === op.entryIndex)
			: undefined;
	const byOpId =
		byIndex ||
		snapshotEntries.find((entry) => (entry.operationId || '').startsWith(operationId) || operationId.startsWith(entry.operationId || '')) ||
		revisionEntries.find((entry) => (entry.operationId || '').startsWith(operationId) || operationId.startsWith(entry.operationId || ''));
	if (!byOpId || typeof byOpId.index !== 'number') {
		return [model, []];
	}
	const useSnapshot = snapshotEntries.some((entry) => entry.index === byOpId.index);
	if (useSnapshot) {
		return handleEvologEntryClick(model, byOpId.index);
	}
	const entryIndex = byOpId.index;
	const fromIndex = Math.max(0, entryIndex - 1);
	let next = clearCaches(model);
	next = evo(next, {
		comparisonSource: () => 'revision' as ComparisonSource,
		fromIndex: () => fromIndex,
		toIndex: () => entryIndex,
		maybeHoveredSelectionIndex: () => Option.none(),
	});
	next = stepSelection(next, CancelledSelection());
	return afterMutate(next, [persistCommand(next), ScrollToEntry({ entryIndex })]);
}

function handleSetPreset(model: Model, value: TimelinePreset): UpdateReturn {
	if (!getData(model) || value === model.preset) {
		let next = evo(model, {
			preset: () => value,
			maybeHoveredSelectionIndex: () => Option.none(),
			pendingRangeResolutionKey: () => '',
		});
		next = stepSelection(next, CancelledSelection());
		return afterMutate(next, [persistCommand(next)]);
	}

	const data = getData(model);
	const nextVisibleEntries = filterEntries(
		getEntriesForSource(data, getEffectiveComparisonSource(model)),
		data,
		value,
		model.showIntermediateRevisions,
	);
	const { fromIndex, toIndex } = getDefaultSelection(nextVisibleEntries);
	let next = evo(model, {
		preset: () => value,
		fromIndex: () => fromIndex,
		toIndex: () => toIndex,
		maybeHoveredSelectionIndex: () => Option.none(),
		pendingRangeResolutionKey: () => '',
	});
	next = stepSelection(next, CancelledSelection());
	return afterMutate(next, [persistCommand(next)]);
}

function handleToggleIntermediate(model: Model): UpdateReturn {
	const data = getData(model);
	if (!data?.hasIntermediateRevisions) {
		return [model, []];
	}
	let next = evo(model, {
		showIntermediateRevisions: (value) => !value,
		maybeHoveredSelectionIndex: () => Option.none(),
		pendingRangeResolutionKey: () => '',
	});
	next = stepSelection(next, CancelledSelection());
	return afterMutate(next, [persistCommand(next)]);
}

function syncRevisionDrafts(model: Model): Model {
	const from = getVisibleEntries(model).find((entry) => entry.index === model.fromIndex);
	const to = getVisibleEntries(model).find((entry) => entry.index === model.toIndex);
	const openId = model.openComboboxId._tag === 'Some' ? model.openComboboxId.value : null;
	return evo(model, {
		fromRevisionDraft: (current) => (openId === 'fromRevisionInput' ? current : from?.shortRevision || ''),
		toRevisionDraft: (current) => (openId === 'toRevisionInput' ? current : to?.shortRevision || ''),
	});
}

function handleSubmitRevision(model: Model, side: 'from' | 'to', value: string): UpdateReturn {
	const match = findRevisionEntryMatch(getVisibleEntries(model), value);
	if (!match) {
		return [model, []];
	}
	let next = stepSelection(model, CancelledSelection());
	if (next.comparisonMode === 'step') {
		const entries = getVisibleEntries(next);
		const visibleIndex = entries.findIndex((entry) => entry.index === match.index);
		if (visibleIndex <= 0) {
			return [next, []];
		}
		next = evo(next, {
			fromIndex: () => entries[visibleIndex - 1].index,
			toIndex: () => entries[visibleIndex].index,
			maybeHoveredSelectionIndex: () => Option.none(),
			openComboboxId: () => Option.none(),
		});
	} else if (side === 'from') {
		next = evo(next, {
			fromIndex: () => Math.min(match.index, next.toIndex),
			maybeHoveredSelectionIndex: () => Option.none(),
			openComboboxId: () => Option.none(),
		});
	} else {
		next = evo(next, {
			toIndex: () => Math.max(match.index, next.fromIndex),
			maybeHoveredSelectionIndex: () => Option.none(),
			openComboboxId: () => Option.none(),
		});
	}
	next = syncRevisionDrafts(next);
	return afterMutate(next, [persistCommand(next)]);
}

function handleOpenedCombobox(model: Model, id: string): UpdateReturn {
	return [evo(stepOverlay(model, ClosedOverlays()), { openComboboxId: () => Option.some(id) }), []];
}

function handleClosedCombobox(model: Model, id: string): UpdateReturn {
	if (model.openComboboxId._tag !== 'Some' || model.openComboboxId.value !== id) {
		return [model, []];
	}
	return [syncRevisionDrafts(evo(model, { openComboboxId: () => Option.none() })), []];
}

function handleUpdatedComboboxDraft(model: Model, id: string, value: string): UpdateReturn {
	const base = stepOverlay(model, ClosedOverlays());
	if (id === 'fromRevisionInput') {
		return [evo(base, { fromRevisionDraft: () => value, openComboboxId: () => Option.some(id) }), []];
	}
	if (id === 'toRevisionInput') {
		return [evo(base, { toRevisionDraft: () => value, openComboboxId: () => Option.some(id) }), []];
	}
	if (id === 'fileSwitcher') {
		return [evo(base, { fileInputValue: () => value, openComboboxId: () => Option.some(id) }), []];
	}
	return [model, []];
}

function handleSubmitFile(model: Model, rawValue: string): UpdateReturn {
	const relativePath = rawValue.trim();
	const data = getData(model);
	if (!data || !relativePath || relativePath === data.relativePath) {
		return [model, []];
	}
	const filesLoaded = data.workspaceFilesLoaded !== false;
	if (filesLoaded && !data.workspaceFiles.includes(relativePath)) {
		return [model, []];
	}

	const cache = rememberFileSession(model.fileSessionByPath as Record<string, FileSessionSnapshot>, model);
	const cached = readCachedFileSession(cache, relativePath);
	const hostCommand = SendHostCommand({ command: { command: 'switch-file', relativePath } });

	if (cached) {
		let next = evo(model, {
			fileSessionByPath: () => cache,
			data: () => cached.data as never,
			previewByRange: () => cached.previewByRange,
			rangeOverviewByRange: () => cached.rangeOverviewByRange,
			entryDiffCountByKey: () => cached.entryDiffCountByKey,
			fromIndex: () => cached.fromIndex,
			toIndex: () => cached.toIndex,
			comparisonMode: () => cached.comparisonMode,
			comparisonSource: () => cached.comparisonSource,
			layoutMode: () => cached.layoutMode,
			contentMode: () => cached.contentMode,
			preset: () => cached.preset,
			showIntermediateRevisions: () => cached.showIntermediateRevisions,
			customRevset: () => cached.customRevset,
			fileInputValue: () => relativePath,
			oldestFirst: () => cached.oldestFirst,
			maybeHoveredSelectionIndex: () => Option.none(),
			rangeStackOpen: () => false as boolean,
			rangeStackByPath: () => ({}),
			blameOverlayOpen: () => false as boolean,
			heatmapOpen: () => false as boolean,
			blameLines: () => initialModel.blameLines,
			blameLoading: () => false as boolean,
			fileOpLogEntries: () => initialModel.fileOpLogEntries,
			sidebarPreviewInFlightKey: () => '',
			sidebarPreviewInFlightKeys: () => ({}),
			sessionKey: (current) => current + 1,
		}) as Model;
		next = stepOverlay(next, ClosedOverlays());
		next = stepSelection(next, CancelledSelection());
		next = stepSession(next, ReceivedTimelineData());
		next = syncRevisionDrafts(next);
		return afterMutate(next, [hostCommand]);
	}

	const next = stepSelection(
		evo(stepOverlay(model, ClosedOverlays()), {
			fileSessionByPath: () => cache,
			fileInputValue: () => relativePath,
			maybeHoveredSelectionIndex: () => Option.none(),
			sessionKey: (current) => current + 1,
		}),
		CancelledSelection(),
	);
	const sessionModel = stepSession(next, SwitchedFile());
	return [sessionModel, [hostCommand]];
}

function handleRefresh(model: Model): UpdateReturn {
	const next = stepSelection(
		evo(stepOverlay(model, ClosedOverlays()), {
			maybeHoveredSelectionIndex: () => Option.none(),
			sessionKey: (value) => value + 1,
		}),
		CancelledSelection(),
	);
	const sessionModel = stepSession(next, RefreshedSession());
	return [sessionModel, [SendHostCommand({ command: { command: 'refresh' } })]];
}

function handleReset(model: Model): UpdateReturn {
	const data = getData(model);
	if (!data) {
		return [model, []];
	}
	const nextSourceEntries = filterEntries(getEntriesForSource(data, 'revision'), data, 'year', false);
	const { fromIndex, toIndex } = getDefaultSelection(nextSourceEntries);
	let next = evo(clearCaches(model), {
		fromIndex: () => fromIndex,
		toIndex: () => toIndex,
		comparisonMode: () => 'range' as ComparisonMode,
		comparisonSource: () => 'revision' as ComparisonSource,
		layoutMode: () => 'split' as 'split' | 'unified',
		contentMode: () => 'diffs' as 'diffs' | 'full',
		preset: () => 'year' as TimelinePreset,
		showIntermediateRevisions: () => false as boolean,
		customRevset: () => '',
		rangeStackOpen: () => false as boolean,
		rangeStackByPath: () => ({}),
		blameOverlayOpen: () => false as boolean,
		heatmapOpen: () => false as boolean,
		blameLines: () => initialModel.blameLines,
		blameLoading: () => false as boolean,
		fileOpLogEntries: () => initialModel.fileOpLogEntries,
		historySearchQuery: () => '',
		historySearchLoading: () => false as boolean,
		historySearchResult: () => null,
		timeLapsePlaying: () => false as boolean,
		sidebarSearchQuery: () => '',
		sidebarContentNeedle: () => '',
		sidebarContentMatchIndexes: () => [],
		sidebarContentLoading: () => false as boolean,
		sidebarWidth: () => clampSidebarWidth(280),
		timelinePaneHeight: () => 220,
		timelinePaneCollapsed: () => false as boolean,
		themePreference: () => 'auto' as const,
		responsiveSidebarHeight: () => 248,
		sidebarCollapsed: () => false as boolean,
		diffFocusMode: () => false as boolean,
		oldestFirst: () => false as boolean,
		maybeHoveredSelectionIndex: () => Option.none(),
	}) as Model;
	next = stepOverlay(next, ClosedOverlays());
	next = stepSelection(next, CancelledSelection());
	return afterMutate(next, [persistCommand(next)]);
}

function handleGotHostMessage(model: Model, payload: unknown): UpdateReturn {
	const message = payload as TimelineInboundMessage;
	if (!message || typeof message !== 'object' || !('type' in message)) {
		return [model, []];
	}

	return M.value(message.type).pipe(
		M.withReturnType<UpdateReturn>(),
		M.when('timeline-data', () =>
			handleTimelineDataMessage(model, message as Extract<TimelineInboundMessage, { type: 'timeline-data' }>),
		),
		M.when('diff-preview', () =>
			handleDiffPreviewMessage(model, message as Extract<TimelineInboundMessage, { type: 'diff-preview' }>),
		),
		M.when('snapshot-entries', () =>
			handleSnapshotEntriesMessage(model, message as Extract<TimelineInboundMessage, { type: 'snapshot-entries' }>),
		),
		M.when('workspace-files', () =>
			handleWorkspaceFilesMessage(model, message as Extract<TimelineInboundMessage, { type: 'workspace-files' }>),
		),
		M.when('entries-updated', () =>
			handleEntriesUpdatedMessage(model, message as Extract<TimelineInboundMessage, { type: 'entries-updated' }>),
		),
		M.when('range-overview', () =>
			handleRangeOverviewMessage(model, message as Extract<TimelineInboundMessage, { type: 'range-overview' }>),
		),
		M.when('range-stack-previews', () =>
			handleRangeStackPreviewsMessage(
				model,
				message as Extract<TimelineInboundMessage, { type: 'range-stack-previews' }>,
			),
		),
		M.when('diff-blame', () =>
			handleDiffBlameMessage(model, message as Extract<TimelineInboundMessage, { type: 'diff-blame' }>),
		),
		M.when('file-oplog', () =>
			handleFileOpLogMessage(model, message as Extract<TimelineInboundMessage, { type: 'file-oplog' }>),
		),
		M.when('history-search', () =>
			handleHistorySearchMessage(model, message as Extract<TimelineInboundMessage, { type: 'history-search' }>),
		),
		M.when('entry-diff-counts', () =>
			handleEntryDiffCountsMessage(model, message as Extract<TimelineInboundMessage, { type: 'entry-diff-counts' }>),
		),
		M.when('resolved-range', () =>
			handleResolvedRangeMessage(model, message as Extract<TimelineInboundMessage, { type: 'resolved-range' }>),
		),
		M.when('debug-set-layout-mode', () => {
			const layoutMode = Reflect.get(message, 'layoutMode') === 'unified' ? ('unified' as const) : ('split' as const);
			return withPersist(evo(model, { layoutMode: () => layoutMode }));
		}),
		M.orElse(() => [model, []]),
	);
}

function handleTimelineDataMessage(
	model: Model,
	message: Extract<TimelineInboundMessage, { type: 'timeline-data' }>,
): UpdateReturn {
	const data = message.payload;
	const preferences = data.preferences || {};
	const comparisonSource = data.backend === 'jj' ? preferences.comparisonSource || 'revision' : 'revision';
	const showIntermediateRevisions = preferences.showIntermediateRevisions === true;
	const preset = preferences.preset || 'year';
	const visibleEntries = filterEntries(
		getEntriesForSource(data, comparisonSource),
		data,
		preset,
		showIntermediateRevisions,
	);
	const cache = model.fileSessionByPath as Record<string, FileSessionSnapshot>;
	const cached = readCachedFileSession(cache, data.relativePath);
	const samePath = getData(model)?.relativePath === data.relativePath;
	const defaultSelection = getDefaultSelection(visibleEntries);
	const fromIndex =
		samePath && visibleEntries.some((entry) => entry.index === model.fromIndex)
			? model.fromIndex
			: cached && visibleEntries.some((entry) => entry.index === cached.fromIndex)
				? cached.fromIndex
				: defaultSelection.fromIndex;
	const toIndex =
		samePath && visibleEntries.some((entry) => entry.index === model.toIndex)
			? model.toIndex
			: cached && visibleEntries.some((entry) => entry.index === cached.toIndex)
				? cached.toIndex
				: defaultSelection.toIndex;

	const restoredPreviews = mergePreviewCaches(
		cached?.previewByRange,
		samePath ? (model.previewByRange as Record<string, DiffPreview>) : undefined,
	);
	const restoredOverviews = {
		...(cached?.rangeOverviewByRange || {}),
		...(samePath ? (model.rangeOverviewByRange as Record<string, Array<RangeOverviewItem>>) : {}),
	};
	const restoredDiffCounts = {
		...(cached?.entryDiffCountByKey || {}),
		...(samePath ? (model.entryDiffCountByKey as Record<string, number>) : {}),
	};

	let next: Model = {
		...clearCaches(model),
		data,
		previewByRange: restoredPreviews,
		rangeOverviewByRange: restoredOverviews,
		entryDiffCountByKey: restoredDiffCounts,
		sidebarWidth: clampSidebarWidth(preferences.sidebarWidth || 280),
		timelinePaneHeight: preferences.timelinePaneHeight || 220,
		timelinePaneCollapsed: preferences.timelinePaneCollapsed === true,
		themePreference:
			preferences.themePreference === 'light' || preferences.themePreference === 'dark'
				? preferences.themePreference
				: 'auto',
		heatmapOpen: preferences.heatmapOpen === true,
		responsiveSidebarHeight: clampResponsiveSidebarHeight(model.responsiveSidebarHeight || 248),
		layoutMode: preferences.layoutMode || cached?.layoutMode || 'split',
		contentMode: preferences.contentMode || cached?.contentMode || 'diffs',
		comparisonMode: preferences.comparisonMode || cached?.comparisonMode || 'range',
		comparisonSource:
			data.backend === 'jj' ? preferences.comparisonSource || cached?.comparisonSource || 'revision' : 'revision',
		showIntermediateRevisions,
		preset,
		fromIndex,
		toIndex,
		sidebarCollapsed: model.sidebarCollapsed,
		overlay: Closed(),
		actionsMenuOpen: false,
		viewMenuOpen: false,
		hotkeysOpen: false,
		oldestFirst: cached?.oldestFirst ?? model.oldestFirst,
		customRevset:
			typeof preferences.customRevset === 'string'
				? preferences.customRevset
				: typeof data.customRevset === 'string'
					? data.customRevset
					: cached?.customRevset || '',
		fileInputValue: data.relativePath,
		maybeHoveredSelectionIndex: Option.none(),
		fileSessionByPath: cache,
	};
	next = stepSelection(next, CancelledSelection());
	next = stepSession(next, ReceivedTimelineData());
	next = syncRevisionDrafts(next);
	next = evo(next, {
		fileSessionByPath: () => rememberFileSession(cache, next),
	});
	const commands: Array<Command.Command<Message>> = [];
	if (visibleEntries.length && !samePath && !cached) {
		commands.push(ScrollToEntry({ entryIndex: visibleEntries[visibleEntries.length - 1].index }));
	}
	if (data.backend === 'jj') {
		commands.push(SendHostCommand({ command: { command: 'load-file-oplog' } }));
	}
	return afterMutate(next, commands);
}

function handleDiffPreviewMessage(
	model: Model,
	message: Extract<TimelineInboundMessage, { type: 'diff-preview' }>,
): UpdateReturn {
	const payload = message.payload;
	const comparisonSource = payload.comparisonSource || getEffectiveComparisonSource(model);
	const previewKey = buildPreviewKey(payload.fromIndex, payload.toIndex, comparisonSource);

	let next = evo(model, {
		previewByRange: (byRange) => ({ ...byRange, [previewKey]: payload }),
		sidebarPreviewInFlightKey: (current) => (current === previewKey ? '' : current),
		sidebarPreviewInFlightKeys: (keys) => {
			if (!(previewKey in keys)) {
				return keys;
			}
			const nextKeys = { ...keys };
			delete nextKeys[previewKey];
			return nextKeys;
		},
	});

	if (previewKey !== getActivePreviewKey(next)) {
		return [next, []];
	}

	next = evo(next, { pendingRangeResolutionKey: () => '' });
	return afterMutate(next);
}

function handleSnapshotEntriesMessage(
	model: Model,
	message: Extract<TimelineInboundMessage, { type: 'snapshot-entries' }>,
): UpdateReturn {
	const data = getData(model);
	if (!data) {
		return [model, []];
	}
	const selectedSourceEntries = getSourceEntries(model);
	const selectedFromEntryId = selectedSourceEntries.find((entry) => entry.index === model.fromIndex)?.id || null;
	const selectedToEntryId = selectedSourceEntries.find((entry) => entry.index === model.toIndex)?.id || null;
	const nextData = {
		...data,
		snapshotEntries: message.payload.snapshotEntries,
		snapshotState: message.payload.snapshotState,
	} satisfies TimelineData;

	if (data.backend === 'jj' && model.comparisonSource === 'snapshot') {
		const nextSourceEntries = getEntriesForSource(nextData, 'snapshot');
		const nextFromIndex = selectedFromEntryId
			? nextSourceEntries.find((entry) => entry.id === selectedFromEntryId)?.index
			: undefined;
		const nextToIndex = selectedToEntryId
			? nextSourceEntries.find((entry) => entry.id === selectedToEntryId)?.index
			: undefined;

		const next = clearCaches(
			evo(model, {
				data: () => nextData,
				fromIndex: () => nextFromIndex ?? model.fromIndex,
				toIndex: () => nextToIndex ?? model.toIndex,
			}),
		);
		return afterMutate(next, [SendHostCommand({ command: { command: 'load-file-oplog' } })]);
	}

	const next = evo(model, {
		data: () => nextData,
		entryDiffCountByKey: () => ({}),
		entryDiffCountLoadingKey: () => '',
	});
	return afterMutate(
		next,
		data.backend === 'jj' ? [SendHostCommand({ command: { command: 'load-file-oplog' } })] : [],
	);
}

function handleWorkspaceFilesMessage(
	model: Model,
	message: Extract<TimelineInboundMessage, { type: 'workspace-files' }>,
): UpdateReturn {
	const data = getData(model);
	if (!data) {
		return [model, []];
	}

	const next = evo(model, {
		data: () =>
			({
				...data,
				workspaceFiles: message.payload.workspaceFiles,
				workspaceFilesLoaded: true,
			}) satisfies TimelineData,
	});
	return afterMutate(next);
}

function handleEntriesUpdatedMessage(
	model: Model,
	message: Extract<TimelineInboundMessage, { type: 'entries-updated' }>,
): UpdateReturn {
	const data = getData(model);
	if (!data || model.session._tag !== 'Ready') {
		return [model, []];
	}

	const selectedSourceEntries = getSourceEntries(model);
	const selectedFromEntryId = selectedSourceEntries.find((entry) => entry.index === model.fromIndex)?.id || null;
	const selectedToEntryId = selectedSourceEntries.find((entry) => entry.index === model.toIndex)?.id || null;
	const nextData = {
		...data,
		entries: message.payload.entries,
		hasIntermediateRevisions: message.payload.hasIntermediateRevisions,
	} satisfies TimelineData;
	const nextSourceEntries = getEntriesForSource(nextData, getEffectiveComparisonSource(model));
	const nextFromIndex = selectedFromEntryId
		? (nextSourceEntries.find((entry) => entry.id === selectedFromEntryId)?.index ?? model.fromIndex)
		: model.fromIndex;
	const nextToIndex = selectedToEntryId
		? (nextSourceEntries.find((entry) => entry.id === selectedToEntryId)?.index ?? model.toIndex)
		: model.toIndex;

	const next = clearCaches(
		evo(model, {
			data: () => nextData,
			fromIndex: () => Math.min(nextFromIndex, Math.max(0, nextSourceEntries.length - 1)),
			toIndex: () => Math.min(nextToIndex, Math.max(0, nextSourceEntries.length - 1)),
		}),
	);
	return afterMutate(syncRevisionDrafts(next));
}

function handleRangeOverviewMessage(
	model: Model,
	message: Extract<TimelineInboundMessage, { type: 'range-overview' }>,
): UpdateReturn {
	const payload = message.payload;
	const rangeKey = buildRangeOverviewKey(
		payload.fromIndex,
		payload.toIndex,
		payload.comparisonSource,
		payload.selectedEntryIndexes || [],
	);
	const next = evo(model, {
		rangeOverviewByRange: (byRange) => ({ ...byRange, [rangeKey]: payload.items }),
		rangeOverviewLoadingKey: (current) => (current === rangeKey ? '' : current),
		...(model.rangeStackOpen ? { rangeStackByPath: () => ({}) } : {}),
	});
	return afterMutate(next);
}

function handleRangeStackPreviewsMessage(
	model: Model,
	message: Extract<TimelineInboundMessage, { type: 'range-stack-previews' }>,
): UpdateReturn {
	const payload = message.payload;
	if (
		payload.fromIndex !== Math.min(model.fromIndex, model.toIndex) ||
		payload.toIndex !== Math.max(model.fromIndex, model.toIndex) ||
		payload.comparisonSource !== getEffectiveComparisonSource(model)
	) {
		return [model, []];
	}
	const byPath: Record<string, DiffPreview> = {};
	for (const item of payload.items) {
		byPath[item.relativePath] = item.preview;
	}
	return [evo(model, { rangeStackByPath: () => byPath }), []];
}

function handleDiffBlameMessage(
	model: Model,
	message: Extract<TimelineInboundMessage, { type: 'diff-blame' }>,
): UpdateReturn {
	const payload = message.payload;
	if (
		(!model.blameOverlayOpen && !model.heatmapOpen) ||
		payload.fromIndex !== Math.min(model.fromIndex, model.toIndex) ||
		payload.toIndex !== Math.max(model.fromIndex, model.toIndex) ||
		payload.comparisonSource !== getEffectiveComparisonSource(model)
	) {
		return [evo(model, { blameLoading: () => false }), []];
	}
	return [
		evo(model, {
			blameLines: () => payload.lines,
			blameLoading: () => false,
		}),
		[],
	];
}

function handleFileOpLogMessage(
	model: Model,
	message: Extract<TimelineInboundMessage, { type: 'file-oplog' }>,
): UpdateReturn {
	const data = getData(model);
	if (!data || data.backend !== 'jj' || message.payload.relativePath !== data.relativePath) {
		return [model, []];
	}
	return [evo(model, { fileOpLogEntries: () => message.payload.entries }), []];
}

function handleHistorySearchMessage(
	model: Model,
	message: Extract<TimelineInboundMessage, { type: 'history-search' }>,
): UpdateReturn {
	const result = message.payload as {
		query: string;
		hits: Array<{ entryIndex: number; kind: string }>;
		introducedAt: number | null;
		removedAt: number | null;
		purpose?: 'history' | 'sidebar';
	};
	if (result.purpose === 'sidebar' || (model.sidebarContentNeedle && result.query === model.sidebarContentNeedle)) {
		const indexes = result.hits
			.filter((hit) => hit.kind === 'introduced' || hit.kind === 'present')
			.map((hit) => hit.entryIndex);
		return [
			evo(model, {
				sidebarContentLoading: () => false as boolean,
				sidebarContentMatchIndexes: () => indexes,
			}),
			[],
		];
	}
	let next = evo(model, {
		historySearchLoading: () => false as boolean,
		historySearchResult: () => result,
	}) as Model;
	if (result.introducedAt !== null && Number.isInteger(result.introducedAt)) {
		return jumpToRevisionEntry(next, result.introducedAt);
	}
	return [next, []];
}

function handleUpdatedSidebarSearchQuery(model: Model, value: string): UpdateReturn {
	const needle = extractSidebarContentNeedle(value);
	let next = evo(model, { sidebarSearchQuery: () => value }) as Model;
	if (!needle) {
		next = evo(next, {
			sidebarContentNeedle: () => '',
			sidebarContentMatchIndexes: () => [],
			sidebarContentLoading: () => false as boolean,
		});
		return afterMutate(next);
	}
	if (
		needle === model.sidebarContentNeedle &&
		(model.sidebarContentLoading || model.sidebarContentMatchIndexes.length)
	) {
		return afterMutate(next);
	}
	next = evo(next, {
		sidebarContentNeedle: () => needle,
		sidebarContentMatchIndexes: () => [],
		sidebarContentLoading: () => true as boolean,
	});
	return [next, [SendHostCommand({ command: { command: 'search-history', query: needle, purpose: 'sidebar' } })]];
}

function jumpToRevisionEntry(model: Model, entryIndex: number): UpdateReturn {
	const data = getData(model);
	const revisionEntries = filterEntries(getEntriesForSource(data, 'revision'), data, model.preset, true);
	const [fromIndex, toIndex] = normalizeSelection(revisionEntries, Math.max(0, entryIndex - 1), entryIndex, 'step');
	let next = clearCaches(model);
	next = evo(next, {
		comparisonSource: () => 'revision' as ComparisonSource,
		comparisonMode: () => 'step' as ComparisonMode,
		fromIndex: () => fromIndex,
		toIndex: () => toIndex,
		maybeHoveredSelectionIndex: () => Option.none(),
		timeLapsePlaying: () => false as boolean,
		showIntermediateRevisions: () => true as boolean,
	});
	next = stepOverlay(next, ClosedOverlays());
	next = stepSelection(next, CancelledSelection());
	return afterMutate(next, [persistCommand(next), ScrollToEntry({ entryIndex: toIndex })]);
}

function handleToggleRangeStack(model: Model): UpdateReturn {
	const nextOpen = !model.rangeStackOpen;
	return afterMutate(
		evo(model, {
			rangeStackOpen: () => nextOpen,
			rangeStackByPath: () => ({}),
		}),
	);
}

function handleToggleBlameOverlay(model: Model): UpdateReturn {
	const nextOpen = !model.blameOverlayOpen;
	return afterMutate(
		evo(model, {
			blameOverlayOpen: () => nextOpen,
			blameLines: () => (nextOpen || model.heatmapOpen ? model.blameLines : initialModel.blameLines),
			blameLoading: () => false,
		}),
	);
}

function handleToggleHeatmap(model: Model): UpdateReturn {
	const nextOpen = !model.heatmapOpen;
	const next = evo(model, {
		heatmapOpen: () => nextOpen,
		blameLines: () => (nextOpen || model.blameOverlayOpen ? model.blameLines : initialModel.blameLines),
		blameLoading: () => false,
	});
	return afterMutate(next, [persistCommand(next)]);
}

function handlePierreBlameLineClick(model: Model, revision: string): UpdateReturn {
	const entries = getSourceEntries(model);
	const entryIndex = findEntryIndexForBlameRevision(entries, revision);
	if (entryIndex < 0) {
		return [model, []];
	}
	const fromIndex = Math.max(0, entryIndex - 1);
	let next = clearCaches(model);
	next = evo(next, {
		comparisonMode: () => 'step' as ComparisonMode,
		fromIndex: () => fromIndex,
		toIndex: () => entryIndex,
		maybeHoveredSelectionIndex: () => Option.none(),
	});
	next = stepSelection(next, CancelledSelection());
	return afterMutate(next, [persistCommand(next), ScrollToEntry({ entryIndex })]);
}

function handleSubmitHistorySearch(model: Model): UpdateReturn {
	const query = model.historySearchQuery.trim();
	if (!query) {
		return [
			evo(model, {
				historySearchResult: () => null,
				historySearchLoading: () => false,
			}),
			[],
		];
	}
	return [
		evo(model, { historySearchLoading: () => true }),
		[SendHostCommand({ command: { command: 'search-history', query, purpose: 'history' } })],
	];
}

function handleHistorySearchHitClick(model: Model, entryIndex: number): UpdateReturn {
	return jumpToRevisionEntry(model, entryIndex);
}

function handleEntryDiffCountsMessage(
	model: Model,
	message: Extract<TimelineInboundMessage, { type: 'entry-diff-counts' }>,
): UpdateReturn {
	const nextEntries = { ...model.entryDiffCountByKey };
	for (const item of message.payload.counts) {
		nextEntries[buildEntryDiffCountKey(item.entryIndex, message.payload.comparisonSource)] = item.diffCount;
	}
	const next = evo(model, {
		entryDiffCountByKey: () => nextEntries,
		entryDiffCountLoadingKey: () => '',
	});
	return afterMutate(next);
}

function handleResolvedRangeMessage(
	model: Model,
	message: Extract<TimelineInboundMessage, { type: 'resolved-range' }>,
): UpdateReturn {
	const next = evo(model, { pendingRangeResolutionKey: () => '' });
	if (!message.payload) {
		return afterMutate(next);
	}
	const nextCommitted = stepSelection(
		evo(next, {
			fromIndex: () => message.payload!.fromIndex,
			toIndex: () => message.payload!.toIndex,
			maybeHoveredSelectionIndex: () => Option.none(),
		}),
		CancelledSelection(),
	);
	return afterMutate(nextCommitted);
}

function handleShortcut(
	model: Model,
	event: {
		key: string;
		shiftKey: boolean;
		metaKey: boolean;
		ctrlKey: boolean;
		altKey: boolean;
		targetId: string;
		isEditableTarget: boolean;
	},
): UpdateReturn {
	const shortcutFocusedInputId =
		model.shortcutFocusedInputId._tag === 'Some' ? model.shortcutFocusedInputId.value : null;
	const shortcut = resolveTimelineShortcut({
		key: event.key,
		shiftKey: event.shiftKey,
		metaKey: event.metaKey,
		ctrlKey: event.ctrlKey,
		altKey: event.altKey,
		hotkeysOpen: model.hotkeysOpen,
		actionsMenuOpen: model.actionsMenuOpen,
		viewMenuOpen: model.viewMenuOpen,
		diffFocusMode: model.diffFocusMode,
	});
	const behavior = getEditableShortcutBehavior({
		isEditableTarget: event.isEditableTarget,
		targetId: event.targetId || null,
		shortcutFocusedInputId,
		shortcut,
	});

	if (behavior === 'block') {
		return [model, []];
	}
	if (behavior === 'clear') {
		return [evo(model, { shortcutFocusedInputId: () => Option.none() }), []];
	}
	if (!shortcut) {
		return [model, []];
	}

	return M.value(shortcut.type).pipe(
		M.withReturnType<UpdateReturn>(),
		M.when('toggleHotkeys', () => [stepOverlay(model, ToggledHotkeys()), []]),
		M.when('toggleSidebar', () => {
			const next = evo(model, { sidebarCollapsed: (value) => !value });
			return withPersist(next);
		}),
		M.when('toggleDiffFocus', () => [evo(model, { diffFocusMode: (value) => !value }), []]),
		M.when('focusInput', () => {
			const command = shortcut as Extract<typeof shortcut, { type: 'focusInput' }>;
			let next = evo(model, {
				shortcutFocusedInputId: () => Option.some(command.elementId as string),
			});
			if (command.openSidebar && next.sidebarCollapsed) {
				next = evo(next, { sidebarCollapsed: () => false });
			}
			return [next, [FocusElement({ elementId: command.elementId })]];
		}),
		M.when('closeOverlays', () => {
			const next = stepSelection(
				evo(stepOverlay(model, ClosedOverlays()), {
					maybeHoveredSelectionIndex: () => Option.none(),
				}),
				CancelledSelection(),
			);
			return [next, []];
		}),
		M.when('exitDiffFocus', () => [evo(model, { diffFocusMode: () => false }), []]),
		M.when('openSelectionDiffs', () => sendRangeCommand(model, 'open-range-files-diff')),
		M.when('dockRange', () => {
			const command = shortcut as Extract<typeof shortcut, { type: 'dockRange' }>;
			return handleDock(model, command.edge);
		}),
		M.when('adjustBoundary', () => {
			const command = shortcut as Extract<typeof shortcut, { type: 'adjustBoundary' }>;
			return handleAdjustBoundary(model, command.side, command.amount);
		}),
		M.when('stepSelection', () => {
			const command = shortcut as Extract<typeof shortcut, { type: 'stepSelection' }>;
			return handleStep(model, command.amount);
		}),
		M.exhaustive,
	);
}

function sendRangeCommand(model: Model, command: 'open-editor-diff' | 'open-range-files-diff'): UpdateReturn {
	const comparisonSource = getEffectiveComparisonSource(model);
	const hostCommand: TimelineCommand =
		command === 'open-range-files-diff'
			? {
					command,
					fromIndex: model.fromIndex,
					toIndex: model.toIndex,
					comparisonSource,
					selectedEntryIndexes: getSelectedDiffEntryIndexesSelector(model),
				}
			: {
					command,
					fromIndex: model.fromIndex,
					toIndex: model.toIndex,
					comparisonSource,
				};
	const next = stepOverlay(model, ClosedOverlays());
	return [next, [SendHostCommand({ command: hostCommand })]];
}

function handleMovedOverTrack(
	model: Model,
	clientX: number,
	clientY: number,
	anchorEntryIndex: number | null,
): UpdateReturn {
	if (model.dragState._tag !== 'DragIdle') {
		return [model, []];
	}

	const entries = getVisibleEntries(model);
	if (!entries.length) {
		return [model, []];
	}

	const pending = model.selection._tag === 'PendingAnchor' ? model.selection.entryIndex : null;

	if (pending !== null) {
		const visibleIndex = getVisibleIndexFromClientX(entries, clientX);
		const hoveredIndex =
			anchorEntryIndex !== null && Number.isInteger(anchorEntryIndex)
				? anchorEntryIndex
				: (entries[visibleIndex]?.index ?? null);
		const tooltip = buildPendingRangeTooltipPayload(entries, pending, hoveredIndex, clientX, clientY);
		const nextHover = hoveredIndex === null ? Option.none<number>() : Option.some(hoveredIndex);
		const next = evo(model, {
			maybeHoveredSelectionIndex: () => nextHover,
			maybeTrackTooltip: () => (tooltip ? Option.some(tooltip) : Option.none()),
		});
		return [next, []];
	}

	// Committed selection — show the segment tooltip for the anchor closest to the cursor.
	const anchorRange = anchorEntryIndex !== null ? getUnitPreviewRange(entries, anchorEntryIndex) : null;
	const tooltip = anchorRange
		? buildRangeTooltipPayload(entries, anchorRange.fromIndex, anchorRange.toIndex, clientX, clientY, false)
		: buildSegmentTooltipPayload(entries, clientX, clientY);

	if (!tooltip) {
		return [model, []];
	}

	const next = evo(model, {
		maybeTrackTooltip: () => Option.some(tooltip),
	});
	return [next, []];
}

function handleLeftTrack(model: Model): UpdateReturn {
	if (model.maybeTrackTooltip._tag === 'None' && model.maybeHoveredSelectionIndex._tag === 'None') {
		return [model, []];
	}
	const next = evo(model, {
		maybeTrackTooltip: () => Option.none(),
		maybeHoveredSelectionIndex: () => Option.none(),
	});
	return [next, []];
}

function handleHoveredEntry(model: Model, entryIndex: number): UpdateReturn {
	let next = evo(model, { maybeHoveredSelectionIndex: () => Option.some(entryIndex) });

	// If a pending range is being drawn, keep the tooltip in sync when the user
	// warps focus/hover onto an anchor via keyboard/dispatchEvent without moving the mouse.
	const pending = next.selection._tag === 'PendingAnchor' ? next.selection.entryIndex : null;
	if (pending !== null && next.maybeTrackTooltip._tag === 'Some') {
		const entries = getVisibleEntries(next);
		const existing = next.maybeTrackTooltip.value;
		const tooltip = buildPendingRangeTooltipPayload(entries, pending, entryIndex, existing.left, existing.top);
		if (tooltip) {
			next = evo(next, { maybeTrackTooltip: () => Option.some(tooltip) });
		}
	}

	return [next, []];
}

export function init(): UpdateReturn {
	const boot = stepSession(initialModel, BootedSession());
	return [boot, [BootSession()]];
}

export function update(model: Model, message: Message): UpdateReturn {
	return M.value(message).pipe(
		M.withReturnType<UpdateReturn>(),
		M.tagsExhaustive({
			BootedApp: () => [model, []],
			CompletedSendHost: () => [model, []],
			CompletedPersistState: () => [model, []],
			CompletedFocusElement: () => [model, []],
			CompletedScrollToEntry: () => [model, []],
			CompletedSyncPass: () => [model, []],
			CompletedCloseOverlays: () => [model, []],
			IgnoredMouseClick: () => [model, []],
			GotHostMessage: ({ payload }) => handleGotHostMessage(model, payload),
			ClickedHistoryEntry: ({ entryIndex }) => handleTrackAnchorClick(model, entryIndex),
			ClickedEvologEntry: ({ entryIndex }) => handleEvologEntryClick(model, entryIndex),
			ClickedFileOpLogEntry: ({ operationId }) => handleFileOpLogEntryClick(model, operationId),
			ClickedTrackAnchor: ({ entryIndex }) => {
				if (model.suppressAnchorClick) {
					return [evo(model, { suppressAnchorClick: () => false }), []];
				}
				return handleTrackAnchorClick(model, entryIndex);
			},
			HoveredEntry: ({ entryIndex }) => handleHoveredEntry(model, entryIndex),
			UnhoveredEntry: () => [evo(model, { maybeHoveredSelectionIndex: () => Option.none() }), []],
			MovedOverTrack: ({ clientX, clientY, anchorEntryIndex }) =>
				handleMovedOverTrack(model, clientX, clientY, anchorEntryIndex),
			LeftTrack: () => handleLeftTrack(model),
			ClickedOpenRevisionRemote: ({ entryIndex }) => [
				model,
				[
					SendHostCommand({
						command: {
							command: 'open-revision-remote',
							entryIndex,
							comparisonSource: getEffectiveComparisonSource(model),
						},
					}),
				],
			],
			ClickedOpenRevisionFilesDiff: ({ entryIndex }) => [
				model,
				[
					SendHostCommand({
						command: {
							command: 'open-revision-files-diff',
							entryIndex,
							comparisonSource: getEffectiveComparisonSource(model),
						},
					}),
				],
			],
			ClickedScrollToEntry: ({ entryIndex }) => {
				let next = model;
				if (next.sidebarCollapsed) {
					next = evo(next, { sidebarCollapsed: () => false });
				}
				return [next, [ScrollToEntry({ entryIndex })]];
			},
			UpdatedSidebarSearchQuery: ({ value }) => handleUpdatedSidebarSearchQuery(model, value),
			ToggledSortOrder: () => [evo(model, { oldestFirst: (v) => !v }), []],
			ClickedOpenSelectionDiffs: () => sendRangeCommand(model, 'open-range-files-diff'),
			ClickedOpenEditorDiff: () => sendRangeCommand(model, 'open-editor-diff'),
			ClickedToggleSidebar: () => withPersist(evo(model, { sidebarCollapsed: (v) => !v })),
			ClickedToggleSidebarFromMenu: () =>
				withPersist(
					evo(stepOverlay(model, ClosedOverlays()), {
						sidebarCollapsed: (v) => !v,
					}),
				),
			ClickedToggleTimelinePane: () => {
				if (model.timelinePaneCollapsed) {
					return withPersist(
						evo(model, {
							timelinePaneCollapsed: () => false,
							timelinePaneHeight: (value) => Math.max(TIMELINE_EXPANDED_MIN_HEIGHT, value),
						}),
					);
				}
				return withPersist(
					evo(stepOverlay(model, ClosedOverlays()), {
						timelinePaneCollapsed: () => true,
					}),
				);
			},
			ClickedToggleActionsMenu: () => [stepOverlay(model, ToggledActionsMenu()), []],
			ClickedToggleViewMenu: () => [stepOverlay(model, ToggledViewMenu()), []],
			ClickedToggleHotkeys: () => [stepOverlay(model, ToggledHotkeys()), []],
			ClickedOpenCurrentFile: () => [
				stepOverlay(model, ClosedOverlays()),
				[SendHostCommand({ command: { command: 'open-current-file' } })],
			],
			ClickedCancelActiveRequest: () => [
				stepOverlay(model, ClosedOverlays()),
				[SendHostCommand({ command: { command: 'cancel-active-request' } })],
			],
			ClickedRefreshTimeline: () => handleRefresh(model),
			ClickedClearLineHistory: () => [model, [SendHostCommand({ command: { command: 'clear-line-history' } })]],
			ClickedResetPreferences: () => handleReset(model),
			ClickedToggleDiffFocus: () => [evo(model, { diffFocusMode: (v) => !v }), []],
			SelectedComparisonMode: ({ value }) => handleSetComparisonMode(model, value),
			SelectedComparisonSource: ({ value }) => handleSetComparisonSource(model, value),
			SelectedLayoutMode: ({ value }) => withPersist(evo(model, { layoutMode: () => value })),
			SelectedContentMode: ({ value }) => withPersist(evo(model, { contentMode: () => value })),
			SelectedThemePreference: ({ value }) => withPersist(evo(model, { themePreference: () => value })),
			SelectedPreset: ({ value }) => handleSetPreset(model, value),
			UpdatedCustomRevset: ({ value }) => [evo(model, { customRevset: () => value }), []],
			AppliedCustomRevset: () => [
				stepOverlay(model, ClosedOverlays()),
				[
					SendHostCommand({
						command: { command: 'set-custom-revset', customRevset: model.customRevset.trim() },
					}),
				],
			],
			ToggledRangeStack: () => handleToggleRangeStack(model),
			ToggledBlameOverlay: () => handleToggleBlameOverlay(model),
			ToggledHeatmap: () => handleToggleHeatmap(model),
			ClickedPierreBlameLine: ({ revision }) => handlePierreBlameLineClick(model, revision),
			UpdatedHistorySearchQuery: ({ value }) => [evo(model, { historySearchQuery: () => value }), []],
			SubmittedHistorySearch: () => handleSubmitHistorySearch(model),
			ClickedHistorySearchHit: ({ entryIndex }) => handleHistorySearchHitClick(model, entryIndex),
			ToggledTimeLapse: () => [
				evo(model, {
					timeLapsePlaying: (playing) => !playing,
					comparisonMode: () => 'step' as ComparisonMode,
				}),
				[],
			],
			TimeLapseTick: () => {
				if (!model.timeLapsePlaying) {
					return [model, []];
				}
				if (!canStepForward(model)) {
					return [evo(model, { timeLapsePlaying: () => false }), []];
				}
				return handleStep(model, 1);
			},
			ToggledIntermediate: () => handleToggleIntermediate(model),
			ClickedStepBackward: () => handleStep(model, -1),
			ClickedStepFastBackward: () => handleStep(model, -5),
			ClickedStepForward: () => handleStep(model, 1),
			ClickedStepFastForward: () => handleStep(model, 5),
			PressedTrackAnchor: ({ entryIndex, clientX, clientY, button }) =>
				handlePressedTrackAnchor(model, entryIndex, clientX, clientY, button),
			PressedRangeFill: ({ clientX, button }) => handlePressedRangeFill(model, clientX, button),
			PressedMarker: ({ side, clientX, button }) => handlePressedMarker(model, side, clientX, button),
			PressedTrack: ({ clientX, button }) => handlePressedTrack(model, clientX, button),
			PressedSidebarResize: ({ clientX, clientY, button }) =>
				handlePressedSidebarResize(model, clientX, clientY, button),
			PressedTimelineResize: ({ clientY, button }) => handlePressedTimelineResize(model, clientY, button),
			PointerMovedDuringDrag: ({ clientX, clientY }) => handlePointerMovedDuringDrag(model, clientX, clientY),
			ReleasedPointerDuringDrag: () => handleReleasedPointerDuringDrag(model),
			SelectedFileSwitcherMode: ({ value }) => afterMutate(evo(model, { fileSwitcherMode: () => value })),
			SubmittedFileSwitcher: ({ value }) => handleSubmitFile(model, value),
			SubmittedFromRevision: ({ value }) => handleSubmitRevision(model, 'from', value),
			SubmittedToRevision: ({ value }) => handleSubmitRevision(model, 'to', value),
			OpenedCombobox: ({ id }) => handleOpenedCombobox(model, id),
			ClosedCombobox: ({ id }) => handleClosedCombobox(model, id),
			UpdatedComboboxDraft: ({ id, value }) => handleUpdatedComboboxDraft(model, id, value),
			PressedShortcut: (payload) => handleShortcut(model, payload),
			SettledPreview: () => [model, []],
			SettledRangeOverview: () => [model, []],
			SettledEntryDiffCounts: () => [model, []],
			SettledSidebarPreview: () => [model, []],
			ClickedSkipRange: () => [model, []],
		}),
	);
}

export function canStepBackward(model: Model): boolean {
	return canNavigateSelection(getVisibleEntries(model), model.fromIndex, model.toIndex, model.comparisonMode, -1);
}

export function canStepForward(model: Model): boolean {
	return canNavigateSelection(getVisibleEntries(model), model.fromIndex, model.toIndex, model.comparisonMode, 1);
}
