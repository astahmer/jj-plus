import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { DiffPanel } from './components/diff-panel.tsx';
import { RevisionIdentifier, getRevisionIdentifierValue } from './components/revision-identifier.tsx';
import { Sidebar } from './components/sidebar.tsx';
import { TimelinePane } from './components/timeline-pane.tsx';
import { createTimelineHost } from './host.ts';
import {
	adjustRangeBoundary,
	buildEntryDiffCountKey,
	alignStepSelection,
	buildPreviewKey,
	buildRangeOverviewKey,
	canNavigateSelection,
	dockRangeSelection,
	filterEntries,
	getDefaultSelection,
	getVisibleIndexForAbsoluteIndex,
	shiftRangeSelection,
	shiftStepSelection,
} from './timeline-selection.ts';
import {
	findRevisionEntryMatch,
	getEntriesForSource,
	getIntermediateToggleLabel,
	getPendingSelectionRange,
	getPendingSnapshotRevisionIndexes,
	getRangeOverviewDiffCount,
	getSelectedDiffEntryIndexes,
	getSelectedEntryCount,
	getUnitPreviewRange,
	getVisibleIndexFromClientX,
} from './timeline-model.ts';
import { getEditableShortcutBehavior, resolveTimelineShortcut } from './timeline-shortcuts.ts';
import { buildTimelineSyncPlan } from './timeline-sync.ts';
import type {
	ComparisonMode,
	ComparisonSource,
	ContentMode,
	DiffPreview,
	FileSwitcherMode,
	FileRevisionEntry,
	LayoutMode,
	RangeOverviewItem,
	TimelineCommand,
	TimelineData,
	TimelineInboundMessage,
	TimelinePreset,
} from './types.ts';
import { TimelineProvider, type TimelineContextValue } from './timeline-context.tsx';

type TooltipState =
	| {
			kind: 'info';
			left: number;
			top: number;
			label: string | null;
			value: string;
	  }
	| {
			kind: 'range';
			left: number;
			top: number;
			fromEntry: FileRevisionEntry;
			toEntry: FileRevisionEntry;
			preview: DiffPreview | null;
			pending: boolean;
			selectedCount: number;
	  };

type UiState = {
	data: TimelineData | null;
	fromIndex: number;
	toIndex: number;
	comparisonMode: ComparisonMode;
	comparisonSource: ComparisonSource;
	layoutMode: LayoutMode;
	contentMode: ContentMode;
	preset: TimelinePreset;
	showIntermediateRevisions: boolean;
	sidebarSearchQuery: string;
	sidebarWidth: number;
	timelinePaneHeight: number;
	timelinePaneCollapsed: boolean;
	sidebarCollapsed: boolean;
	diffFocusMode: boolean;
	actionsMenuOpen: boolean;
	hotkeysOpen: boolean;
	pendingSelectionIndex: number | null;
	hoveredSelectionIndex: number | null;
	oldestFirst: boolean;
	fileInputValue: string;
	fileSwitcherMode: FileSwitcherMode;
	rangeOverviewByRange: Record<string, RangeOverviewItem[]>;
	rangeOverviewLoadingKey: string;
	entryDiffCountByKey: Record<string, number>;
	entryDiffCountLoadingKey: string;
	previewByRange: Record<string, DiffPreview>;
	sidebarPreviewInFlightKey: string;
	pendingRangeResolutionKey: string;
};

const initialState: UiState = {
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
	timelinePaneHeight: 278,
	timelinePaneCollapsed: false,
	sidebarCollapsed: false,
	diffFocusMode: false,
	actionsMenuOpen: false,
	hotkeysOpen: false,
	pendingSelectionIndex: null,
	hoveredSelectionIndex: null,
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
};

const TIMELINE_EXPANDED_MIN_HEIGHT = 176;
const TIMELINE_COLLAPSED_HEIGHT = 128;
const TIMELINE_MAX_HEIGHT = 520;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 760;
const SIDEBAR_COLLAPSE_THRESHOLD = 120;
const SIDEBAR_REOPEN_THRESHOLD = 20;

function getSidebarMaxWidth() {
	if (typeof window === 'undefined') {
		return SIDEBAR_MAX_WIDTH;
	}

	return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - 220));
}

function clampSidebarWidth(width: number) {
	return Math.max(SIDEBAR_MIN_WIDTH, Math.min(getSidebarMaxWidth(), Math.round(width)));
}

export function App() {
	const host = createTimelineHost();
	const [state, setState] = createStore<UiState>(initialState);
	const [ready, setReady] = createSignal(false);
	const [tooltip, setTooltip] = createSignal<TooltipState | null>(null);
	let shortcutFocusedInputId: string | null = null;
	const effectiveComparisonSource = createMemo<ComparisonSource>(() => {
		if (state.data?.backend !== 'jj') {
			return 'revision';
		}

		return state.comparisonSource === 'snapshot' ? 'snapshot' : 'revision';
	});

	const revisionEntries = createMemo<FileRevisionEntry[]>(() => getEntriesForSource(state.data, 'revision'));
	const revisionVisibleEntries = createMemo<FileRevisionEntry[]>(() =>
		filterEntries(revisionEntries(), state.data, state.preset, state.showIntermediateRevisions),
	);

	const sourceEntries = createMemo<FileRevisionEntry[]>(() =>
		getEntriesForSource(state.data, effectiveComparisonSource()),
	);
	const visibleEntries = createMemo<FileRevisionEntry[]>(() =>
		filterEntries(sourceEntries(), state.data, state.preset, state.showIntermediateRevisions),
	);
	const presetEntries = createMemo<FileRevisionEntry[]>(() =>
		filterEntries(sourceEntries(), state.data, state.preset, true),
	);

	const filteredSidebarEntries = createMemo(() => {
		const query = state.sidebarSearchQuery.trim().toLowerCase();
		const filteredEntries = !query
			? visibleEntries()
			: visibleEntries().filter((entry) => {
					return [
						entry.shortRevision,
						entry.description,
						entry.changeId,
						entry.shortDate,
						entry.authorName,
						entry.operationId,
						entry.operationKey,
						entry.monthLabel,
					]
						.filter(Boolean)
						.some((value) => String(value).toLowerCase().includes(query));
				});

		return state.oldestFirst ? filteredEntries : filteredEntries.toReversed();
	});

	const rangeLabel = createMemo(() => {
		const fromEntry = visibleEntries().find((entry) => entry.index === state.fromIndex);
		const toEntry = visibleEntries().find((entry) => entry.index === state.toIndex);
		if (!fromEntry || !toEntry || !state.data) {
			return 'Loading revisions...';
		}
		return `${fromEntry.shortDate || 'Today'} - ${toEntry.shortDate || 'Today'} · ${state.data.backend.toUpperCase()}`;
	});

	const rangeSubtitle = createMemo(() => {
		const selectedCount = getSelectedEntryCount(visibleEntries(), state.fromIndex, state.toIndex);
		return `${selectedCount}/${visibleEntries().length} ${effectiveComparisonSource() === 'snapshot' ? 'snapshots' : 'revisions'}`;
	});
	const intermediateLabel = createMemo(() =>
		getIntermediateToggleLabel(visibleEntries().length, presetEntries().length, state.showIntermediateRevisions),
	);
	const pendingSelectionRange = createMemo(() =>
		getPendingSelectionRange(visibleEntries(), state.pendingSelectionIndex, state.hoveredSelectionIndex),
	);

	const currentFromEntry = createMemo(() => sourceEntries().find((entry) => entry.index === state.fromIndex));
	const currentToEntry = createMemo(() => sourceEntries().find((entry) => entry.index === state.toIndex));
	const version = createMemo(() => (state.data?.version ? `v${state.data.version}` : ''));
	const canStepBackward = createMemo(() =>
		canNavigateSelection(visibleEntries(), state.fromIndex, state.toIndex, state.comparisonMode, -1),
	);
	const canStepForward = createMemo(() =>
		canNavigateSelection(visibleEntries(), state.fromIndex, state.toIndex, state.comparisonMode, 1),
	);
	const selectionMeta = createMemo(() =>
		state.pendingSelectionIndex === null
			? 'Click an anchor or a sidebar entry to change the preview.'
			: pendingSelectionRange() === null
				? 'Pick another revision to complete the range.'
				: `Selecting ${pendingSelectionRange()!.selectedCount} revisions…`,
	);
	const stepStatus = createMemo(() => {
		if (state.comparisonMode === 'step') {
			const current = Math.max(
				1,
				visibleEntries().findIndex((entry) => entry.index === state.toIndex),
			);
			return `${current}/${Math.max(1, visibleEntries().length - 1)} ${effectiveComparisonSource() === 'snapshot' ? 'snapshots' : 'diffs'}`;
		}

		return '';
	});
	const pendingSnapshotRevisionIndexes = createMemo(() => {
		if (!state.data || state.data.backend !== 'jj' || effectiveComparisonSource() !== 'snapshot') {
			return [];
		}

		const loaded = new Set(state.data.snapshotState?.loadedChangeIds || []);
		return getPendingSnapshotRevisionIndexes(revisionVisibleEntries(), loaded, 8, [state.fromIndex, state.toIndex]);
	});
	const showSnapshotStatus = createMemo(
		() =>
			state.data?.backend === 'jj' &&
			effectiveComparisonSource() === 'snapshot' &&
			pendingSnapshotRevisionIndexes().length > 0,
	);
	const snapshotStatusLabel = createMemo(() => (pendingSnapshotRevisionIndexes().length ? 'Loading snapshots…' : ''));
	const activePreviewKey = createMemo(() =>
		buildPreviewKey(state.fromIndex, state.toIndex, effectiveComparisonSource()),
	);
	const selectedDiffEntryIndexes = createMemo(() =>
		getSelectedDiffEntryIndexes(visibleEntries(), state.fromIndex, state.toIndex, state.comparisonMode),
	);
	const activeRangeOverviewKey = createMemo(() =>
		buildRangeOverviewKey(state.fromIndex, state.toIndex, effectiveComparisonSource(), selectedDiffEntryIndexes()),
	);
	const activeRangeOverviewItems = createMemo<RangeOverviewItem[]>(
		() => state.rangeOverviewByRange[activeRangeOverviewKey()] || [],
	);
	const rangeOverviewLoading = createMemo(() => state.rangeOverviewLoadingKey === activeRangeOverviewKey());
	const selectionDiffCount = createMemo<number | null>(() => {
		if (rangeOverviewLoading()) {
			return null;
		}

		return getRangeOverviewDiffCount(activeRangeOverviewItems());
	});
	const preview = createMemo<DiffPreview | null>(() => state.previewByRange[activePreviewKey()] || null);

	const previewForEntry = (entryIndex: number) => {
		const range = getUnitPreviewRange(visibleEntries(), entryIndex);
		if (!range) {
			return null;
		}

		return state.previewByRange[buildPreviewKey(range.fromIndex, range.toIndex, effectiveComparisonSource())] || null;
	};

	function clearPreviewState() {
		setState('previewByRange', reconcile({}));
		setState({ sidebarPreviewInFlightKey: '', pendingRangeResolutionKey: '' });
	}

	function clearRangeOverviewState() {
		setState('rangeOverviewByRange', reconcile({}));
		setState('rangeOverviewLoadingKey', '');
	}

	function clearEntryDiffCountState() {
		setState('entryDiffCountByKey', reconcile({}));
		setState('entryDiffCountLoadingKey', '');
	}

	onMount(() => {
		const unsubscribe = host.subscribe(handleMessage);
		host.send({ command: 'ready' });
		setReady(true);
		window.addEventListener('keydown', onKeyDown);
		document.addEventListener('click', onDocumentClick);
		document.addEventListener('input', onDocumentInput);
		const resizeHandle = document.getElementById('resizeHandle');
		const timelineResizeHandle = document.getElementById('timelineResizeHandle');
		const track = document.getElementById('track');
		const rangeFill = document.getElementById('rangeFill');
		const fromMarker = document.getElementById('fromMarker');
		const toMarker = document.getElementById('toMarker');
		let draggingTimeline = false;

		const onSidebarResizePointerDown = (event: PointerEvent) => {
			if (window.matchMedia('(max-width: 980px)').matches) {
				return;
			}

			event.preventDefault();
			const startX = event.clientX;
			const startWidth = state.sidebarWidth;
			const wasCollapsed = state.sidebarCollapsed;
			resizeHandle?.classList.add('is-dragging');

			const onPointerMove = (moveEvent: PointerEvent) => {
				const delta = moveEvent.clientX - startX;
				if (wasCollapsed) {
					if (delta < SIDEBAR_REOPEN_THRESHOLD) {
						return;
					}

					setState({
						sidebarCollapsed: false,
						sidebarWidth: clampSidebarWidth(SIDEBAR_MIN_WIDTH + (delta - SIDEBAR_REOPEN_THRESHOLD)),
					});
					return;
				}

				if (startWidth + delta < SIDEBAR_COLLAPSE_THRESHOLD) {
					setState('sidebarCollapsed', true);
					onPointerUp();
					return;
				}

				setState({
					sidebarCollapsed: false,
					sidebarWidth: clampSidebarWidth(startWidth + delta),
				});
			};

			const onPointerUp = () => {
				resizeHandle?.classList.remove('is-dragging');
				window.removeEventListener('pointermove', onPointerMove);
				window.removeEventListener('pointerup', onPointerUp);
			};

			window.addEventListener('pointermove', onPointerMove);
			window.addEventListener('pointerup', onPointerUp);
		};

		const onWindowResize = () => {
			if (window.matchMedia('(max-width: 980px)').matches) {
				return;
			}

			setState('sidebarWidth', (value) => clampSidebarWidth(value));
		};

		const onTimelineResizePointerDown = (event: PointerEvent) => {
			event.preventDefault();
			const startY = event.clientY;
			const startHeight = state.timelinePaneCollapsed ? TIMELINE_COLLAPSED_HEIGHT : state.timelinePaneHeight;
			if (state.timelinePaneCollapsed) {
				setState({ timelinePaneCollapsed: false });
			}

			timelineResizeHandle?.classList.add('is-dragging');

			const onPointerMove = (moveEvent: PointerEvent) => {
				const delta = moveEvent.clientY - startY;
				const nextHeight = Math.max(96, Math.min(TIMELINE_MAX_HEIGHT, startHeight + delta));
				if (nextHeight <= TIMELINE_COLLAPSED_HEIGHT) {
					setState('timelinePaneCollapsed', true);
					return;
				}

				setState({
					timelinePaneCollapsed: false,
					timelinePaneHeight: Math.max(TIMELINE_EXPANDED_MIN_HEIGHT, nextHeight),
				});
			};

			const onPointerUp = () => {
				timelineResizeHandle?.classList.remove('is-dragging');
				window.removeEventListener('pointermove', onPointerMove);
				window.removeEventListener('pointerup', onPointerUp);
			};

			window.addEventListener('pointermove', onPointerMove);
			window.addEventListener('pointerup', onPointerUp);
		};

		const onTrackMouseMove = (event: MouseEvent) => {
			if (draggingTimeline) {
				return;
			}

			const anchor = (event.target as HTMLElement | null)?.closest(
				'.track-anchor[data-entry-index]',
			) as HTMLElement | null;
			if (state.pendingSelectionIndex !== null) {
				const hoveredSelectionIndex = getHoveredTrackEntryIndex(visibleEntries(), event.clientX, anchor);
				if (state.hoveredSelectionIndex !== hoveredSelectionIndex) {
					setState('hoveredSelectionIndex', hoveredSelectionIndex);
				}

				setTooltip(
					buildPendingRangeTooltipState(
						visibleEntries(),
						state.previewByRange,
						effectiveComparisonSource(),
						state.pendingSelectionIndex,
						hoveredSelectionIndex,
						event.clientX,
						event.clientY,
					),
				);
				return;
			}

			const segment = getSegmentTooltipState(
				visibleEntries(),
				state.previewByRange,
				effectiveComparisonSource(),
				event.clientX,
				event.clientY,
			);
			setTooltip(segment);
		};

		const onTrackMouseLeave = () => {
			if (!draggingTimeline) {
				if (state.hoveredSelectionIndex !== null) {
					setState('hoveredSelectionIndex', null);
				}
				setTooltip((current) => (current?.kind === 'range' ? null : current));
			}
		};

		const beginRangeDrag = (event: PointerEvent) => {
			if (!visibleEntries().length) {
				return;
			}

			setState({ pendingSelectionIndex: null, hoveredSelectionIndex: null });
			setTooltip((current) => (current?.kind === 'range' ? null : current));
			draggingTimeline = true;
			event.preventDefault();
			event.stopPropagation();

			const trackRect = track?.getBoundingClientRect();
			if (!trackRect) {
				draggingTimeline = false;
				return;
			}

			const startFromVisibleIndex = getVisibleIndexForAbsoluteIndex(visibleEntries(), state.fromIndex);
			const startToVisibleIndex = getVisibleIndexForAbsoluteIndex(visibleEntries(), state.toIndex);
			const width = Math.max(1, startToVisibleIndex - startFromVisibleIndex);
			const startX = event.clientX;
			const denominator = Math.max(1, visibleEntries().length - 1);
			track?.classList.add('is-dragging');
			rangeFill?.classList.add('is-dragging');

			const onPointerMove = (moveEvent: PointerEvent) => {
				const deltaRatio = (moveEvent.clientX - startX) / Math.max(1, trackRect.width);
				const deltaSteps = Math.round(deltaRatio * denominator);
				const nextFromVisibleIndex = Math.min(
					Math.max(startFromVisibleIndex + deltaSteps, 0),
					Math.max(0, visibleEntries().length - 1 - width),
				);
				const nextToVisibleIndex = nextFromVisibleIndex + width;
				setState({
					fromIndex: visibleEntries()[nextFromVisibleIndex].index,
					toIndex: visibleEntries()[nextToVisibleIndex].index,
				});
			};

			const onPointerUp = () => {
				draggingTimeline = false;
				track?.classList.remove('is-dragging');
				rangeFill?.classList.remove('is-dragging');
				window.removeEventListener('pointermove', onPointerMove);
				window.removeEventListener('pointerup', onPointerUp);
			};

			window.addEventListener('pointermove', onPointerMove);
			window.addEventListener('pointerup', onPointerUp);
		};

		const beginMarkerDrag = (side: 'from' | 'to', event: PointerEvent) => {
			if (!visibleEntries().length) {
				return;
			}

			setState({ comparisonMode: 'range', pendingSelectionIndex: null, hoveredSelectionIndex: null });
			setTooltip((current) => (current?.kind === 'range' ? null : current));
			draggingTimeline = true;
			event.preventDefault();
			event.stopPropagation();
			track?.classList.add('is-dragging');

			updateMarkerSelection(side, event.clientX, visibleEntries(), state.fromIndex, state.toIndex, setState);

			const onPointerMove = (moveEvent: PointerEvent) => {
				updateMarkerSelection(side, moveEvent.clientX, visibleEntries(), state.fromIndex, state.toIndex, setState);
			};

			const onPointerUp = () => {
				draggingTimeline = false;
				track?.classList.remove('is-dragging');
				window.removeEventListener('pointermove', onPointerMove);
				window.removeEventListener('pointerup', onPointerUp);
			};

			window.addEventListener('pointermove', onPointerMove);
			window.addEventListener('pointerup', onPointerUp);
		};

		resizeHandle?.addEventListener('pointerdown', onSidebarResizePointerDown);
		timelineResizeHandle?.addEventListener('pointerdown', onTimelineResizePointerDown);
		rangeFill?.addEventListener('pointerdown', beginRangeDrag);
		track?.addEventListener('pointerdown', (event) => {
			if ((event.target as HTMLElement | null)?.closest('.track-anchor')) {
				return;
			}

			const visibleIndex = getVisibleIndexFromClientX(visibleEntries(), event.clientX);
			if (visibleIndex < 0) {
				return;
			}

			const fromVisibleIndex = getVisibleIndexForAbsoluteIndex(visibleEntries(), state.fromIndex);
			const toVisibleIndex = getVisibleIndexForAbsoluteIndex(visibleEntries(), state.toIndex);
			if (
				visibleIndex >= Math.min(fromVisibleIndex, toVisibleIndex) &&
				visibleIndex <= Math.max(fromVisibleIndex, toVisibleIndex)
			) {
				beginRangeDrag(event);
			}
		});
		track?.addEventListener('mousemove', onTrackMouseMove);
		track?.addEventListener('mouseleave', onTrackMouseLeave);
		fromMarker?.addEventListener('pointerdown', (event) => beginMarkerDrag('from', event));
		toMarker?.addEventListener('pointerdown', (event) => beginMarkerDrag('to', event));
		window.addEventListener('resize', onWindowResize);

		onCleanup(() => {
			unsubscribe();
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('resize', onWindowResize);
			document.removeEventListener('click', onDocumentClick);
			document.removeEventListener('input', onDocumentInput);
			resizeHandle?.removeEventListener('pointerdown', onSidebarResizePointerDown);
			timelineResizeHandle?.removeEventListener('pointerdown', onTimelineResizePointerDown);
			track?.removeEventListener('mousemove', onTrackMouseMove);
			track?.removeEventListener('mouseleave', onTrackMouseLeave);
		});
	});

	// Keep the resize CSS variables in sync because the layout rules consume them outside inline JSX styles.
	createEffect(() => {
		document.documentElement.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
		document.documentElement.style.setProperty(
			'--timeline-pane-height',
			`${state.timelinePaneCollapsed ? TIMELINE_COLLAPSED_HEIGHT : state.timelinePaneHeight}px`,
		);
	});

	// Persist the user-facing timeline preferences whenever one of the persisted controls changes.
	createEffect(() => {
		if (!ready() || !state.data) {
			return;
		}

		const command: TimelineCommand = {
			command: 'persist-state',
			sidebarWidth: state.sidebarWidth,
			sidebarCollapsed: state.sidebarCollapsed,
			timelinePaneHeight: state.timelinePaneHeight,
			timelinePaneCollapsed: state.timelinePaneCollapsed,
			layoutMode: state.layoutMode,
			contentMode: state.contentMode,
			comparisonMode: state.comparisonMode,
			comparisonSource: effectiveComparisonSource(),
			showIntermediateRevisions: state.showIntermediateRevisions,
			preset: state.preset,
		};
		host.send(command);
	});

	// Reconcile selection-driven host data in one place: normalize the range, then request any missing host-backed data.
	createEffect(() => {
		const syncPlan = buildTimelineSyncPlan({
			ready: ready(),
			data: state.data,
			visibleEntries: visibleEntries(),
			filteredSidebarEntries: filteredSidebarEntries(),
			fromIndex: state.fromIndex,
			toIndex: state.toIndex,
			comparisonMode: state.comparisonMode,
			comparisonSource: effectiveComparisonSource(),
			activePreviewKey: activePreviewKey(),
			previewByRange: state.previewByRange,
			activeRangeOverviewKey: activeRangeOverviewKey(),
			rangeOverviewByRange: state.rangeOverviewByRange,
			rangeOverviewLoadingKey: state.rangeOverviewLoadingKey,
			selectedEntryIndexes: selectedDiffEntryIndexes(),
			entryDiffCountByKey: state.entryDiffCountByKey,
			entryDiffCountLoadingKey: state.entryDiffCountLoadingKey,
			pendingSnapshotRevisionIndexes: pendingSnapshotRevisionIndexes(),
			sidebarPreviewInFlightKey: state.sidebarPreviewInFlightKey,
		});

		if (syncPlan.normalizedSelection) {
			setState(syncPlan.normalizedSelection);
			return;
		}

		if (syncPlan.previewRequest) {
			host.send({
				command: 'select-entry',
				fromIndex: syncPlan.previewRequest.fromIndex,
				toIndex: syncPlan.previewRequest.toIndex,
				comparisonSource: syncPlan.previewRequest.comparisonSource,
			});
		}

		if (syncPlan.rangeOverviewRequest) {
			setState('rangeOverviewLoadingKey', activeRangeOverviewKey());
			host.send({
				command: 'load-range-overview',
				fromIndex: syncPlan.rangeOverviewRequest.fromIndex,
				toIndex: syncPlan.rangeOverviewRequest.toIndex,
				comparisonSource: syncPlan.rangeOverviewRequest.comparisonSource,
				selectedEntryIndexes: syncPlan.rangeOverviewRequest.selectedEntryIndexes,
			});
		}

		if (syncPlan.entryDiffCountsRequest) {
			setState(
				'entryDiffCountLoadingKey',
				`${syncPlan.entryDiffCountsRequest.comparisonSource}:${syncPlan.entryDiffCountsRequest.entryIndexes.join(',')}`,
			);
			host.send({
				command: 'load-entry-diff-counts',
				entryIndexes: syncPlan.entryDiffCountsRequest.entryIndexes,
				comparisonSource: syncPlan.entryDiffCountsRequest.comparisonSource,
			});
		}

		if (syncPlan.snapshotHydrationRequest) {
			host.send({
				command: 'hydrate-snapshot-entries',
				revisionIndexes: syncPlan.snapshotHydrationRequest.revisionIndexes,
			});
		}

		if (syncPlan.sidebarPreviewRequest) {
			setState('sidebarPreviewInFlightKey', syncPlan.sidebarPreviewRequest.key);
			host.send({
				command: 'select-entry',
				fromIndex: syncPlan.sidebarPreviewRequest.fromIndex,
				toIndex: syncPlan.sidebarPreviewRequest.toIndex,
				comparisonSource: syncPlan.sidebarPreviewRequest.comparisonSource,
			});
		}
	});

	function handleMessage(message: TimelineInboundMessage) {
		if (message.type === 'timeline-data') {
			const preferences = message.payload.preferences || {};
			setState({
				data: message.payload,
				sidebarWidth: clampSidebarWidth(preferences.sidebarWidth || 280),
				timelinePaneHeight: preferences.timelinePaneHeight || 278,
				timelinePaneCollapsed: preferences.timelinePaneCollapsed === true,
				layoutMode: preferences.layoutMode || 'split',
				contentMode: preferences.contentMode || 'diffs',
				comparisonMode: preferences.comparisonMode || 'range',
				comparisonSource: message.payload.backend === 'jj' ? preferences.comparisonSource || 'revision' : 'revision',
				showIntermediateRevisions: preferences.showIntermediateRevisions === true,
				preset: (preferences.preset as TimelinePreset) || 'year',
				fromIndex: Math.max(0, message.payload.defaultIndex - 1),
				toIndex: message.payload.defaultIndex,
				sidebarCollapsed: false,
				actionsMenuOpen: false,
				hotkeysOpen: false,
				pendingSelectionIndex: null,
				hoveredSelectionIndex: null,
				oldestFirst: false,
				fileInputValue: message.payload.relativePath,
				sidebarSearchQuery: state.sidebarSearchQuery,
			});
			clearPreviewState();
			clearRangeOverviewState();
			clearEntryDiffCountState();
			return;
		}

		if (message.type === 'diff-preview') {
			const comparisonSource = message.payload.comparisonSource || effectiveComparisonSource();
			const previewKey = buildPreviewKey(message.payload.fromIndex, message.payload.toIndex, comparisonSource);

			setState('previewByRange', previewKey, message.payload);
			if (state.sidebarPreviewInFlightKey === previewKey) {
				setState('sidebarPreviewInFlightKey', '');
			}

			if (previewKey !== activePreviewKey()) {
				return;
			}

			if (
				!state.showIntermediateRevisions &&
				state.comparisonMode === 'range' &&
				!message.payload.hasChanges &&
				message.payload.fromIndex !== message.payload.toIndex
			) {
				maybeResolveHiddenRangeToNonEmpty(message.payload);
				return;
			}

			setState('pendingRangeResolutionKey', '');
			return;
		}

		if (message.type === 'snapshot-entries' && state.data) {
			const selectedSourceEntries = sourceEntries();
			const selectedFromEntryId = selectedSourceEntries.find((entry) => entry.index === state.fromIndex)?.id || null;
			const selectedToEntryId = selectedSourceEntries.find((entry) => entry.index === state.toIndex)?.id || null;
			const nextData = {
				...state.data,
				snapshotEntries: message.payload.snapshotEntries,
				snapshotState: message.payload.snapshotState,
			};

			if (state.data.backend === 'jj' && state.comparisonSource === 'snapshot') {
				const nextSourceEntries = getEntriesForSource(nextData, 'snapshot');
				const nextFromIndex = selectedFromEntryId
					? nextSourceEntries.find((entry) => entry.id === selectedFromEntryId)?.index
					: undefined;
				const nextToIndex = selectedToEntryId
					? nextSourceEntries.find((entry) => entry.id === selectedToEntryId)?.index
					: undefined;

				setState({
					data: nextData,
					fromIndex: nextFromIndex ?? state.fromIndex,
					toIndex: nextToIndex ?? state.toIndex,
				});
				clearPreviewState();
				clearRangeOverviewState();
				clearEntryDiffCountState();
				return;
			}

			setState('data', nextData);
			clearEntryDiffCountState();
			return;
		}

		if (message.type === 'range-overview') {
			const rangeKey = buildRangeOverviewKey(
				message.payload.fromIndex,
				message.payload.toIndex,
				message.payload.comparisonSource,
				message.payload.selectedEntryIndexes || [],
			);
			setState('rangeOverviewByRange', rangeKey, message.payload.items);
			if (state.rangeOverviewLoadingKey === rangeKey) {
				setState('rangeOverviewLoadingKey', '');
			}
			return;
		}

		if (message.type === 'entry-diff-counts') {
			for (const item of message.payload.counts) {
				setState(
					'entryDiffCountByKey',
					buildEntryDiffCountKey(item.entryIndex, message.payload.comparisonSource),
					item.diffCount,
				);
			}
			setState('entryDiffCountLoadingKey', '');
			return;
		}

		if (message.type === 'resolved-range') {
			setState('pendingRangeResolutionKey', '');
			if (!message.payload) {
				return;
			}

			setState({
				fromIndex: message.payload.fromIndex,
				toIndex: message.payload.toIndex,
				pendingSelectionIndex: null,
				hoveredSelectionIndex: null,
			});
		}
	}

	function maybeResolveHiddenRangeToNonEmpty(nextPreview: DiffPreview) {
		const candidateIndexes = visibleEntries()
			.filter(
				(entry) =>
					entry.index >= Math.min(nextPreview.fromIndex, nextPreview.toIndex) &&
					entry.index <= Math.max(nextPreview.fromIndex, nextPreview.toIndex),
			)
			.map((entry) => entry.index);

		if (candidateIndexes.length < 2) {
			return;
		}

		const resolutionKey = candidateIndexes.join(':');
		if (state.pendingRangeResolutionKey === resolutionKey) {
			return;
		}

		setState('pendingRangeResolutionKey', resolutionKey);
		host.send({
			command: 'resolve-nonempty-range',
			candidateIndexes,
		});
	}

	function onDocumentClick(event: MouseEvent) {
		const target = event.target as HTMLElement | null;
		shortcutFocusedInputId = null;
		if (state.actionsMenuOpen && !target?.closest('.menu-wrap')) {
			setState('actionsMenuOpen', false);
		}

		if (state.hotkeysOpen && !target?.closest('.hotkeys-card') && !target?.closest('#toggleHotkeysButton')) {
			setState('hotkeysOpen', false);
		}
	}

	function onDocumentInput(event: Event) {
		const target = event.target as HTMLElement | null;
		if (isEditableTarget(target) && target?.id === shortcutFocusedInputId) {
			shortcutFocusedInputId = null;
		}
	}

	function selectUnitRange(entryIndex: number) {
		const entries = visibleEntries();
		const visibleIndex = entries.findIndex((entry) => entry.index === entryIndex);
		if (visibleIndex <= 0) {
			return;
		}

		setState({
			fromIndex: entries[visibleIndex - 1].index,
			toIndex: entries[visibleIndex].index,
			hoveredSelectionIndex: null,
		});
	}

	function handleEntrySelection(entryIndex: number) {
		setState({ actionsMenuOpen: false, hoveredSelectionIndex: null });

		if (state.comparisonMode === 'step') {
			setState('pendingSelectionIndex', null);
			selectUnitRange(entryIndex);
			return;
		}

		if (state.pendingSelectionIndex === null) {
			setState('pendingSelectionIndex', entryIndex);
			return;
		}

		if (state.pendingSelectionIndex === entryIndex) {
			setState('pendingSelectionIndex', null);
			return;
		}

		setState({
			fromIndex: Math.min(state.pendingSelectionIndex, entryIndex),
			toIndex: Math.max(state.pendingSelectionIndex, entryIndex),
			pendingSelectionIndex: null,
		});
	}

	function stepSelection(amount: number) {
		const entries = visibleEntries();
		if (!entries.length) {
			return;
		}

		setState('pendingSelectionIndex', null);
		if (state.comparisonMode === 'step') {
			const [fromIndex, toIndex] = shiftStepSelection(entries, state.toIndex, amount);
			setState({ fromIndex, toIndex, hoveredSelectionIndex: null });
			return;
		}

		const [fromIndex, toIndex] = shiftRangeSelection(entries, state.fromIndex, state.toIndex, amount);
		setState({ fromIndex, toIndex, hoveredSelectionIndex: null });
	}

	function submitRevision(side: 'from' | 'to', value: string) {
		const match = findRevisionEntryMatch(visibleEntries(), value);
		if (!match) {
			return;
		}
		setState('pendingSelectionIndex', null);
		if (state.comparisonMode === 'step') {
			selectUnitRange(match.index);
			return;
		}
		if (side === 'from') {
			setState({ fromIndex: Math.min(match.index, state.toIndex), hoveredSelectionIndex: null });
		} else {
			setState({ toIndex: Math.max(match.index, state.fromIndex), hoveredSelectionIndex: null });
		}
	}

	function submitFile(value: string) {
		const relativePath = value.trim();
		if (
			!state.data ||
			!relativePath ||
			relativePath === state.data.relativePath ||
			!state.data.workspaceFiles.includes(relativePath)
		) {
			return;
		}

		setState({
			actionsMenuOpen: false,
			hotkeysOpen: false,
			pendingSelectionIndex: null,
			hoveredSelectionIndex: null,
		});
		host.send({ command: 'switch-file', relativePath });
	}

	function toggleSidebar() {
		setState('sidebarCollapsed', (value) => !value);
	}

	function toggleSortOrder() {
		setState('oldestFirst', (value) => !value);
	}

	function toggleSidebarFromMenu() {
		setState({ sidebarCollapsed: !state.sidebarCollapsed, actionsMenuOpen: false });
	}

	function toggleTimelinePane() {
		if (state.timelinePaneCollapsed) {
			setState({
				timelinePaneCollapsed: false,
				timelinePaneHeight: Math.max(TIMELINE_EXPANDED_MIN_HEIGHT, state.timelinePaneHeight),
			});
			return;
		}

		setState({ timelinePaneCollapsed: true, actionsMenuOpen: false, hotkeysOpen: false });
	}

	function toggleDiffFocus() {
		setState('diffFocusMode', (value) => !value);
	}

	function toggleActionsMenu() {
		setState({ actionsMenuOpen: !state.actionsMenuOpen, hotkeysOpen: false });
	}

	function toggleHotkeys() {
		setState({ hotkeysOpen: !state.hotkeysOpen, actionsMenuOpen: false });
	}

	function sendRangeCommand(command: 'open-editor-diff' | 'open-range-files-diff') {
		if (command === 'open-range-files-diff') {
			host.send({
				command,
				fromIndex: state.fromIndex,
				toIndex: state.toIndex,
				comparisonSource: effectiveComparisonSource(),
				selectedEntryIndexes: selectedDiffEntryIndexes(),
			});
		} else {
			host.send({
				command,
				fromIndex: state.fromIndex,
				toIndex: state.toIndex,
				comparisonSource: effectiveComparisonSource(),
			});
		}
		setState({ actionsMenuOpen: false, hotkeysOpen: false });
	}

	function openRevisionFilesDiff(entryIndex: number) {
		host.send({
			command: 'open-revision-files-diff',
			entryIndex,
			comparisonSource: effectiveComparisonSource(),
		});
	}

	function scrollToEntry(entryIndex: number) {
		if (state.sidebarCollapsed) {
			setState('sidebarCollapsed', false);
		}

		window.requestAnimationFrame(() => {
			const entry = document.querySelector(`.history-item[data-entry-index="${entryIndex}"]`);
			if (!(entry instanceof HTMLElement)) {
				return;
			}

			entry.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			entry.focus({ preventScroll: true });
		});
	}

	function openRevisionRemote(entryIndex: number) {
		host.send({
			command: 'open-revision-remote',
			entryIndex,
			comparisonSource: effectiveComparisonSource(),
		});
	}

	function openCurrentFile() {
		host.send({ command: 'open-current-file' });
		setState('actionsMenuOpen', false);
	}

	function cancelActiveRequest() {
		host.send({ command: 'cancel-active-request' });
		setState('actionsMenuOpen', false);
	}

	function refreshTimeline() {
		host.send({ command: 'refresh' });
		setState({ actionsMenuOpen: false, hotkeysOpen: false, pendingSelectionIndex: null, hoveredSelectionIndex: null });
	}

	function resetPreferences() {
		if (!state.data) {
			return;
		}

		const nextSourceEntries = filterEntries(getEntriesForSource(state.data, 'revision'), state.data, 'year', false);
		const { fromIndex, toIndex } = getDefaultSelection(nextSourceEntries);
		setState({
			fromIndex,
			toIndex,
			comparisonMode: 'range',
			comparisonSource: 'revision',
			layoutMode: 'split',
			contentMode: 'diffs',
			preset: 'year',
			showIntermediateRevisions: false,
			sidebarSearchQuery: '',
			sidebarWidth: clampSidebarWidth(280),
			timelinePaneHeight: 278,
			timelinePaneCollapsed: false,
			sidebarCollapsed: false,
			diffFocusMode: false,
			actionsMenuOpen: false,
			hotkeysOpen: false,
			pendingSelectionIndex: null,
			hoveredSelectionIndex: null,
			oldestFirst: false,
		});
		clearPreviewState();
	}

	function setComparisonMode(value: ComparisonMode) {
		if (value === state.comparisonMode) {
			return;
		}

		if (value === 'step') {
			const [fromIndex, toIndex] = alignStepSelection(visibleEntries(), state.toIndex);
			setState({
				comparisonMode: value,
				fromIndex,
				toIndex,
				pendingSelectionIndex: null,
				hoveredSelectionIndex: null,
				pendingRangeResolutionKey: '',
			});
			return;
		}

		setState({
			comparisonMode: value,
			pendingSelectionIndex: null,
			hoveredSelectionIndex: null,
			pendingRangeResolutionKey: '',
		});
	}

	function setComparisonSource(value: ComparisonSource) {
		if (state.data?.backend !== 'jj' || value === state.comparisonSource) {
			return;
		}

		const nextVisibleEntries = filterEntries(
			getEntriesForSource(state.data, value),
			state.data,
			state.preset,
			state.showIntermediateRevisions,
		);
		const { fromIndex, toIndex } = getDefaultSelection(nextVisibleEntries);

		setState({
			comparisonSource: value,
			fromIndex,
			toIndex,
			pendingSelectionIndex: null,
			hoveredSelectionIndex: null,
		});
		clearPreviewState();
	}

	function setPreset(value: TimelinePreset) {
		if (!state.data || value === state.preset) {
			setState({
				preset: value,
				pendingSelectionIndex: null,
				hoveredSelectionIndex: null,
				pendingRangeResolutionKey: '',
			});
			return;
		}

		const nextVisibleEntries = filterEntries(
			getEntriesForSource(state.data, effectiveComparisonSource()),
			state.data,
			value,
			state.showIntermediateRevisions,
		);
		const { fromIndex, toIndex } = getDefaultSelection(nextVisibleEntries);
		setState({
			preset: value,
			fromIndex,
			toIndex,
			pendingSelectionIndex: null,
			hoveredSelectionIndex: null,
			pendingRangeResolutionKey: '',
		});
	}

	function toggleIntermediateRevisions() {
		if (!state.data?.hasIntermediateRevisions) {
			return;
		}

		setState({
			showIntermediateRevisions: !state.showIntermediateRevisions,
			pendingSelectionIndex: null,
			hoveredSelectionIndex: null,
			pendingRangeResolutionKey: '',
		});
	}

	function dockRange(edge: 'start' | 'end') {
		const entries = visibleEntries();
		if (entries.length < 2) {
			return;
		}

		setState('pendingSelectionIndex', null);
		if (state.comparisonMode === 'step') {
			const nextToVisibleIndex = edge === 'start' ? 1 : entries.length - 1;
			setState({
				fromIndex: entries[nextToVisibleIndex - 1].index,
				toIndex: entries[nextToVisibleIndex].index,
				hoveredSelectionIndex: null,
			});
			return;
		}

		const [fromIndex, toIndex] = dockRangeSelection(entries, state.fromIndex, state.toIndex, edge);
		setState({ fromIndex, toIndex, hoveredSelectionIndex: null });
	}

	function adjustBoundary(side: 'from' | 'to', amount: number) {
		if (state.comparisonMode === 'step') {
			return;
		}

		const [fromIndex, toIndex] = adjustRangeBoundary(visibleEntries(), state.fromIndex, state.toIndex, side, amount);
		setState({ fromIndex, toIndex, pendingSelectionIndex: null, hoveredSelectionIndex: null });
	}

	function focusInputField(elementId: string, openSidebar = false) {
		if (openSidebar && state.sidebarCollapsed) {
			setState('sidebarCollapsed', false);
		}

		shortcutFocusedInputId = elementId;

		window.requestAnimationFrame(() => {
			const element = document.getElementById(elementId) as HTMLInputElement | null;
			if (!element) {
				return;
			}

			element.focus();
			element.select();
		});
	}

	function onKeyDown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		const shortcut = resolveTimelineShortcut({
			key: event.key,
			shiftKey: event.shiftKey,
			metaKey: event.metaKey,
			ctrlKey: event.ctrlKey,
			altKey: event.altKey,
			hotkeysOpen: state.hotkeysOpen,
			actionsMenuOpen: state.actionsMenuOpen,
			diffFocusMode: state.diffFocusMode,
		});
		const editableShortcutBehavior = getEditableShortcutBehavior({
			isEditableTarget: isEditableTarget(target),
			targetId: target?.id || null,
			shortcutFocusedInputId,
			shortcut,
		});

		if (editableShortcutBehavior === 'block') {
			return;
		}

		if (editableShortcutBehavior === 'clear') {
			shortcutFocusedInputId = null;
			return;
		}

		if (!shortcut) {
			return;
		}

		event.preventDefault();
		switch (shortcut.type) {
			case 'toggleHotkeys':
				toggleHotkeys();
				return;
			case 'toggleSidebar':
				toggleSidebar();
				return;
			case 'toggleDiffFocus':
				toggleDiffFocus();
				return;
			case 'focusInput':
				focusInputField(shortcut.elementId, shortcut.openSidebar === true);
				return;
			case 'closeOverlays':
				setState({
					hotkeysOpen: false,
					actionsMenuOpen: false,
					pendingSelectionIndex: null,
					hoveredSelectionIndex: null,
				});
				return;
			case 'exitDiffFocus':
				setState('diffFocusMode', false);
				return;
			case 'openSelectionDiffs':
				sendRangeCommand('open-range-files-diff');
				return;
			case 'dockRange':
				dockRange(shortcut.edge);
				return;
			case 'adjustBoundary':
				adjustBoundary(shortcut.side, shortcut.amount);
				return;
			case 'stepSelection':
				stepSelection(shortcut.amount);
				return;
		}
	}

	function setHoveredEntry(entryIndex: number | null) {
		setState('hoveredSelectionIndex', entryIndex);
	}

	function showAnchorTooltip(entryIndex: number, target: HTMLElement) {
		const rect = target.getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const anchorTop = rect.top;

		if (state.pendingSelectionIndex !== null) {
			setTooltip(
				buildPendingRangeTooltipState(
					visibleEntries(),
					state.previewByRange,
					effectiveComparisonSource(),
					state.pendingSelectionIndex,
					entryIndex,
					centerX,
					anchorTop,
				),
			);
			return;
		}

		const unitRange = getUnitPreviewRange(visibleEntries(), entryIndex);
		if (!unitRange) {
			hideRangeTooltip();
			return;
		}

		setTooltip(
			buildRangeTooltipState(
				visibleEntries(),
				state.previewByRange,
				effectiveComparisonSource(),
				unitRange.fromIndex,
				unitRange.toIndex,
				centerX,
				anchorTop,
				false,
			),
		);
	}

	function hideRangeTooltip() {
		setTooltip((current) => (current?.kind === 'range' ? null : current));
	}

	function showInfoTooltip(event: MouseEvent, label: string | null, value: string) {
		const target = event.currentTarget as HTMLElement | null;
		const rect = target?.getBoundingClientRect();
		if (!rect || !value) {
			return;
		}

		setTooltip({
			kind: 'info',
			left: rect.left + rect.width / 2,
			top: rect.top - 8,
			label,
			value: label === 'Timestamp' ? formatExactTimestamp(value) : value,
		});
	}

	function hideTooltip() {
		setTooltip((current) => (current?.kind === 'info' ? null : current));
	}

	const timelineContextValue: TimelineContextValue = {
		state: {
			backend: () => state.data?.backend || null,
			visibleEntries,
			sidebarEntries: filteredSidebarEntries,
			workspaceFiles: () => state.data?.workspaceFiles || [],
			fileInputValue: () => state.fileInputValue,
			fileSwitcherMode: () => state.fileSwitcherMode,
			rangeOverviewItems: activeRangeOverviewItems,
			rangeOverviewLoading,
			selectionDiffCount,
			fromIndex: () => state.fromIndex,
			toIndex: () => state.toIndex,
			pendingSelectionIndex: () => state.pendingSelectionIndex,
			hoveredSelectionIndex: () => state.hoveredSelectionIndex,
			rangeLabel,
			rangeSubtitle,
			selectionMeta,
			stepStatus,
			version,
			comparisonMode: () => state.comparisonMode,
			comparisonSource: effectiveComparisonSource,
			layoutMode: () => state.layoutMode,
			contentMode: () => state.contentMode,
			intermediateLabel,
			preset: () => state.preset,
			showIntermediateRevisions: () => state.showIntermediateRevisions,
			hasIntermediateRevisions: () => state.data?.hasIntermediateRevisions === true,
			sidebarCollapsed: () => state.sidebarCollapsed,
			timelinePaneCollapsed: () => state.timelinePaneCollapsed,
			actionsMenuOpen: () => state.actionsMenuOpen,
			hotkeysOpen: () => state.hotkeysOpen,
			showSnapshotStatus,
			snapshotStatusLabel,
			diffFocusMode: () => state.diffFocusMode,
			canStepBackward,
			canStepForward,
			currentFromEntry,
			currentToEntry,
			preview,
			previewForEntry,
			entryDiffCount: (entryIndex) =>
				state.entryDiffCountByKey[buildEntryDiffCountKey(entryIndex, effectiveComparisonSource())] ?? null,
			sidebarSearchQuery: () => state.sidebarSearchQuery,
			visibleEntryCount: () => visibleEntries().length,
			oldestFirst: () => state.oldestFirst,
		},
		actions: {
			selectEntry: handleEntrySelection,
			hoverEntry: setHoveredEntry,
			setSidebarSearchQuery: (value) => setState('sidebarSearchQuery', value),
			toggleSortOrder,
			openSelectionDiffs: () => sendRangeCommand('open-range-files-diff'),
			openRevisionFilesDiff,
			openRevisionRemote,
			showInfoTooltip,
			hideInfoTooltip: hideTooltip,
			submitFile,
			toggleSidebar,
			toggleSidebarFromMenu,
			toggleTimelinePane,
			toggleHotkeys,
			toggleActionsMenu,
			openCurrentFile,
			openEditorDiff: () => sendRangeCommand('open-editor-diff'),
			cancelActiveRequest,
			refreshTimeline,
			resetPreferences,
			setComparisonMode,
			setComparisonSource,
			setLayoutMode: (value) => setState('layoutMode', value),
			setContentMode: (value) => setState('contentMode', value),
			setPreset,
			toggleIntermediateRevisions,
			stepSelection,
			showAnchorTooltip,
			hideRangeTooltip,
			submitRevision,
			scrollToEntry,
			toggleDiffFocus,
			setFileSwitcherMode: (value) => setState('fileSwitcherMode', value),
		},
	};

	return (
		<TimelineProvider value={timelineContextValue}>
			<div class="app">
				<section
					class={`workspace${state.sidebarCollapsed ? ' is-collapsed' : ''}${state.diffFocusMode ? ' is-diff-focus' : ''}`}
				>
					<Sidebar />
					<div class="resize-handle" id="resizeHandle" />
					<section class="panel diff-panel">
						<TimelinePane />
						<DiffPanel />
					</section>
				</section>
				<Show when={tooltip()}>
					{(activeTooltip) => {
						const current = activeTooltip();
						const tooltipLeft = clampTooltipX(current.left);
						return (
							<div
								class={`anchor-tooltip${current.kind === 'range' ? ' anchor-tooltip--segment' : ''}${current.kind === 'range' && current.pending ? ' anchor-tooltip--pending' : ''}`}
								style={{
									left: `${tooltipLeft}px`,
									top: `${Math.max(48, current.top)}px`,
									transform: 'translate(-50%, calc(-100% - 8px))',
								}}
							>
								{current.kind === 'info' ? (
									<>
										<Show when={current.label}>
											<div class="anchor-tooltip-label">{current.label}</div>
										</Show>
										<div class="anchor-tooltip-meta">{current.value}</div>
									</>
								) : (
									<>
										<div class="anchor-tooltip-id anchor-tooltip-range">
											<RevisionIdentifier
												value={getRevisionIdentifierValue(current.fromEntry)}
												highlightPrefix={current.fromEntry.changeId}
												plain={current.fromEntry.isWorkingTree}
											/>
											<span class="diff-title-arrow">→</span>
											<RevisionIdentifier
												value={getRevisionIdentifierValue(current.toEntry)}
												highlightPrefix={current.toEntry.changeId}
												plain={current.toEntry.isWorkingTree}
											/>
										</div>
										<div class="anchor-tooltip-label">
											{current.pending
												? `Pending selection · ${formatRevisionCount(current.selectedCount)}`
												: formatRevisionCount(current.selectedCount)}
										</div>
										<div class="anchor-tooltip-meta">
											From {current.fromEntry.relativeDate || 'unknown'} ·{' '}
											{formatExactTimestamp(current.fromEntry.authorDate)}
										</div>
										<div class="anchor-tooltip-meta">
											To {current.toEntry.relativeDate || 'unknown'} ·{' '}
											{formatExactTimestamp(current.toEntry.authorDate)}
										</div>
										<div class="anchor-tooltip-desc">{current.preview?.subtitle || current.toEntry.description}</div>
									</>
								)}
							</div>
						);
					}}
				</Show>
			</div>
		</TimelineProvider>
	);
}

function getHoveredTrackEntryIndex(
	entries: FileRevisionEntry[],
	clientX: number,
	anchor: HTMLElement | null,
): number | null {
	const anchorIndex = Number(anchor?.dataset.entryIndex || '');
	if (Number.isInteger(anchorIndex)) {
		return anchorIndex;
	}

	const visibleIndex = getVisibleIndexFromClientX(entries, clientX);
	if (visibleIndex < 0) {
		return null;
	}

	return entries[visibleIndex]?.index ?? null;
}

function updateMarkerSelection(
	side: 'from' | 'to',
	clientX: number,
	entries: FileRevisionEntry[],
	fromIndex: number,
	toIndex: number,
	setState: ReturnType<typeof createStore<UiState>>[1],
) {
	const nextVisibleIndex = getVisibleIndexFromClientX(entries, clientX);
	if (nextVisibleIndex < 0) {
		return;
	}

	const fromVisibleIndex = getVisibleIndexForAbsoluteIndex(entries, fromIndex);
	const toVisibleIndex = getVisibleIndexForAbsoluteIndex(entries, toIndex);
	if (fromVisibleIndex < 0 || toVisibleIndex < 0) {
		return;
	}

	if (side === 'from') {
		const clampedVisibleIndex = Math.min(nextVisibleIndex, Math.max(0, toVisibleIndex - 1));
		setState('fromIndex', entries[clampedVisibleIndex].index);
		ensureMinimumRangeWidth(entries, 'from', setState, entries[clampedVisibleIndex].index, toIndex);
		return;
	}

	const clampedVisibleIndex = Math.max(nextVisibleIndex, Math.min(entries.length - 1, fromVisibleIndex + 1));
	setState('toIndex', entries[clampedVisibleIndex].index);
	ensureMinimumRangeWidth(entries, 'to', setState, fromIndex, entries[clampedVisibleIndex].index);
}

function ensureMinimumRangeWidth(
	entries: FileRevisionEntry[],
	preferredSide: 'from' | 'to',
	setState: ReturnType<typeof createStore<UiState>>[1],
	fromIndex: number,
	toIndex: number,
) {
	if (entries.length < 2) {
		return;
	}

	let fromVisibleIndex = getVisibleIndexForAbsoluteIndex(entries, fromIndex);
	let toVisibleIndex = getVisibleIndexForAbsoluteIndex(entries, toIndex);
	if (fromVisibleIndex < 0 || toVisibleIndex < 0 || fromVisibleIndex !== toVisibleIndex) {
		return;
	}

	if (preferredSide === 'from') {
		fromVisibleIndex = Math.max(0, toVisibleIndex - 1);
		toVisibleIndex = Math.max(fromVisibleIndex + 1, toVisibleIndex);
	} else {
		toVisibleIndex = Math.min(entries.length - 1, fromVisibleIndex + 1);
		fromVisibleIndex = Math.min(fromVisibleIndex, toVisibleIndex - 1);
	}

	if (fromVisibleIndex === toVisibleIndex) {
		fromVisibleIndex = Math.max(0, toVisibleIndex - 1);
		toVisibleIndex = Math.min(entries.length - 1, fromVisibleIndex + 1);
	}

	setState({
		fromIndex: entries[fromVisibleIndex].index,
		toIndex: entries[toVisibleIndex].index,
	});
}

function buildRangeTooltipState(
	entries: FileRevisionEntry[],
	previewByRange: Record<string, DiffPreview>,
	comparisonSource: ComparisonSource,
	fromIndex: number,
	toIndex: number,
	clientX: number,
	clientY: number,
	pending: boolean,
): TooltipState | null {
	const normalizedFromIndex = Math.min(fromIndex, toIndex);
	const normalizedToIndex = Math.max(fromIndex, toIndex);
	const fromEntry = entries.find((entry) => entry.index === normalizedFromIndex);
	const toEntry = entries.find((entry) => entry.index === normalizedToIndex);
	if (!fromEntry || !toEntry) {
		return null;
	}

	return {
		kind: 'range',
		left: clientX,
		top: clientY,
		fromEntry,
		toEntry,
		preview: previewByRange[buildPreviewKey(normalizedFromIndex, normalizedToIndex, comparisonSource)] || null,
		pending,
		selectedCount: getSelectedEntryCount(entries, normalizedFromIndex, normalizedToIndex),
	};
}

function buildPendingRangeTooltipState(
	entries: FileRevisionEntry[],
	previewByRange: Record<string, DiffPreview>,
	comparisonSource: ComparisonSource,
	pendingSelectionIndex: number,
	hoveredSelectionIndex: number | null,
	clientX: number,
	clientY: number,
): TooltipState | null {
	if (hoveredSelectionIndex === null || hoveredSelectionIndex === pendingSelectionIndex) {
		return null;
	}

	return buildRangeTooltipState(
		entries,
		previewByRange,
		comparisonSource,
		pendingSelectionIndex,
		hoveredSelectionIndex,
		clientX,
		clientY,
		true,
	);
}

function getSegmentTooltipState(
	entries: FileRevisionEntry[],
	previewByRange: Record<string, DiffPreview>,
	comparisonSource: ComparisonSource,
	clientX: number,
	clientY: number,
): TooltipState | null {
	const visibleIndex = getVisibleIndexFromClientX(entries, clientX);
	if (visibleIndex <= 0) {
		return null;
	}

	const fromEntry = entries[visibleIndex - 1];
	const toEntry = entries[visibleIndex];
	if (!fromEntry || !toEntry) {
		return null;
	}

	return buildRangeTooltipState(
		entries,
		previewByRange,
		comparisonSource,
		fromEntry.index,
		toEntry.index,
		clientX,
		clientY,
		false,
	);
}

function formatExactTimestamp(authorDate: string) {
	const date = new Date(authorDate);
	if (Number.isNaN(date.getTime())) {
		return 'Unknown time';
	}

	return date.toLocaleString();
}

function formatRevisionCount(count: number) {
	return `${count} ${count === 1 ? 'revision' : 'revisions'}`;
}

function isEditableTarget(target: HTMLElement | null) {
	const tagName = target?.tagName?.toLowerCase();
	return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable === true;
}

function clampTooltipX(left: number) {
	if (typeof window === 'undefined') {
		return left;
	}

	return Math.min(window.innerWidth - 180, Math.max(180, left));
}
