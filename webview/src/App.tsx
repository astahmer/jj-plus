import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { DiffPanel } from './components/diff-panel.tsx';
import { RevisionIdentifier, getRevisionIdentifierValue } from './components/revision-identifier.tsx';
import { Sidebar } from './components/sidebar.tsx';
import { TimelinePane } from './components/timeline-pane.tsx';
import { createTimelineHost } from './host.ts';
import {
	adjustRangeBoundary,
	alignStepSelection,
	buildPreviewKey,
	buildRangeOverviewKey,
	canNavigateSelection,
	dockRangeSelection,
	filterEntries,
	getDefaultSelection,
	getVisibleIndexForAbsoluteIndex,
	normalizeSelection,
	shiftRangeSelection,
	shiftStepSelection,
} from './timeline-selection.ts';
import {
	getEntriesForSource,
	getIntermediateToggleLabel,
	getPendingSelectionRange,
	getPendingSnapshotRevisionIndexes,
	getSelectedEntryCount,
	getSidebarPreviewRequests,
	getUnitPreviewRange,
} from './timeline-model.ts';
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
	const activeRangeOverviewKey = createMemo(() =>
		buildRangeOverviewKey(state.fromIndex, state.toIndex, effectiveComparisonSource()),
	);
	const activeRangeOverviewItems = createMemo<RangeOverviewItem[]>(
		() => state.rangeOverviewByRange[activeRangeOverviewKey()] || [],
	);
	const rangeOverviewLoading = createMemo(
		() => state.fileSwitcherMode === 'overview' && state.rangeOverviewLoadingKey === activeRangeOverviewKey(),
	);
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

	onMount(() => {
		const unsubscribe = host.subscribe(handleMessage);
		host.send({ command: 'ready' });
		setReady(true);
		window.addEventListener('keydown', onKeyDown);
		document.addEventListener('click', onDocumentClick);
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
			resizeHandle?.removeEventListener('pointerdown', onSidebarResizePointerDown);
			timelineResizeHandle?.removeEventListener('pointerdown', onTimelineResizePointerDown);
			track?.removeEventListener('mousemove', onTrackMouseMove);
			track?.removeEventListener('mouseleave', onTrackMouseLeave);
		});
	});

	createEffect(() => {
		document.documentElement.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
		document.documentElement.style.setProperty(
			'--timeline-pane-height',
			`${state.timelinePaneCollapsed ? TIMELINE_COLLAPSED_HEIGHT : state.timelinePaneHeight}px`,
		);
	});

	createEffect(() => {
		const relativePath = state.data?.relativePath;
		if (relativePath) {
			setState('fileInputValue', relativePath);
		}
	});

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

	createEffect(() => {
		if (!ready() || !state.data || visibleEntries().length < 2) {
			return;
		}

		const [fromIndex, toIndex] = normalizeSelection(
			visibleEntries(),
			state.fromIndex,
			state.toIndex,
			state.comparisonMode,
		);
		if (fromIndex !== state.fromIndex || toIndex !== state.toIndex) {
			setState({ fromIndex, toIndex });
			return;
		}

		if (state.previewByRange[activePreviewKey()]) {
			return;
		}

		host.send({
			command: 'select-entry',
			fromIndex,
			toIndex,
			comparisonSource: effectiveComparisonSource(),
		});
	});

	createEffect(() => {
		if (
			!ready() ||
			!state.data ||
			state.fileSwitcherMode !== 'overview' ||
			visibleEntries().length < 2 ||
			state.rangeOverviewLoadingKey === activeRangeOverviewKey() ||
			state.rangeOverviewByRange[activeRangeOverviewKey()]
		) {
			return;
		}

		setState('rangeOverviewLoadingKey', activeRangeOverviewKey());
		host.send({
			command: 'load-range-overview',
			fromIndex: state.fromIndex,
			toIndex: state.toIndex,
			comparisonSource: effectiveComparisonSource(),
		});
	});

	createEffect((previousSource: ComparisonSource | null) => {
		if (!ready() || !state.data || state.data.backend !== 'jj') {
			return state.data?.backend === 'jj' ? state.comparisonSource : null;
		}

		const currentSource = state.comparisonSource;
		if (previousSource !== null && previousSource !== currentSource) {
			host.send({
				command: 'select-entry',
				fromIndex: state.fromIndex,
				toIndex: state.toIndex,
				comparisonSource: currentSource,
			});
		}

		return currentSource;
	}, null);

	createEffect(() => {
		if (!state.data || state.data.backend !== 'jj' || effectiveComparisonSource() !== 'snapshot') {
			return;
		}
		const pending = pendingSnapshotRevisionIndexes();
		if (pending.length) {
			host.send({ command: 'hydrate-snapshot-entries', revisionIndexes: pending });
		}
	});

	createEffect(() => {
		if (!ready() || !state.data || visibleEntries().length < 2 || state.sidebarPreviewInFlightKey) {
			return;
		}

		if (
			state.data.backend === 'jj' &&
			effectiveComparisonSource() === 'snapshot' &&
			pendingSnapshotRevisionIndexes().length
		) {
			return;
		}

		const [nextRequest] = getSidebarPreviewRequests(
			visibleEntries(),
			effectiveComparisonSource(),
			state.previewByRange,
			activePreviewKey(),
			buildPreviewKey,
		).toSorted((left, right) => Math.abs(left.toIndex - state.toIndex) - Math.abs(right.toIndex - state.toIndex));

		if (!nextRequest) {
			return;
		}

		setState('sidebarPreviewInFlightKey', nextRequest.key);
		host.send({
			command: 'select-entry',
			fromIndex: nextRequest.fromIndex,
			toIndex: nextRequest.toIndex,
			comparisonSource: nextRequest.comparisonSource,
		});
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
				sidebarSearchQuery: '',
			});
			clearPreviewState();
			clearRangeOverviewState();
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
				return;
			}

			setState('data', nextData);
			return;
		}

		if (message.type === 'range-overview') {
			const rangeKey = buildRangeOverviewKey(
				message.payload.fromIndex,
				message.payload.toIndex,
				message.payload.comparisonSource,
			);
			setState('rangeOverviewByRange', rangeKey, message.payload.items);
			if (state.rangeOverviewLoadingKey === rangeKey) {
				setState('rangeOverviewLoadingKey', '');
			}
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
		const query = value.trim().toLowerCase();
		const match =
			visibleEntries().find((entry) => entry.shortRevision.toLowerCase() === query) ||
			visibleEntries().find((entry) => entry.revision.toLowerCase().startsWith(query));
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
		host.send({
			command,
			fromIndex: state.fromIndex,
			toIndex: state.toIndex,
			comparisonSource: effectiveComparisonSource(),
		});
		setState({ actionsMenuOpen: false, hotkeysOpen: false });
	}

	function openRevisionFilesDiff(entryIndex: number) {
		host.send({
			command: 'open-revision-files-diff',
			entryIndex,
			comparisonSource: effectiveComparisonSource(),
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
		const lowerKey = event.key.toLowerCase();
		const editableTargetRetainsInput =
			isEditableTarget(target) && target?.id !== shortcutFocusedInputId && !hasFullInputSelection(target);
		if (editableTargetRetainsInput) {
			if (event.key === 'Escape' && (state.hotkeysOpen || state.actionsMenuOpen)) {
				event.preventDefault();
				setState({
					hotkeysOpen: false,
					actionsMenuOpen: false,
					pendingSelectionIndex: null,
					hoveredSelectionIndex: null,
				});
			}

			return;
		}

		const jumpAmount = event.shiftKey ? 5 : 1;

		if (event.key === '?' || (event.shiftKey && event.key === '/')) {
			event.preventDefault();
			toggleHotkeys();
			return;
		}

		if (!event.metaKey && !event.ctrlKey && !event.altKey && lowerKey === 'b') {
			event.preventDefault();
			toggleSidebar();
			return;
		}

		if (!event.metaKey && !event.ctrlKey && !event.altKey && lowerKey === 'd') {
			event.preventDefault();
			toggleDiffFocus();
			return;
		}

		if (!event.metaKey && !event.ctrlKey && !event.altKey && lowerKey === 'f') {
			event.preventDefault();
			focusInputField('fromRevisionInput');
			return;
		}

		if (!event.metaKey && !event.ctrlKey && !event.altKey && lowerKey === 't') {
			event.preventDefault();
			focusInputField('toRevisionInput');
			return;
		}

		if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === '/') {
			event.preventDefault();
			focusInputField('fileSwitcher');
			return;
		}

		if (!event.metaKey && !event.ctrlKey && !event.altKey && lowerKey === 's') {
			event.preventDefault();
			focusInputField('sidebarSearchInput', true);
			return;
		}

		if (event.key === 'Escape' && (state.hotkeysOpen || state.actionsMenuOpen)) {
			event.preventDefault();
			setState({
				hotkeysOpen: false,
				actionsMenuOpen: false,
				pendingSelectionIndex: null,
				hoveredSelectionIndex: null,
			});
			return;
		}

		if (event.key === 'Escape' && state.diffFocusMode) {
			event.preventDefault();
			setState('diffFocusMode', false);
			return;
		}

		if (event.key === ' ') {
			event.preventDefault();
			sendRangeCommand('open-range-files-diff');
			return;
		}

		if (event.metaKey && event.key === 'ArrowLeft') {
			event.preventDefault();
			dockRange('start');
			return;
		}

		if (event.metaKey && event.key === 'ArrowRight') {
			event.preventDefault();
			dockRange('end');
			return;
		}

		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			if (event.altKey) {
				adjustBoundary('to', -jumpAmount);
			} else if (event.ctrlKey) {
				adjustBoundary('from', -jumpAmount);
			} else {
				stepSelection(-jumpAmount);
			}
			return;
		}

		if (event.key === 'ArrowRight') {
			event.preventDefault();
			if (event.altKey) {
				adjustBoundary('to', jumpAmount);
			} else if (event.ctrlKey) {
				adjustBoundary('from', jumpAmount);
			} else {
				stepSelection(jumpAmount);
			}
			return;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			stepSelection(jumpAmount);
			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			stepSelection(-jumpAmount);
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

function getVisibleIndexFromClientX(entries: FileRevisionEntry[], clientX: number) {
	const track = document.getElementById('track');
	const trackRect = track?.getBoundingClientRect();
	if (!trackRect || !entries.length) {
		return -1;
	}

	const ratio = Math.min(Math.max((clientX - trackRect.left) / Math.max(1, trackRect.width), 0), 1);
	const denominator = Math.max(1, entries.length - 1);
	return Math.min(entries.length - 1, Math.max(0, Math.round(ratio * denominator)));
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

function hasFullInputSelection(target: HTMLElement | null) {
	if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
		return false;
	}

	const valueLength = target.value.length;
	if (!valueLength) {
		return false;
	}

	return target.selectionStart === 0 && target.selectionEnd === valueLength;
}

function clampTooltipX(left: number) {
	if (typeof window === 'undefined') {
		return left;
	}

	return Math.min(window.innerWidth - 180, Math.max(180, left));
}
