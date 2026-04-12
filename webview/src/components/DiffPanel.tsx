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
  const activePreview = () => props.preview();
  const activeComparisonSource = () => activePreview()?.comparisonSource || props.comparisonSource();

  const title = () => {
    const preview = activePreview();
    const fromEntry = props.fromEntry();
    const toEntry = props.toEntry();
    if (!fromEntry || !toEntry) {
      return null;
    }

    if (activeComparisonSource() === 'snapshot') {
      return (
        <>
          <span>Snapshot </span>
          <RevisionIdentifier value={toEntry.shortRevision} highlightPrefix={toEntry.changeId} plain={toEntry.isWorkingTree} />
        </>
      );
    }

    if (!preview) {
      return 'Loading diff…';
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
    const preview = activePreview();
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
    return `${props.layoutMode()} · ${contentModeLabels[props.contentMode()]} · ${comparisonModeLabels[props.comparisonMode()]} · ${comparisonSourceLabels[activeComparisonSource()]}`;
  };

  const emptyState = () => {
    const preview = activePreview();
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
                <div class="diff-title-meta">{activePreview()?.subtitle || ''}</div>
              </div>
              <div class="diff-subtitle">{props.toEntry()?.description || ''}</div>
            </div>
            <div class="diff-actions">
              <div class="eyebrow diff-mode-eyebrow" id="diffModeEyebrow">{eyebrowLabel()}</div>
              <div class="history-stats">
                <Show when={activePreview()}>
                  <span class="stat stat--plus">+{activePreview()?.additions}</span>
                  <span class="stat stat--minus">−{activePreview()?.deletions}</span>
                  <span class="stat">{activePreview()?.hunkCount} hunks</span>
                </Show>
              </div>
              <button class="collapse-button" id="toggleDiffFocusButton" type="button" onClick={props.onToggleDiffFocus}>{props.diffFocusMode() ? 'Exit focus' : 'Focus diff'}</button>
            </div>
          </div>
        </div>
        <div class="diff-rows" id="diffRows" data-layout-mode={props.layoutMode()} data-content-mode={props.contentMode()}>
          <Show when={displayRows().length} fallback={emptyState()}>
            <Show
              when={props.layoutMode() === 'split'}
              fallback={<For each={displayRows()}>{(row) => <UnifiedRow row={row} />}</For>}
            >
              <For each={buildSplitRows(displayRows())}>{(row) => <SplitRow row={row} />}</For>
            </Show>
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

  const marker = props.row.type === 'add' ? '+' : props.row.type === 'remove' ? '-' : ' ';

  return (
    <div class={`diff-row diff-row--${props.row.type}`}>
      <div class="cell marker">{marker}</div>
      <div class="cell line-number">{props.row.leftNumber ?? ''}</div>
      <div class="cell line-number">{props.row.rightNumber ?? ''}</div>
      <div class="cell code">{props.row.text || ' '}</div>
    </div>
  );
}

type SplitDisplayRow =
  | { type: 'skip'; skip: DiffPreview['rows'][number] }
  | { type: 'context'; left: DiffPreview['rows'][number]; right: DiffPreview['rows'][number] }
  | { type: 'change'; left: DiffPreview['rows'][number] | null; right: DiffPreview['rows'][number] | null };

function SplitRow(props: { row: SplitDisplayRow }) {
  if (props.row.type === 'skip') {
    return <div class="split-row split-row--skip">{props.row.skip.text}</div>;
  }

  if (props.row.type === 'context') {
    return (
      <div class="split-row">
        <div class="split-cell split-number">{props.row.left.leftNumber ?? ''}</div>
        <div class="split-cell split-code">{props.row.left.text || ' '}</div>
        <div class="split-cell split-number">{props.row.right.rightNumber ?? ''}</div>
        <div class="split-cell split-code">{props.row.right.text || ' '}</div>
      </div>
    );
  }

  return (
    <div class="split-row split-row--change">
      <div class="split-cell split-number">{props.row.left?.leftNumber ?? ''}</div>
      <div class="split-cell split-code split-code--left">{props.row.left?.text || ' '}</div>
      <div class="split-cell split-number">{props.row.right?.rightNumber ?? ''}</div>
      <div class="split-cell split-code split-code--right">{props.row.right?.text || ' '}</div>
    </div>
  );
}

function buildSplitRows(rows: DiffPreview['rows']): SplitDisplayRow[] {
  const splitRows: SplitDisplayRow[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.type === 'skip') {
      splitRows.push({ type: 'skip', skip: row });
      continue;
    }

    if (row.type === 'context') {
      splitRows.push({ type: 'context', left: row, right: row });
      continue;
    }

    const leftRows: DiffPreview['rows'] = [];
    const rightRows: DiffPreview['rows'] = [];

    while (index < rows.length && rows[index].type === 'remove') {
      leftRows.push(rows[index]);
      index += 1;
    }

    while (index < rows.length && rows[index].type === 'add') {
      rightRows.push(rows[index]);
      index += 1;
    }

    index -= 1;

    const pairCount = Math.max(leftRows.length, rightRows.length);
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      splitRows.push({
        type: 'change',
        left: leftRows[pairIndex] || null,
        right: rightRows[pairIndex] || null,
      });
    }
  }

  return splitRows;
}
