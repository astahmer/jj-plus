import { createEffect, createMemo, createSignal, For, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Sidebar } from './components/Sidebar';
import { TimelinePane } from './components/TimelinePane';
import { DiffPanel } from './components/DiffPanel';
import { createTimelineHost } from './host';
import { getEntriesForSource, getPendingSnapshotRevisionIndexes, getSelectedEntryCount } from './timeline-model';
import type { ComparisonMode, ComparisonSource, ContentMode, DiffPreview, FileRevisionEntry, LayoutMode, TimelineCommand, TimelineData, TimelineInboundMessage, TimelinePreset } from './types';

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
};

export function App() {
  const host = createTimelineHost();
  const [state, setState] = createStore<UiState>(initialState);
  const [ready, setReady] = createSignal(false);

  const sourceEntries = createMemo<FileRevisionEntry[]>(() => getEntriesForSource(state.data, state.comparisonSource));
  const visibleEntries = createMemo<FileRevisionEntry[]>(() => {
    if (!state.data) {
      return [];
    }

    const entries = sourceEntries();
    const lastEntry = entries[entries.length - 1];
    if (!lastEntry) {
      return [];
    }

    const windowDays = state.data.presets[state.preset];
    const cutoff = Number.isFinite(windowDays)
      ? lastEntry.timestamp - windowDays * 24 * 60 * 60 * 1000
      : Number.NEGATIVE_INFINITY;

    return entries.filter((entry) => entry.timestamp >= cutoff).filter((entry) => state.showIntermediateRevisions || entry.touchesFile);
  });

  const filteredSidebarEntries = createMemo(() => {
    const query = state.sidebarSearchQuery.trim().toLowerCase();
    if (!query) {
      return visibleEntries();
    }

    return visibleEntries().filter((entry) => {
      return [entry.shortRevision, entry.description, entry.changeId, entry.shortDate]
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
    return `${selectedCount}/${visibleEntries().length} ${state.comparisonSource === 'snapshot' ? 'snapshots' : 'revisions'}`;
  });

  const currentFromEntry = createMemo(() => sourceEntries().find((entry) => entry.index === state.fromIndex));
  const currentToEntry = createMemo(() => sourceEntries().find((entry) => entry.index === state.toIndex));
  const version = createMemo(() => state.data?.version ? `v${state.data.version}` : '');
  const canStepBackward = createMemo(() => visibleEntries().findIndex((entry) => entry.index === state.toIndex) > 1);
  const canStepForward = createMemo(() => visibleEntries().findIndex((entry) => entry.index === state.toIndex) < visibleEntries().length - 1);

  onMount(() => {
    const unsubscribe = host.subscribe(handleMessage);
    host.send({ command: 'ready' });
    setReady(true);
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      unsubscribe();
      window.removeEventListener('keydown', onKeyDown);
    });
  });

  createEffect(() => {
    if (!ready() || !state.data) {
      return;
    }

    const command: TimelineCommand = {
      command: 'persist-state',
      sidebarWidth: state.sidebarWidth,
      timelinePaneHeight: state.timelinePaneHeight,
      timelinePaneCollapsed: state.timelinePaneCollapsed,
      layoutMode: state.layoutMode,
      contentMode: state.contentMode,
      comparisonMode: state.comparisonMode,
      comparisonSource: state.comparisonSource,
      showIntermediateRevisions: state.showIntermediateRevisions,
      preset: state.preset,
    };
    host.send(command);
  });

  createEffect(() => {
    if (!ready() || !state.data || visibleEntries().length < 2) {
      return;
    }

    const [fromIndex, toIndex] = normalizeSelection(visibleEntries(), state.fromIndex, state.toIndex);
    if (fromIndex !== state.fromIndex || toIndex !== state.toIndex) {
      setState({ fromIndex, toIndex });
      return;
    }

    host.send({
      command: 'select-entry',
      fromIndex,
      toIndex,
      comparisonSource: state.comparisonSource,
    });
  });

  createEffect(() => {
    if (!state.data || state.data.backend !== 'jj' || state.comparisonSource !== 'snapshot') {
      return;
    }
    const loaded = new Set(state.data.snapshotState?.loadedChangeIds || []);
    const pending = getPendingSnapshotRevisionIndexes(visibleEntries(), loaded, 8, [state.fromIndex, state.toIndex]);
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

  function stepSelection(amount: number) {
    const entries = visibleEntries();
    const toVisibleIndex = entries.findIndex((entry) => entry.index === state.toIndex);
    if (toVisibleIndex < 0) {
      return;
    }
    const nextToVisibleIndex = Math.min(entries.length - 1, Math.max(1, toVisibleIndex + amount));
    setState({
      fromIndex: entries[nextToVisibleIndex - 1].index,
      toIndex: entries[nextToVisibleIndex].index,
    });
  }

  function submitRevision(side: 'from' | 'to', value: string) {
    const match = sourceEntries().find((entry) => entry.shortRevision === value.trim());
    if (!match) {
      return;
    }
    if (side === 'from') {
      setState('fromIndex', Math.min(match.index, state.toIndex));
    } else {
      setState('toIndex', Math.max(match.index, state.fromIndex));
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const tagName = target?.tagName?.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea') {
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      stepSelection(-1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      stepSelection(1);
    }
  }

  return (
    <div class="app">
      <section class="workspace">
        <Sidebar
          entries={filteredSidebarEntries}
          activeFromIndex={() => state.fromIndex}
          activeToIndex={() => state.toIndex}
          onSelectEntry={selectUnitRange}
          onSearchInput={(value) => setState('sidebarSearchQuery', value)}
          searchValue={() => state.sidebarSearchQuery}
          fileCount={() => visibleEntries().length}
        />
        <div class="resize-handle" id="resizeHandle" />
        <section class="panel diff-panel">
          <TimelinePane
            visibleEntries={visibleEntries}
            fromIndex={() => state.fromIndex}
            toIndex={() => state.toIndex}
            rangeLabel={rangeLabel}
            rangeSubtitle={rangeSubtitle}
            version={version}
            comparisonMode={() => state.comparisonMode}
            comparisonSource={() => state.comparisonSource}
            layoutMode={() => state.layoutMode}
            contentMode={() => state.contentMode}
            preset={() => state.preset}
            showIntermediateRevisions={() => state.showIntermediateRevisions}
            canStepBackward={canStepBackward}
            canStepForward={canStepForward}
            onSetComparisonMode={(value) => setState('comparisonMode', value)}
            onSetComparisonSource={(value) => setState('comparisonSource', value)}
            onSetLayoutMode={(value) => setState('layoutMode', value)}
            onSetContentMode={(value) => setState('contentMode', value)}
            onSetPreset={(value) => setState('preset', value)}
            onToggleIntermediate={() => setState('showIntermediateRevisions', (value) => !value)}
            onStep={stepSelection}
            onSelectEntry={selectUnitRange}
            onSubmitRevision={submitRevision}
          />
          <DiffPanel
            preview={() => state.preview}
            fromEntry={currentFromEntry}
            toEntry={currentToEntry}
            layoutMode={() => state.layoutMode}
          />
        </section>
      </section>
    </div>
  );
}

function normalizeSelection(entries: FileRevisionEntry[], fromIndex: number, toIndex: number): [number, number] {
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
  const exactFromVisibleIndex = entries.findIndex((entry) => entry.index === fromIndex);

  if (exactFromVisibleIndex >= 0 && exactFromVisibleIndex < safeToVisibleIndex) {
    return [entries[exactFromVisibleIndex].index, entries[safeToVisibleIndex].index];
  }

  return [entries[safeToVisibleIndex - 1].index, entries[safeToVisibleIndex].index];
}
