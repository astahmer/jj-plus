import { For, Show } from 'solid-js';
import type { Accessor } from 'solid-js';
import { getTimelineAnchorPercent } from '../timeline-model';
import type { ComparisonMode, ComparisonSource, ContentMode, FileRevisionEntry, LayoutMode, TimelinePreset } from '../types';

type TimelinePaneProps = {
  visibleEntries: Accessor<FileRevisionEntry[]>;
  fromIndex: Accessor<number>;
  toIndex: Accessor<number>;
  rangeLabel: Accessor<string>;
  rangeSubtitle: Accessor<string>;
  version: Accessor<string>;
  comparisonMode: Accessor<ComparisonMode>;
  comparisonSource: Accessor<ComparisonSource>;
  layoutMode: Accessor<LayoutMode>;
  contentMode: Accessor<ContentMode>;
  preset: Accessor<TimelinePreset>;
  showIntermediateRevisions: Accessor<boolean>;
  canStepBackward: Accessor<boolean>;
  canStepForward: Accessor<boolean>;
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

  return (
    <div class="timeline-pane" id="timelinePane">
      <div class="timeline-pane-head">
        <button class="sidebar-toggle-button" type="button" aria-label="Toggle sidebar">◂</button>
        <div class="timeline-pane-title">
          <div class="eyebrow">Revision Timeline</div>
          <span class="version-badge">{props.version()}</span>
        </div>
        <div class="timeline-head-summary">
          <div class="range-label">{props.rangeLabel()}</div>
          <div class="range-subtitle">{props.rangeSubtitle()}</div>
        </div>
        <button class="collapse-button" type="button">Timeline only</button>
      </div>

      <div class="diff-head">
        <div class="diff-head-top">
          <div class="file-switcher-row">
            <input class="file-input" value="" placeholder="Switch file..." />
          </div>
          <div class="head-actions">
            <button class="menu-button" type="button">?</button>
            <button class="menu-button" type="button">...</button>
          </div>
        </div>

        <div class="timeline-head">
          <div class="revision-picker-row">
            <div class="revision-picker-col">
              <input
                class="revision-input"
                value={currentFromEntry()?.shortRevision || ''}
                onChange={(event) => props.onSubmitRevision('from', event.currentTarget.value)}
              />
              <div class="revision-picker-meta">
                <button class="handle-pill from" type="button">From {currentFromEntry()?.shortRevision}</button>
                <span class="revision-picker-relative">{currentFromEntry()?.relativeDate}</span>
              </div>
            </div>
            <span class="revision-arrow">→</span>
            <div class="revision-picker-col">
              <input
                class="revision-input"
                value={currentToEntry()?.shortRevision || ''}
                onChange={(event) => props.onSubmitRevision('to', event.currentTarget.value)}
              />
              <div class="revision-picker-meta">
                <button class="handle-pill to" type="button">To {currentToEntry()?.shortRevision}</button>
                <span class="revision-picker-relative">{currentToEntry()?.relativeDate}</span>
              </div>
            </div>
          </div>

          <div class="control-row">
            <div class="segmented">
              <Segment active={props.comparisonMode() === 'range'} onClick={() => props.onSetComparisonMode('range')}>Range</Segment>
              <Segment active={props.comparisonMode() === 'step'} onClick={() => props.onSetComparisonMode('step')}>Single</Segment>
            </div>
            <div class="segmented">
              <Segment active={props.comparisonSource() === 'revision'} onClick={() => props.onSetComparisonSource('revision')}>Revision</Segment>
              <Segment active={props.comparisonSource() === 'snapshot'} onClick={() => props.onSetComparisonSource('snapshot')}>Snapshot</Segment>
            </div>
            <div class="segmented">
              <Segment active={props.layoutMode() === 'split'} onClick={() => props.onSetLayoutMode('split')}>Split</Segment>
              <Segment active={props.layoutMode() === 'unified'} onClick={() => props.onSetLayoutMode('unified')}>Unified</Segment>
            </div>
            <div class="segmented">
              <Segment active={props.contentMode() === 'diffs'} onClick={() => props.onSetContentMode('diffs')}>Diffs</Segment>
              <Segment active={props.contentMode() === 'full'} onClick={() => props.onSetContentMode('full')}>Whole file</Segment>
            </div>
            <button class={`toggle-chip${props.showIntermediateRevisions() ? ' active' : ''}`} type="button" onClick={props.onToggleIntermediate}>Show In-Between</button>
            <div class="segmented">
              <For each={(['year', '7d', '30d', '90d', 'all'] as TimelinePreset[])}>
                {(value) => <Segment active={props.preset() === value} onClick={() => props.onSetPreset(value)}>{presetLabels[value]}</Segment>}
              </For>
            </div>
          </div>
        </div>

        <div class="timeline-row">
          <button class="step-button" type="button" disabled={!props.canStepBackward()} onClick={() => props.onStep(-5)}>«</button>
          <button class="step-button" type="button" disabled={!props.canStepBackward()} onClick={() => props.onStep(-1)}>‹</button>
          <div class="timeline">
            <div class="selection-meta">Click an anchor or a sidebar entry to change the preview.</div>
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
              <For each={groupMonthLabels(props.visibleEntries())}>{(label) => <strong>{label}</strong>}</For>
            </div>
          </div>
          <button class="step-button" type="button" disabled={!props.canStepForward()} onClick={() => props.onStep(1)}>›</button>
          <button class="step-button" type="button" disabled={!props.canStepForward()} onClick={() => props.onStep(5)}>»</button>
        </div>

        <div class="step-status-row">
          <div class="step-status">{props.visibleEntries().length} visible revisions</div>
          <Show when={props.comparisonSource() === 'snapshot'}>
            <div class="loading-indicator">Snapshots loaded</div>
          </Show>
        </div>
      </div>
    </div>
  );
}

function Segment(props: { active: boolean; onClick: () => void; children: string }) {
  return <button class={`segment${props.active ? ' active' : ''}`} type="button" onClick={props.onClick}>{props.children}</button>;
}

function groupMonthLabels(entries: FileRevisionEntry[]): string[] {
  const labels = new Set<string>();
  entries.forEach((entry) => {
    if (entry.monthLabel) {
      labels.add(entry.monthLabel);
    }
  });
  return [...labels];
}