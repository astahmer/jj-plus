import { createEffect, createMemo, createSignal, For, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Sidebar } from './components/Sidebar';
import { TimelinePane } from './components/TimelinePane';
import { DiffPanel } from './components/DiffPanel';
import { createTimelineHost } from './host';
import { getEntriesForSource, getPendingSnapshotRevisionIndexes, getSelectedEntryCount } from './timeline-model';
import type { ComparisonMode, ComparisonSource, ContentMode, DiffPreview, FileRevisionEntry, HistoryBackend, LayoutMode, TimelineCommand, TimelineData, TimelineInboundMessage, TimelinePreset } from './types';

type UiState = {
  data: TimelineData | null;
  preview: DiffPreview | null;
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
  fileInputValue: string;
};

const initialState: UiState = {
  data: null,
  preview: null,
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
  fileInputValue: '',
};

export function App() {
  const host = createTimelineHost();
  const [state, setState] = createStore<UiState>(initialState);
  const [ready, setReady] = createSignal(false);
  const effectiveComparisonSource = createMemo<ComparisonSource>(() => state.data?.backend === 'jj' ? state.comparisonSource : 'revision');

  const revisionEntries = createMemo<FileRevisionEntry[]>(() => getEntriesForSource(state.data, 'revision'));
  const revisionVisibleEntries = createMemo<FileRevisionEntry[]>(() => filterEntries(revisionEntries(), state.data, state.preset, state.showIntermediateRevisions));

  const sourceEntries = createMemo<FileRevisionEntry[]>(() => getEntriesForSource(state.data, effectiveComparisonSource()));
  const visibleEntries = createMemo<FileRevisionEntry[]>(() => filterEntries(sourceEntries(), state.data, state.preset, state.showIntermediateRevisions));

  const filteredSidebarEntries = createMemo(() => {
    const query = state.sidebarSearchQuery.trim().toLowerCase();
    if (!query) {
      return visibleEntries();
    }

    return visibleEntries().filter((entry) => {
      return [entry.shortRevision, entry.description, entry.changeId, entry.shortDate, entry.authorName, entry.operationId, entry.monthLabel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
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

  const currentFromEntry = createMemo(() => sourceEntries().find((entry) => entry.index === state.fromIndex));
  const currentToEntry = createMemo(() => sourceEntries().find((entry) => entry.index === state.toIndex));
  const version = createMemo(() => state.data?.version ? `v${state.data.version}` : '');
  const canStepBackward = createMemo(() => canNavigateSelection(visibleEntries(), state.fromIndex, state.toIndex, state.comparisonMode, -1));
  const canStepForward = createMemo(() => canNavigateSelection(visibleEntries(), state.fromIndex, state.toIndex, state.comparisonMode, 1));
  const selectionMeta = createMemo(() => state.pendingSelectionIndex === null
    ? 'Click an anchor or a sidebar entry to change the preview.'
    : 'Pick another revision to complete the range.');
  const stepStatus = createMemo(() => {
    if (state.comparisonMode === 'step') {
      const current = Math.max(1, visibleEntries().findIndex((entry) => entry.index === state.toIndex));
      return `${current}/${Math.max(1, visibleEntries().length - 1)} ${effectiveComparisonSource() === 'snapshot' ? 'snapshots' : 'diffs'}`;
    }

    return `${visibleEntries().length} visible ${effectiveComparisonSource() === 'snapshot' ? 'snapshots' : 'revisions'}`;
  });
  const pendingSnapshotRevisionIndexes = createMemo(() => {
    if (!state.data || state.data.backend !== 'jj' || effectiveComparisonSource() !== 'snapshot') {
      return [];
    }

    const loaded = new Set(state.data.snapshotState?.loadedChangeIds || []);
    return getPendingSnapshotRevisionIndexes(revisionVisibleEntries(), loaded, 8, [state.fromIndex, state.toIndex]);
  });
  const showSnapshotStatus = createMemo(() => state.data?.backend === 'jj' && effectiveComparisonSource() === 'snapshot');
  const snapshotStatusLabel = createMemo(() => pendingSnapshotRevisionIndexes().length ? 'Loading snapshots…' : 'Snapshots loaded');

  onMount(() => {
    const unsubscribe = host.subscribe(handleMessage);
    host.send({ command: 'ready' });
    setReady(true);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onDocumentClick);
    onCleanup(() => {
      unsubscribe();
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onDocumentClick);
    });
  });

  createEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
    document.documentElement.style.setProperty('--timeline-pane-height', `${state.timelinePaneHeight}px`);
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

    const [fromIndex, toIndex] = normalizeSelection(visibleEntries(), state.fromIndex, state.toIndex, state.comparisonMode);
    if (fromIndex !== state.fromIndex || toIndex !== state.toIndex) {
      setState({ fromIndex, toIndex });
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
    if (!state.data || state.data.backend !== 'jj' || effectiveComparisonSource() !== 'snapshot') {
      return;
    }
    const pending = pendingSnapshotRevisionIndexes();
    if (pending.length) {
      host.send({ command: 'hydrate-snapshot-entries', revisionIndexes: pending });
    }
  });

  function handleMessage(message: TimelineInboundMessage) {
    if (message.type === 'timeline-data') {
      const preferences = message.payload.preferences || {};
      setState({
        data: message.payload,
        preview: null,
        sidebarWidth: preferences.sidebarWidth || 280,
        timelinePaneHeight: preferences.timelinePaneHeight || 278,
        timelinePaneCollapsed: preferences.timelinePaneCollapsed === true,
        layoutMode: preferences.layoutMode || 'split',
        contentMode: preferences.contentMode || 'diffs',
        comparisonMode: preferences.comparisonMode || 'range',
        comparisonSource: message.payload.backend === 'jj' ? (preferences.comparisonSource || 'revision') : 'revision',
        showIntermediateRevisions: preferences.showIntermediateRevisions === true,
        preset: (preferences.preset as TimelinePreset) || 'year',
        fromIndex: Math.max(0, message.payload.defaultIndex - 1),
        toIndex: message.payload.defaultIndex,
        sidebarCollapsed: preferences.sidebarCollapsed === true,
        actionsMenuOpen: false,
        hotkeysOpen: false,
        pendingSelectionIndex: null,
        fileInputValue: message.payload.relativePath,
      });
      return;
    }

    if (message.type === 'diff-preview') {
      setState('preview', message.payload);
      return;
    }

    if (message.type === 'snapshot-entries' && state.data) {
      setState('data', {
        ...state.data,
        snapshotEntries: message.payload.snapshotEntries,
        snapshotState: message.payload.snapshotState,
      });
    }
  }

  function onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
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
    });
  }

  function handleEntrySelection(entryIndex: number) {
    setState('actionsMenuOpen', false);

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
      setState({ fromIndex, toIndex });
      return;
    }

    const [fromIndex, toIndex] = shiftRangeSelection(entries, state.fromIndex, state.toIndex, amount);
    setState({ fromIndex, toIndex });
  }

  function submitRevision(side: 'from' | 'to', value: string) {
    const query = value.trim().toLowerCase();
    const match = visibleEntries().find((entry) => entry.shortRevision.toLowerCase() === query)
      || visibleEntries().find((entry) => entry.revision.toLowerCase().startsWith(query));
    if (!match) {
      return;
    }
    setState('pendingSelectionIndex', null);
    if (state.comparisonMode === 'step') {
      selectUnitRange(match.index);
      return;
    }
    if (side === 'from') {
      setState('fromIndex', Math.min(match.index, state.toIndex));
    } else {
      setState('toIndex', Math.max(match.index, state.fromIndex));
    }
  }

  function submitFile(value: string) {
    const relativePath = value.trim();
    if (!state.data || !relativePath || relativePath === state.data.relativePath || !state.data.workspaceFiles.includes(relativePath)) {
      return;
    }

    setState({
      actionsMenuOpen: false,
      hotkeysOpen: false,
      pendingSelectionIndex: null,
    });
    host.send({ command: 'switch-file', relativePath });
  }

  function toggleSidebar() {
    setState('sidebarCollapsed', (value) => !value);
  }

  function toggleSidebarFromMenu() {
    setState({ sidebarCollapsed: !state.sidebarCollapsed, actionsMenuOpen: false });
  }

  function toggleTimelinePane() {
    setState('timelinePaneCollapsed', (value) => !value);
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
    setState({ actionsMenuOpen: false, hotkeysOpen: false, pendingSelectionIndex: null });
  }

  function setComparisonMode(value: ComparisonMode) {
    if (value === state.comparisonMode) {
      return;
    }

    if (value === 'step') {
      const [fromIndex, toIndex] = alignStepSelection(visibleEntries(), state.toIndex);
      setState({ comparisonMode: value, fromIndex, toIndex, pendingSelectionIndex: null });
      return;
    }

    setState({ comparisonMode: value, pendingSelectionIndex: null });
  }

  function setComparisonSource(value: ComparisonSource) {
    if (state.data?.backend !== 'jj' || value === state.comparisonSource) {
      return;
    }

    setState({ comparisonSource: value, pendingSelectionIndex: null });
  }

  function setPreset(value: TimelinePreset) {
    setState({ preset: value, pendingSelectionIndex: null });
  }

  function toggleIntermediateRevisions() {
    setState({ showIntermediateRevisions: !state.showIntermediateRevisions, pendingSelectionIndex: null });
  }

  function dockRange(edge: 'start' | 'end') {
    const entries = visibleEntries();
    if (entries.length < 2) {
      return;
    }

    setState('pendingSelectionIndex', null);
    if (state.comparisonMode === 'step') {
      const nextToVisibleIndex = edge === 'start' ? 1 : entries.length - 1;
      setState({ fromIndex: entries[nextToVisibleIndex - 1].index, toIndex: entries[nextToVisibleIndex].index });
      return;
    }

    const [fromIndex, toIndex] = dockRangeSelection(entries, state.fromIndex, state.toIndex, edge);
    setState({ fromIndex, toIndex });
  }

  function adjustBoundary(side: 'from' | 'to', amount: number) {
    if (state.comparisonMode === 'step') {
      return;
    }

    const [fromIndex, toIndex] = adjustRangeBoundary(visibleEntries(), state.fromIndex, state.toIndex, side, amount);
    setState({ fromIndex, toIndex, pendingSelectionIndex: null });
  }

  function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const tagName = target?.tagName?.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea') {
      return;
    }

    const jumpAmount = event.shiftKey ? 5 : 1;

    if (event.key === '?' || (event.shiftKey && event.key === '/')) {
      event.preventDefault();
      toggleHotkeys();
      return;
    }

    if (event.key === 'b' || event.key === 'B') {
      event.preventDefault();
      toggleSidebar();
      return;
    }

    if (event.key === 'Escape' && (state.hotkeysOpen || state.actionsMenuOpen)) {
      event.preventDefault();
      setState({ hotkeysOpen: false, actionsMenuOpen: false, pendingSelectionIndex: null });
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

    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      adjustBoundary('to', -jumpAmount);
      return;
    }

    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      adjustBoundary('to', jumpAmount);
      return;
    }

    if (event.ctrlKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      adjustBoundary('from', -jumpAmount);
      return;
    }

    if (event.ctrlKey && event.key === 'ArrowRight') {
      event.preventDefault();
      adjustBoundary('from', jumpAmount);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      stepSelection(-jumpAmount);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      stepSelection(jumpAmount);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      stepSelection(-jumpAmount);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      stepSelection(jumpAmount);
    }
  }

  return (
    <div class="app">
      <section class={`workspace${state.sidebarCollapsed ? ' is-collapsed' : ''}${state.diffFocusMode ? ' is-diff-focus' : ''}`}>
        <Sidebar
          entries={filteredSidebarEntries}
          activeFromIndex={() => state.fromIndex}
          activeToIndex={() => state.toIndex}
          pendingAnchorIndex={() => state.pendingSelectionIndex}
          onSelectEntry={handleEntrySelection}
          onSearchInput={(value) => setState('sidebarSearchQuery', value)}
          searchValue={() => state.sidebarSearchQuery}
          fileCount={() => visibleEntries().length}
          onOpenRangeDiff={() => sendRangeCommand('open-editor-diff')}
          onOpenRevisionFilesDiff={openRevisionFilesDiff}
          onOpenRevisionRemote={openRevisionRemote}
        />
        <div class="resize-handle" id="resizeHandle" />
        <section class="panel diff-panel">
          <TimelinePane
            backend={() => (state.data?.backend || null) as HistoryBackend | null}
            visibleEntries={visibleEntries}
            workspaceFiles={() => state.data?.workspaceFiles || []}
            fileInputValue={() => state.fileInputValue}
            fromIndex={() => state.fromIndex}
            toIndex={() => state.toIndex}
            rangeLabel={rangeLabel}
            rangeSubtitle={rangeSubtitle}
            selectionMeta={selectionMeta}
            stepStatus={stepStatus}
            version={version}
            comparisonMode={() => state.comparisonMode}
            comparisonSource={effectiveComparisonSource}
            layoutMode={() => state.layoutMode}
            contentMode={() => state.contentMode}
            preset={() => state.preset}
            showIntermediateRevisions={() => state.showIntermediateRevisions}
            sidebarCollapsed={() => state.sidebarCollapsed}
            timelinePaneCollapsed={() => state.timelinePaneCollapsed}
            actionsMenuOpen={() => state.actionsMenuOpen}
            hotkeysOpen={() => state.hotkeysOpen}
            showSnapshotStatus={showSnapshotStatus}
            snapshotStatusLabel={snapshotStatusLabel}
            diffFocusMode={() => state.diffFocusMode}
            canStepBackward={canStepBackward}
            canStepForward={canStepForward}
            onFileInput={(value) => setState('fileInputValue', value)}
            onSubmitFile={submitFile}
            onToggleSidebar={toggleSidebar}
            onToggleSidebarMenu={toggleSidebarFromMenu}
            onToggleTimelinePane={toggleTimelinePane}
            onToggleHotkeys={toggleHotkeys}
            onToggleActionsMenu={toggleActionsMenu}
            onOpenCurrentFile={openCurrentFile}
            onOpenEditorDiff={() => sendRangeCommand('open-editor-diff')}
            onOpenRangeFilesDiff={() => sendRangeCommand('open-range-files-diff')}
            onCancelActiveRequest={cancelActiveRequest}
            onRefresh={refreshTimeline}
            onSetComparisonMode={setComparisonMode}
            onSetComparisonSource={setComparisonSource}
            onSetLayoutMode={(value) => setState('layoutMode', value)}
            onSetContentMode={(value) => setState('contentMode', value)}
            onSetPreset={setPreset}
            onToggleIntermediate={toggleIntermediateRevisions}
            onStep={stepSelection}
            onSelectEntry={handleEntrySelection}
            onSubmitRevision={submitRevision}
          />
          <DiffPanel
            preview={() => state.preview}
            fromEntry={currentFromEntry}
            toEntry={currentToEntry}
            layoutMode={() => state.layoutMode}
            contentMode={() => state.contentMode}
            comparisonMode={() => state.comparisonMode}
            comparisonSource={effectiveComparisonSource}
            diffFocusMode={() => state.diffFocusMode}
            onToggleDiffFocus={toggleDiffFocus}
          />
        </section>
      </section>
    </div>
  );
}

function filterEntries(entries: FileRevisionEntry[], data: TimelineData | null, preset: TimelinePreset, showIntermediateRevisions: boolean) {
  if (!data) {
    return [];
  }

  const lastEntry = entries[entries.length - 1];
  if (!lastEntry) {
    return [];
  }

  const windowDays = data.presets[preset];
  const cutoff = Number.isFinite(windowDays)
    ? lastEntry.timestamp - windowDays * 24 * 60 * 60 * 1000
    : Number.NEGATIVE_INFINITY;

  return entries
    .filter((entry) => entry.timestamp >= cutoff)
    .filter((entry) => showIntermediateRevisions || entry.touchesFile);
}

function normalizeSelection(entries: FileRevisionEntry[], fromIndex: number, toIndex: number, comparisonMode: ComparisonMode): [number, number] {
  if (entries.length < 2) {
    return [entries[0]?.index || 0, entries[0]?.index || 0];
  }

  const exactToVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
  const nextGreaterVisibleIndex = entries.findIndex((entry) => entry.index > toIndex);
  const nearestToVisibleIndex = exactToVisibleIndex >= 0
    ? exactToVisibleIndex
    : nextGreaterVisibleIndex >= 0
      ? nextGreaterVisibleIndex
      : entries.length - 1;

  const safeToVisibleIndex = nearestToVisibleIndex >= 1 ? nearestToVisibleIndex : entries.length - 1;
  if (comparisonMode === 'step') {
    return [entries[safeToVisibleIndex - 1].index, entries[safeToVisibleIndex].index];
  }

  const exactFromVisibleIndex = entries.findIndex((entry) => entry.index === fromIndex);

  if (exactFromVisibleIndex >= 0 && exactFromVisibleIndex < safeToVisibleIndex) {
    return [entries[exactFromVisibleIndex].index, entries[safeToVisibleIndex].index];
  }

  return [entries[safeToVisibleIndex - 1].index, entries[safeToVisibleIndex].index];
}

function alignStepSelection(entries: FileRevisionEntry[], toIndex: number): [number, number] {
  if (entries.length < 2) {
    return [entries[0]?.index || 0, entries[0]?.index || 0];
  }

  const currentToVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
  const safeToVisibleIndex = Math.min(entries.length - 1, Math.max(1, currentToVisibleIndex >= 0 ? currentToVisibleIndex : entries.length - 1));
  return [entries[safeToVisibleIndex - 1].index, entries[safeToVisibleIndex].index];
}

function shiftStepSelection(entries: FileRevisionEntry[], toIndex: number, amount: number): [number, number] {
  if (entries.length < 2) {
    return [entries[0]?.index || 0, entries[0]?.index || 0];
  }

  const currentToVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
  const nextToVisibleIndex = Math.min(entries.length - 1, Math.max(1, (currentToVisibleIndex >= 0 ? currentToVisibleIndex : 1) + amount));
  return [entries[nextToVisibleIndex - 1].index, entries[nextToVisibleIndex].index];
}

function shiftRangeSelection(entries: FileRevisionEntry[], fromIndex: number, toIndex: number, amount: number): [number, number] {
  if (entries.length < 2) {
    return [entries[0]?.index || 0, entries[0]?.index || 0];
  }

  const fromVisibleIndex = entries.findIndex((entry) => entry.index === fromIndex);
  const toVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
  const safeFromVisibleIndex = Math.max(0, fromVisibleIndex);
  const safeToVisibleIndex = Math.max(safeFromVisibleIndex + 1, toVisibleIndex >= 0 ? toVisibleIndex : safeFromVisibleIndex + 1);
  const width = safeToVisibleIndex - safeFromVisibleIndex;
  const nextFromVisibleIndex = Math.min(Math.max(0, safeFromVisibleIndex + amount), Math.max(0, entries.length - 1 - width));
  const nextToVisibleIndex = Math.min(entries.length - 1, nextFromVisibleIndex + width);
  return [entries[nextFromVisibleIndex].index, entries[nextToVisibleIndex].index];
}

function adjustRangeBoundary(entries: FileRevisionEntry[], fromIndex: number, toIndex: number, side: 'from' | 'to', amount: number): [number, number] {
  if (entries.length < 2) {
    return [entries[0]?.index || 0, entries[0]?.index || 0];
  }

  let fromVisibleIndex = entries.findIndex((entry) => entry.index === fromIndex);
  let toVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
  fromVisibleIndex = Math.max(0, fromVisibleIndex);
  toVisibleIndex = Math.max(fromVisibleIndex + 1, toVisibleIndex);

  if (side === 'from') {
    fromVisibleIndex = Math.min(Math.max(0, fromVisibleIndex + amount), toVisibleIndex - 1);
  } else {
    toVisibleIndex = Math.max(fromVisibleIndex + 1, Math.min(entries.length - 1, toVisibleIndex + amount));
  }

  return [entries[fromVisibleIndex].index, entries[toVisibleIndex].index];
}

function dockRangeSelection(entries: FileRevisionEntry[], fromIndex: number, toIndex: number, edge: 'start' | 'end'): [number, number] {
  if (entries.length < 2) {
    return [entries[0]?.index || 0, entries[0]?.index || 0];
  }

  const fromVisibleIndex = Math.max(0, entries.findIndex((entry) => entry.index === fromIndex));
  const toVisibleIndex = Math.max(fromVisibleIndex + 1, entries.findIndex((entry) => entry.index === toIndex));
  const width = toVisibleIndex - fromVisibleIndex;
  const nextFromVisibleIndex = edge === 'start'
    ? 0
    : Math.max(0, entries.length - 1 - width);
  const nextToVisibleIndex = Math.min(entries.length - 1, nextFromVisibleIndex + width);
  return [entries[nextFromVisibleIndex].index, entries[nextToVisibleIndex].index];
}

function canNavigateSelection(entries: FileRevisionEntry[], fromIndex: number, toIndex: number, comparisonMode: ComparisonMode, direction: -1 | 1) {
  if (entries.length < 2) {
    return false;
  }

  if (comparisonMode === 'step') {
    const toVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
    return direction < 0 ? toVisibleIndex > 1 : toVisibleIndex < entries.length - 1;
  }

  const fromVisibleIndex = entries.findIndex((entry) => entry.index === fromIndex);
  const toVisibleIndex = entries.findIndex((entry) => entry.index === toIndex);
  return direction < 0 ? fromVisibleIndex > 0 : toVisibleIndex < entries.length - 1;
}
