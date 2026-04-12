import { For, Show } from 'solid-js';
import type { Accessor } from 'solid-js';
import { getTimelineAnchorPercent } from '../timeline-model';
import type { ComparisonMode, ComparisonSource, ContentMode, FileRevisionEntry, HistoryBackend, LayoutMode, TimelinePreset } from '../types';
import { RevisionIdentifier } from './RevisionIdentifier';

type TimelinePaneProps = {
  backend: Accessor<HistoryBackend | null>;
  visibleEntries: Accessor<FileRevisionEntry[]>;
  workspaceFiles: Accessor<string[]>;
  fileInputValue: Accessor<string>;
  fromIndex: Accessor<number>;
  toIndex: Accessor<number>;
  rangeLabel: Accessor<string>;
  rangeSubtitle: Accessor<string>;
  selectionMeta: Accessor<string>;
  stepStatus: Accessor<string>;
  version: Accessor<string>;
  comparisonMode: Accessor<ComparisonMode>;
  comparisonSource: Accessor<ComparisonSource>;
  layoutMode: Accessor<LayoutMode>;
  contentMode: Accessor<ContentMode>;
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
  onSetComparisonMode: (value: ComparisonMode) => void;
  onSetComparisonSource: (value: ComparisonSource) => void;
  onSetLayoutMode: (value: LayoutMode) => void;
  onSetContentMode: (value: ContentMode) => void;
  onSetPreset: (value: TimelinePreset) => void;
  onToggleIntermediate: () => void;
  onStep: (amount: number) => void;
  onSelectEntry: (entryIndex: number) => void;
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
  const currentFromEntry = () => props.visibleEntries().find((entry) => entry.index === props.fromIndex()) || props.visibleEntries()[0];
  const currentToEntry = () => props.visibleEntries().find((entry) => entry.index === props.toIndex()) || props.visibleEntries()[props.visibleEntries().length - 1];
  const fromPercent = () => getTimelineAnchorPercent(props.visibleEntries(), props.visibleEntries().findIndex((entry) => entry.index === props.fromIndex()));
  const toPercent = () => getTimelineAnchorPercent(props.visibleEntries(), props.visibleEntries().findIndex((entry) => entry.index === props.toIndex()));
  const collapseLabel = () => props.timelinePaneCollapsed() ? 'Expand' : 'Timeline only';
  const intermediateLabel = () => props.showIntermediateRevisions() ? 'Hide In-Between' : 'Show In-Between';

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
            <input
              class="file-input"
              id="fileSwitcher"
              list="workspaceFilesList"
              value={props.fileInputValue()}
              placeholder="Switch file..."
              autocomplete="off"
              onInput={(event) => props.onFileInput(event.currentTarget.value)}
              onChange={(event) => props.onSubmitFile(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  props.onSubmitFile(event.currentTarget.value);
                }
              }}
            />
            <datalist id="workspaceFilesList">
              <For each={props.workspaceFiles()}>{(value) => <option value={value} />}</For>
            </datalist>
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
              </div>
            </div>
          </div>
        </div>

        <div class="timeline-head">
          <div class="revision-picker-row">
            <div class="revision-picker-col">
              <input
                class="revision-input"
                id="fromRevisionInput"
                list="revisionOptionsList"
                value={currentFromEntry()?.shortRevision || ''}
                onChange={(event) => props.onSubmitRevision('from', event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    props.onSubmitRevision('from', event.currentTarget.value);
                  }
                }}
              />
              <div class="revision-picker-meta">
                <button class="handle-pill from" id="fromHandleLabel" type="button" onClick={() => currentFromEntry() && props.onSelectEntry(currentFromEntry()!.index)}>
                  <span>From </span>
                  <Show when={currentFromEntry()}>
                    <RevisionIdentifier value={currentFromEntry()!.shortRevision} highlightPrefix={currentFromEntry()!.changeId} plain={currentFromEntry()!.isWorkingTree} />
                  </Show>
                </button>
                <span class="revision-picker-relative" id="fromRelativeLabel">{currentFromEntry()?.relativeDate}</span>
              </div>
            </div>
            <span class="revision-arrow">→</span>
            <div class="revision-picker-col">
              <input
                class="revision-input"
                id="toRevisionInput"
                list="revisionOptionsList"
                value={currentToEntry()?.shortRevision || ''}
                onChange={(event) => props.onSubmitRevision('to', event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    props.onSubmitRevision('to', event.currentTarget.value);
                  }
                }}
              />
              <div class="revision-picker-meta">
                <button class="handle-pill to" id="toHandleLabel" type="button" onClick={() => currentToEntry() && props.onSelectEntry(currentToEntry()!.index)}>
                  <span>To </span>
                  <Show when={currentToEntry()}>
                    <RevisionIdentifier value={currentToEntry()!.shortRevision} highlightPrefix={currentToEntry()!.changeId} plain={currentToEntry()!.isWorkingTree} />
                  </Show>
                </button>
                <span class="revision-picker-relative" id="toRelativeLabel">{currentToEntry()?.relativeDate}</span>
              </div>
            </div>
            <datalist id="revisionOptionsList">
              <For each={props.visibleEntries()}>{(entry) => <option value={entry.shortRevision} />}</For>
            </datalist>
          </div>

          <div class="control-row">
            <div class="segmented" id="comparisonModes">
              <Segment active={props.comparisonMode() === 'range'} onClick={() => props.onSetComparisonMode('range')}>Range</Segment>
              <Segment active={props.comparisonMode() === 'step'} onClick={() => props.onSetComparisonMode('step')}>Single</Segment>
            </div>
            <Show when={props.backend() === 'jj'}>
              <div class="segmented" id="comparisonSources">
                <Segment active={props.comparisonSource() === 'revision'} onClick={() => props.onSetComparisonSource('revision')}>Revision</Segment>
                <Segment active={props.comparisonSource() === 'snapshot'} onClick={() => props.onSetComparisonSource('snapshot')}>Snapshot</Segment>
              </div>
            </Show>
            <div class="segmented" id="layoutModes">
              <Segment active={props.layoutMode() === 'split'} onClick={() => props.onSetLayoutMode('split')}>Split</Segment>
              <Segment active={props.layoutMode() === 'unified'} onClick={() => props.onSetLayoutMode('unified')}>Unified</Segment>
            </div>
            <div class="segmented" id="contentModes">
              <Segment active={props.contentMode() === 'diffs'} onClick={() => props.onSetContentMode('diffs')}>Diffs</Segment>
              <Segment active={props.contentMode() === 'full'} onClick={() => props.onSetContentMode('full')}>Whole file</Segment>
            </div>
            <button class={`toggle-chip${props.showIntermediateRevisions() ? ' active' : ''}`} id="intermediateToggle" type="button" disabled={!props.hasIntermediateRevisions()} onClick={props.onToggleIntermediate}>{intermediateLabel()}</button>
            <div class="segmented" id="presets">
              <For each={(['year', '7d', '30d', '90d', 'all'] as TimelinePreset[])}>
                {(value) => <Segment active={props.preset() === value} onClick={() => props.onSetPreset(value)}>{presetLabels[value]}</Segment>}
              </For>
            </div>
          </div>
        </div>

        <div class="timeline-row">
          <button class="step-button" id="stepFastBackwardButton" type="button" aria-label="Jump backward" disabled={!props.canStepBackward()} onClick={() => props.onStep(-5)}>«</button>
          <button class="step-button" id="stepBackwardButton" type="button" aria-label="Previous range" disabled={!props.canStepBackward()} onClick={() => props.onStep(-1)}>‹</button>
          <div class="timeline">
            <div class="selection-meta" id="selectionMeta">{props.selectionMeta()}</div>
            <div class="track">
              <div class="range-fill" style={{ left: `${fromPercent()}%`, width: `${Math.max(0, toPercent() - fromPercent())}%` }} />
              <For each={props.visibleEntries()}>
                {(entry, index) => {
                  const percent = () => getTimelineAnchorPercent(props.visibleEntries(), index());
                  const isFrom = () => entry.index === props.fromIndex();
                  const isTo = () => entry.index === props.toIndex();
                  const inRange = () => entry.index >= Math.min(props.fromIndex(), props.toIndex()) && entry.index <= Math.max(props.fromIndex(), props.toIndex());
                  return (
                    <button
                      class={`track-anchor${inRange() ? ' in-range' : ''}${isFrom() ? ' is-from' : ''}${isTo() ? ' is-to' : ''}${!entry.touchesFile ? ' is-intermediate' : ''}`}
                      style={{ left: `${percent()}%` }}
                      type="button"
                      title={`${entry.shortRevision} · ${entry.description}`}
                      onClick={() => props.onSelectEntry(entry.index)}
                    />
                  );
                }}
              </For>
              <div class="handle-marker from" style={{ left: `${fromPercent()}%` }} />
              <div class="handle-marker to" style={{ left: `${toPercent()}%` }} />
            </div>
            <div class="month-row">
              <For each={groupMonthLabels(props.visibleEntries())}>{(label) => <div>{label}</div>}</For>
            </div>
          </div>
          <button class="step-button" id="stepForwardButton" type="button" aria-label="Next range" disabled={!props.canStepForward()} onClick={() => props.onStep(1)}>›</button>
          <button class="step-button" id="stepFastForwardButton" type="button" aria-label="Jump forward" disabled={!props.canStepForward()} onClick={() => props.onStep(5)}>»</button>
        </div>

        <div class="step-status-row">
          <div class="step-status" id="stepStatus">{props.stepStatus()}</div>
          <Show when={props.showSnapshotStatus()}>
            <div class="loading-indicator" id="snapshotLoadingIndicator">{props.snapshotStatusLabel()}</div>
          </Show>
        </div>
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
                <div class="hotkey-row"><span class="hotkey-label">Toggle help</span><span class="hotkey-value"><kbd>?</kbd></span></div>
                <div class="hotkey-row"><span class="hotkey-label">Toggle sidebar</span><span class="hotkey-value"><kbd>B</kbd></span></div>
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

function Segment(props: { active: boolean; onClick: () => void; children: string }) {
  return <button class={`segment${props.active ? ' active' : ''}`} type="button" onClick={props.onClick}>{props.children}</button>;
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
