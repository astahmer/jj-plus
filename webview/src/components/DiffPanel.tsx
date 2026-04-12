import { For, Show } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { DiffPreview, FileRevisionEntry, LayoutMode } from '../types';
import type { ComparisonMode, ComparisonSource, ContentMode } from '../types';
import { collapseDiffRows } from '../timeline-model';
import { RevisionIdentifier } from './RevisionIdentifier';

type DiffPanelProps = {
  preview: Accessor<DiffPreview | null>;
  fromEntry: Accessor<FileRevisionEntry | undefined>;
  toEntry: Accessor<FileRevisionEntry | undefined>;
  layoutMode: Accessor<LayoutMode>;
  contentMode: Accessor<ContentMode>;
  comparisonMode: Accessor<ComparisonMode>;
  comparisonSource: Accessor<ComparisonSource>;
  diffFocusMode: Accessor<boolean>;
  onToggleDiffFocus: () => void;
};

const comparisonModeLabels: Record<ComparisonMode, string> = {
  range: 'Range',
  step: 'Single',
};

const comparisonSourceLabels: Record<ComparisonSource, string> = {
  revision: 'Revision',
  snapshot: 'Snapshot',
};

const contentModeLabels: Record<ContentMode, string> = {
  diffs: 'Diffs',
  full: 'Whole file',
};

export function DiffPanel(props: DiffPanelProps) {
  const title = () => {
    const fromEntry = props.fromEntry();
    const toEntry = props.toEntry();
    if (!fromEntry || !toEntry) {
      return null;
    }

    return (
      <>
        <RevisionIdentifier value={fromEntry.shortRevision} highlightPrefix={fromEntry.changeId} plain={fromEntry.isWorkingTree} />
        <span class="diff-title-arrow">→</span>
        <RevisionIdentifier value={toEntry.shortRevision} highlightPrefix={toEntry.changeId} plain={toEntry.isWorkingTree} />
      </>
    );
  };

  const displayRows = () => {
    const preview = props.preview();
    if (!preview) {
      return [];
    }

    if (props.contentMode() === 'full') {
      return preview.rows;
    }

    if (!preview.hasChanges) {
      return [];
    }

    return collapseDiffRows(preview.rows, 3);
  };

  const eyebrowLabel = () => {
    return `${props.layoutMode()} · ${contentModeLabels[props.contentMode()]} · ${comparisonModeLabels[props.comparisonMode()]} · ${comparisonSourceLabels[props.comparisonSource()]} preview`;
  };

  const emptyState = () => {
    const preview = props.preview();
    if (!preview) {
      return <div class="empty-diff">Loading diff…</div>;
    }

    if (props.contentMode() === 'diffs' && !preview.hasChanges) {
      return (
        <div class="empty-diff">
          <div>No textual changes in this selection.</div>
          <Show when={preview.nonTextualDetails?.length}>
            <div class="empty-diff-details">
              <For each={preview.nonTextualDetails || []}>{(detail) => <div>{detail}</div>}</For>
            </div>
          </Show>
        </div>
      );
    }

    return <div class="empty-diff">The file has no content at this revision.</div>;
  };

  return (
    <>
      <div class="timeline-resize-handle" id="timelineResizeHandle" />
      <div class="diff-content">
        <div class="diff-summary">
          <div class="diff-title-row">
            <div class="diff-summary-left">
              <div class="diff-title-block">
                <h3 class="diff-title" id="diffTitle"><Show when={title()} fallback={'No diff available'}>{title()}</Show></h3>
                <div class="diff-title-meta">{props.preview()?.subtitle || ''}</div>
              </div>
              <div class="diff-subtitle">{props.toEntry()?.description || ''}</div>
            </div>
            <div class="diff-actions">
              <div class="eyebrow diff-mode-eyebrow" id="diffModeEyebrow">{eyebrowLabel()}</div>
              <div class="history-stats">
                <Show when={props.preview()}>
                  <span class="stat stat--plus">+{props.preview()?.additions}</span>
                  <span class="stat stat--minus">−{props.preview()?.deletions}</span>
                  <span class="stat">{props.preview()?.hunkCount} hunks</span>
                </Show>
              </div>
              <button class="collapse-button" id="toggleDiffFocusButton" type="button" onClick={props.onToggleDiffFocus}>{props.diffFocusMode() ? 'Exit focus' : 'Focus diff'}</button>
            </div>
          </div>
        </div>
        <div class="diff-rows" id="diffRows" data-layout-mode={props.layoutMode()} data-content-mode={props.contentMode()}>
          <Show when={displayRows().length} fallback={emptyState()}>
            <For each={displayRows()}>
              {(row) => props.layoutMode() === 'split'
                ? <SplitRow row={row} />
                : <UnifiedRow row={row} />}
            </For>
          </Show>
        </div>
      </div>
    </>
  );
}

function UnifiedRow(props: { row: DiffPreview['rows'][number] }) {
  if (props.row.type === 'skip') {
    return <div class="diff-row diff-row--skip">{props.row.text}</div>;
  }

  return (
    <div class={`diff-row diff-row--${props.row.type}`}>
      <div class="cell" />
      <div class="cell">{props.row.leftNumber ?? ''}</div>
      <div class="cell">{props.row.rightNumber ?? ''}</div>
      <div class="cell"><pre>{props.row.text}</pre></div>
    </div>
  );
}

function SplitRow(props: { row: DiffPreview['rows'][number] }) {
  if (props.row.type === 'skip') {
    return <div class="split-row split-row--skip">{props.row.text}</div>;
  }

  const isRemove = props.row.type === 'remove';
  const isAdd = props.row.type === 'add';
  return (
    <div class={`split-row${isAdd || isRemove ? ' split-row--change' : ''}`}>
      <div class="split-cell split-number">{props.row.leftNumber ?? ''}</div>
      <div class={`split-cell split-code${isRemove ? ' split-code--left' : ''}`}><pre>{isAdd ? '' : props.row.text}</pre></div>
      <div class="split-cell split-number">{props.row.rightNumber ?? ''}</div>
      <div class={`split-cell split-code${isAdd ? ' split-code--right' : ''}`}><pre>{isRemove ? '' : props.row.text}</pre></div>
    </div>
  );
}
