import { For, Show, createMemo } from 'solid-js';
import type { Accessor } from 'solid-js';
import { getTimelineAnchorPercent } from '../timeline-model';
import type { ComparisonMode, ComparisonSource, ContentMode, FileRevisionEntry, HistoryBackend, LayoutMode, TimelinePreset } from '../types';
import { RevisionIdentifier, getRevisionIdentifierValue } from './RevisionIdentifier';
import { Combobox, type ComboboxOption } from './Combobox';

type TimelinePaneProps = {
  backend: Accessor<HistoryBackend | null>;
  visibleEntries: Accessor<FileRevisionEntry[]>;
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
  onFileInput: (value: string) => void;
  onSubmitFile: (value: string) => void;
  onToggleSidebar: () => void;
  onToggleSidebarMenu: () => void;
  onToggleTimelinePane: () => void;
  onToggleHotkeys: () => void;
  onToggleActionsMenu: () => void;
  onOpenCurrentFile: () => void;
  onOpenEditorDiff: () => void;
  onOpenRangeFilesDiff: () => void;
  onCancelActiveRequest: () => void;
  onRefresh: () => void;
  onResetPreferences: () => void;
  onSetComparisonMode: (value: ComparisonMode) => void;
  onSetComparisonSource: (value: ComparisonSource) => void;
  onSetLayoutMode: (value: LayoutMode) => void;
  onSetContentMode: (value: ContentMode) => void;
  onSetPreset: (value: TimelinePreset) => void;
  onToggleIntermediate: () => void;
  onStep: (amount: number) => void;
  onSelectEntry: (entryIndex: number) => void;
  onHoverEntry: (entryIndex: number | null) => void;
  onShowAnchorTooltip: (entryIndex: number, target: HTMLElement) => void;
  onHideRangeTooltip: () => void;
  onSubmitRevision: (side: 'from' | 'to', value: string) => void;
};

const presetLabels: Record<TimelinePreset, string> = {
  year: 'This year',
  '7d': 'Last 7D',
  '30d': '30D',
  '90d': '90D',
  all: 'All',
};

export function TimelinePane(props: TimelinePaneProps) {
  const activeComparisonSource = createMemo<ComparisonSource>(() => props.rangeSubtitle().toLowerCase().includes('snapshot') ? 'snapshot' : 'revision');
  const currentFromEntry = () => props.visibleEntries().find((entry) => entry.index === props.fromIndex()) || props.visibleEntries()[0];
  const currentToEntry = () => props.visibleEntries().find((entry) => entry.index === props.toIndex()) || props.visibleEntries()[props.visibleEntries().length - 1];
  const fromPercent = () => getTimelineAnchorPercent(props.visibleEntries(), props.visibleEntries().findIndex((entry) => entry.index === props.fromIndex()));
  const toPercent = () => getTimelineAnchorPercent(props.visibleEntries(), props.visibleEntries().findIndex((entry) => entry.index === props.toIndex()));
  const collapseLabel = () => props.timelinePaneCollapsed() ? 'Expand' : 'Timeline only';
  const showStepStatusRow = () => Boolean(props.stepStatus()) || props.showSnapshotStatus();
  const fileOptions = () => props.workspaceFiles().map((value) => ({ value } satisfies ComboboxOption));
  const comparisonSourceControls = createMemo(() => {
    const comparisonSource = activeComparisonSource();
    return (
      <div class="segmented" id="comparisonSources">
        <button class={`segment${comparisonSource === 'revision' ? ' active' : ''}`} type="button" aria-pressed={comparisonSource === 'revision'} onClick={() => props.onSetComparisonSource('revision')}>Revision</button>
        <button class={`segment${comparisonSource === 'snapshot' ? ' active' : ''}`} type="button" aria-pressed={comparisonSource === 'snapshot'} onClick={() => props.onSetComparisonSource('snapshot')}>Snapshot</button>
      </div>
    );
  });
  const revisionOptions = () => props.visibleEntries().map((entry) => ({
    value: entry.shortRevision,
    label: getRevisionIdentifierValue(entry),
    description: [entry.relativeDate, entry.description].filter(Boolean).join(' · '),
    keywords: [entry.revision, entry.changeId, entry.authorName].filter(Boolean) as string[],
  } satisfies ComboboxOption));

  return (
    <div class={`timeline-pane${props.timelinePaneCollapsed() ? ' is-collapsed' : ''}`} id="timelinePane">
      <div class="timeline-pane-head">
        <button
          class={`sidebar-toggle-button${props.sidebarCollapsed() ? ' is-collapsed' : ''}`}
          id="sidebarToggleButton"
          type="button"
          aria-label="Toggle sidebar"
          onClick={props.onToggleSidebar}
        >
          {props.sidebarCollapsed() ? '▸' : '◂'}
        </button>
        <div class="timeline-pane-title">
          <div class="eyebrow">Revision Timeline</div>
          <span class="version-badge">{props.version()}</span>
        </div>
        <div class="timeline-head-summary">
          <div class="range-label">{props.rangeLabel()}</div>
          <div class="range-subtitle">{props.rangeSubtitle()}</div>
        </div>
        <button class="collapse-button" id="toggleTimelinePaneButton" type="button" onClick={props.onToggleTimelinePane}>{collapseLabel()}</button>
      </div>

      <div class="diff-head" id="timelineChrome">
        <div class="diff-head-top">
          <div class="file-switcher-row">
            <Combobox
              id="fileSwitcher"
              inputClass="file-input"
              value={props.fileInputValue()}
              placeholder="Switch file..."
              options={fileOptions()}
              onInput={props.onFileInput}
              onCommit={props.onSubmitFile}
            />
          </div>
          <div class="head-actions">
            <button class="menu-button" id="toggleHotkeysButton" type="button" aria-label="Show hotkeys" onClick={props.onToggleHotkeys}>?</button>
            <div class="menu-wrap">
              <button class="menu-button" id="actionsButton" type="button" onClick={props.onToggleActionsMenu}>...</button>
              <div class={`menu${props.actionsMenuOpen() ? ' open' : ''}`} id="actionsMenu">
                <button class="menu-item" id="toggleSidebarAction" type="button" onClick={props.onToggleSidebarMenu}>{props.sidebarCollapsed() ? 'Show Sidebar' : 'Hide Sidebar'}</button>
                <button class="menu-item" id="openCurrentFileAction" type="button" onClick={props.onOpenCurrentFile}>Open File</button>
                <button class="menu-item" id="openEditorButton" type="button" onClick={props.onOpenEditorDiff}>Open diff</button>
                <button class="menu-item" id="openRangeFilesButton" type="button" onClick={props.onOpenRangeFilesDiff}>Open diffs</button>
                <button class="menu-item" id="cancelActiveRequestAction" type="button" onClick={props.onCancelActiveRequest}>Cancel request</button>
                <button class="menu-item" id="refreshButton" type="button" onClick={props.onRefresh}>Refresh</button>
                <button class="menu-item" id="resetPreferencesAction" type="button" onClick={props.onResetPreferences}>Reset preferences</button>
              </div>
            </div>
          </div>
        </div>

        <div class="timeline-head">
          <div class="revision-picker-row">
            <div class="revision-picker-col">
              <Combobox
                id="fromRevisionInput"
                inputClass="revision-input"
                value={currentFromEntry()?.shortRevision || ''}
                options={revisionOptions()}
                onInput={() => undefined}
                onCommit={(value) => props.onSubmitRevision('from', value)}
              />
              <div class="revision-picker-meta">
                <button class="handle-pill from" id="fromHandleLabel" type="button" onClick={() => currentFromEntry() && props.onSelectEntry(currentFromEntry()!.index)}>
                  <span>From </span>
                  <Show when={currentFromEntry()}>
                    <RevisionIdentifier value={getRevisionIdentifierValue(currentFromEntry()!)} highlightPrefix={currentFromEntry()!.changeId} plain={currentFromEntry()!.isWorkingTree} />
                  </Show>
                </button>
                <span class="revision-picker-relative" id="fromRelativeLabel">{currentFromEntry()?.relativeDate}</span>
              </div>
            </div>
            <span class="revision-arrow">→</span>
            <div class="revision-picker-col">
              <Combobox
                id="toRevisionInput"
                inputClass="revision-input"
                value={currentToEntry()?.shortRevision || ''}
                options={revisionOptions()}
                onInput={() => undefined}
                onCommit={(value) => props.onSubmitRevision('to', value)}
              />
              <div class="revision-picker-meta">
                <button class="handle-pill to" id="toHandleLabel" type="button" onClick={() => currentToEntry() && props.onSelectEntry(currentToEntry()!.index)}>
                  <span>To </span>
                  <Show when={currentToEntry()}>
                    <RevisionIdentifier value={getRevisionIdentifierValue(currentToEntry()!)} highlightPrefix={currentToEntry()!.changeId} plain={currentToEntry()!.isWorkingTree} />
                  </Show>
                </button>
                <span class="revision-picker-relative" id="toRelativeLabel">{currentToEntry()?.relativeDate}</span>
              </div>
            </div>
          </div>

          <div class="control-row">
            <div class="segmented" id="comparisonModes">
              <button class={`segment${props.comparisonMode() === 'range' ? ' active' : ''}`} type="button" aria-pressed={props.comparisonMode() === 'range'} onClick={() => props.onSetComparisonMode('range')}>Range</button>
              <button class={`segment${props.comparisonMode() === 'step' ? ' active' : ''}`} type="button" aria-pressed={props.comparisonMode() === 'step'} onClick={() => props.onSetComparisonMode('step')}>Single</button>
            </div>
            <Show when={props.backend() === 'jj'}>{comparisonSourceControls()}</Show>
            <div class="segmented" id="layoutModes">
              <button class={`segment${props.layoutMode() === 'split' ? ' active' : ''}`} type="button" aria-pressed={props.layoutMode() === 'split'} onClick={() => props.onSetLayoutMode('split')}>Split</button>
              <button class={`segment${props.layoutMode() === 'unified' ? ' active' : ''}`} type="button" aria-pressed={props.layoutMode() === 'unified'} onClick={() => props.onSetLayoutMode('unified')}>Unified</button>
            </div>
            <div class="segmented" id="contentModes">
              <button class={`segment${props.contentMode() === 'diffs' ? ' active' : ''}`} type="button" aria-pressed={props.contentMode() === 'diffs'} onClick={() => props.onSetContentMode('diffs')}>Diffs</button>
              <button class={`segment${props.contentMode() === 'full' ? ' active' : ''}`} type="button" aria-pressed={props.contentMode() === 'full'} onClick={() => props.onSetContentMode('full')}>Whole file</button>
            </div>
            <button class={`toggle-chip${props.showIntermediateRevisions() ? ' active' : ''}`} id="intermediateToggle" type="button" aria-label={props.showIntermediateRevisions() ? 'Hide In-Between' : 'Show In-Between'} disabled={!props.hasIntermediateRevisions()} onClick={props.onToggleIntermediate}>{props.intermediateLabel()}</button>
            <div class="segmented" id="presets">
              <For each={(['year', '7d', '30d', '90d', 'all'] as TimelinePreset[])}>
                {(value) => <button class={`segment${props.preset() === value ? ' active' : ''}`} type="button" aria-pressed={props.preset() === value} onClick={() => props.onSetPreset(value)}>{presetLabels[value]}</button>}
              </For>
            </div>
          </div>
        </div>

        <div class="timeline-row">
          <button class="step-button" id="stepFastBackwardButton" type="button" aria-label="Jump backward" disabled={!props.canStepBackward()} onClick={() => props.onStep(-5)}>«</button>
          <button class="step-button" id="stepBackwardButton" type="button" aria-label="Previous range" disabled={!props.canStepBackward()} onClick={() => props.onStep(-1)}>‹</button>
          <div class="timeline">
            <div class="selection-meta" id="selectionMeta">{props.selectionMeta()}</div>
            <div class="track" id="track">
              <For each={props.visibleEntries()}>
                {(entry, index) => {
                  const percent = () => getTimelineAnchorPercent(props.visibleEntries(), index());
                  const showCommittedSelection = () => props.pendingSelectionIndex() === null;
                  const isFrom = () => showCommittedSelection() && entry.index === props.fromIndex();
                  const isTo = () => showCommittedSelection() && entry.index === props.toIndex();
                  const inRange = () => showCommittedSelection() && entry.index >= Math.min(props.fromIndex(), props.toIndex()) && entry.index <= Math.max(props.fromIndex(), props.toIndex());
                  const inPendingRange = () => {
                    const pendingIndex = props.pendingSelectionIndex();
                    const hoveredIndex = props.hoveredSelectionIndex();
                    if (pendingIndex === null || hoveredIndex === null) {
                      return false;
                    }

                    return entry.index >= Math.min(pendingIndex, hoveredIndex) && entry.index <= Math.max(pendingIndex, hoveredIndex);
                  };
                  return (
                    <button
                      class={`track-anchor${inRange() ? ' in-range' : ''}${inPendingRange() ? ' pending-range' : ''}${isFrom() ? ' is-from' : ''}${isTo() ? ' is-to' : ''}${!entry.touchesFile ? ' is-intermediate' : ''}`}
                      style={{ left: `${percent()}%` }}
                      data-entry-index={entry.index}
                      type="button"
                      onClick={() => props.onSelectEntry(entry.index)}
                      onMouseEnter={(event) => {
                        props.onHoverEntry(entry.index);
                        props.onShowAnchorTooltip(entry.index, event.currentTarget);
                      }}
                      onMouseLeave={() => {
                        props.onHoverEntry(null);
                        props.onHideRangeTooltip();
                      }}
                      onFocus={(event) => {
                        props.onHoverEntry(entry.index);
                        props.onShowAnchorTooltip(entry.index, event.currentTarget);
                      }}
                      onBlur={() => {
                        props.onHoverEntry(null);
                        props.onHideRangeTooltip();
                      }}
                    />
                  );
                }}
              </For>
            </div>
            <div class="range-fill" id="rangeFill" style={{ left: `${fromPercent()}%`, width: `${Math.max(0, toPercent() - fromPercent())}%` }} />
            <button class="handle-marker from" id="fromMarker" type="button" aria-label="Adjust from revision" style={{ left: `${fromPercent()}%` }} />
            <button class="handle-marker to" id="toMarker" type="button" aria-label="Adjust to revision" style={{ left: `${toPercent()}%` }} />
            <div class="month-row">
              <For each={groupMonthLabels(props.visibleEntries())}>{(label) => <div>{label}</div>}</For>
            </div>
          </div>
          <button class="step-button" id="stepForwardButton" type="button" aria-label="Next range" disabled={!props.canStepForward()} onClick={() => props.onStep(1)}>›</button>
          <button class="step-button" id="stepFastForwardButton" type="button" aria-label="Jump forward" disabled={!props.canStepForward()} onClick={() => props.onStep(5)}>»</button>
        </div>

        <Show when={showStepStatusRow()}>
          <div class="step-status-row">
            <Show when={props.stepStatus()}>
              <div class="step-status" id="stepStatus">{props.stepStatus()}</div>
            </Show>
            <Show when={props.showSnapshotStatus()}>
              <div class="loading-indicator" id="snapshotLoadingIndicator">{props.snapshotStatusLabel()}</div>
            </Show>
          </div>
        </Show>
      </div>

      <Show when={props.hotkeysOpen()}>
        <div class="hotkeys-popover" id="hotkeysPopover">
          <div class="hotkeys-card">
            <div class="hotkeys-head">
              <div>
                <div style={{ display: 'flex', 'align-items': 'baseline', gap: '6px' }}>
                  <div class="eyebrow">Shortcuts</div>
                  <div class="hotkeys-version">{props.version()}</div>
                </div>
                <div class="hotkeys-subtitle">Range selection, sidebar navigation, and diff actions</div>
              </div>
              <button class="collapse-button" id="closeHotkeysButton" type="button" onClick={props.onToggleHotkeys}>Close</button>
            </div>
            <div class="hotkeys-grid">
              <div class="hotkey-section">
                <div class="hotkey-section-title">Selection</div>
                <div class="hotkey-row"><span class="hotkey-label">Move range</span><span class="hotkey-value"><kbd>←</kbd><kbd>→</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Fast move range</span><span class="hotkey-value"><kbd>Shift</kbd><kbd>←</kbd><kbd>→</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Move range vertically</span><span class="hotkey-value"><kbd>↑</kbd><kbd>↓</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Adjust to marker</span><span class="hotkey-value"><kbd>Option</kbd><kbd>←</kbd><kbd>→</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Adjust from marker</span><span class="hotkey-value"><kbd>Ctrl</kbd><kbd>←</kbd><kbd>→</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Dock range to start/end</span><span class="hotkey-value"><kbd>Cmd</kbd><kbd>←</kbd><kbd>→</kbd></span></div>
              </div>
              <div class="hotkey-section">
                <div class="hotkey-section-title">Actions</div>
                <div class="hotkey-row"><span class="hotkey-label">Open cumulative diff</span><span class="hotkey-value"><kbd>Space</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Focus diff</span><span class="hotkey-value"><kbd>D</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Toggle help</span><span class="hotkey-value"><kbd>?</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Toggle sidebar</span><span class="hotkey-value"><kbd>B</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Focus file switcher</span><span class="hotkey-value"><kbd>/</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Focus from / to pickers</span><span class="hotkey-value"><kbd>F</kbd><kbd>T</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Focus sidebar search</span><span class="hotkey-value"><kbd>S</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Exit focus / overlays</span><span class="hotkey-value"><kbd>Esc</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Pick range by click</span><span class="hotkey-note">Click one revision, then another</span></div>
                <div class="hotkey-row"><span class="hotkey-label">Drag markers</span><span class="hotkey-note">Adjust range directly on the timeline</span></div>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

function groupMonthLabels(entries: FileRevisionEntry[]): string[] {
  const labels = new Set<string>();
  entries.forEach((entry) => {
    labels.add(formatMonthLabel(entry.authorDate, entry.monthLabel));
  });

  return [...labels].slice(-4);
}

function formatMonthLabel(authorDate: string, fallbackLabel?: string) {
  const date = new Date(authorDate);
  if (Number.isNaN(date.getTime())) {
    return fallbackLabel || 'Unknown month';
  }

  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date);
}
