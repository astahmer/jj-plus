import { For, Show, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { DiffPreview, FileRevisionEntry, LayoutMode } from '../types';
import type { ComparisonMode, ComparisonSource, ContentMode } from '../types';
import { RevisionIdentifier, getRevisionIdentifierValue } from './RevisionIdentifier';

type DiffPanelProps = {
  preview: DiffPreview | null;
  fromEntry: FileRevisionEntry | undefined;
  toEntry: FileRevisionEntry | undefined;
  layoutMode: LayoutMode;
  contentMode: ContentMode;
  comparisonMode: ComparisonMode;
  comparisonSource: ComparisonSource;
  diffFocusMode: boolean;
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
  const [expandedRanges, setExpandedRanges] = createStore<Record<string, Record<string, boolean>>>({});
  const activePreview = createMemo(() => props.preview);
  const activeComparisonSource = createMemo<ComparisonSource>(() => activePreview()?.comparisonSource || props.comparisonSource);
  const activePreviewKey = createMemo(() => {
    const preview = activePreview();
    if (!preview) {
      return '';
    }

    return `${preview.comparisonSource || activeComparisonSource()}:${Math.min(preview.fromIndex, preview.toIndex)}:${Math.max(preview.fromIndex, preview.toIndex)}`;
  });

  const title = () => {
    const preview = activePreview();
    const fromEntry = props.fromEntry;
    const toEntry = props.toEntry;
    if (!fromEntry || !toEntry) {
      return null;
    }

    if (activeComparisonSource() === 'snapshot') {
      return (
        <>
          <span>Snapshot </span>
          <RevisionIdentifier value={getRevisionIdentifierValue(toEntry)} highlightPrefix={toEntry.changeId} plain={toEntry.isWorkingTree} />
        </>
      );
    }

    if (!preview) {
      return 'Loading diff…';
    }

    return (
      <>
        <RevisionIdentifier value={getRevisionIdentifierValue(fromEntry)} highlightPrefix={fromEntry.changeId} plain={fromEntry.isWorkingTree} />
        <span class="diff-title-arrow">→</span>
        <RevisionIdentifier value={getRevisionIdentifierValue(toEntry)} highlightPrefix={toEntry.changeId} plain={toEntry.isWorkingTree} />
      </>
    );
  };

  const displayRows = () => {
    const preview = activePreview();
    if (!preview) {
      return [];
    }

    if (props.contentMode === 'full') {
      return preview.rows;
    }

    if (!preview.hasChanges) {
      return [];
    }

    return collapseRowsForPreview(preview.rows, activePreviewKey(), expandedRanges, 3);
  };

  const eyebrowLabel = () => {
    return `${props.layoutMode} · ${contentModeLabels[props.contentMode]} · ${comparisonModeLabels[props.comparisonMode]} · ${comparisonSourceLabels[activeComparisonSource()]}`;
  };

  const emptyState = () => {
    const preview = activePreview();
    if (!preview) {
      return <div class="empty-diff">Loading diff…</div>;
    }

    if (props.contentMode === 'diffs' && !preview.hasChanges) {
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

  const toggleRange = (previewKey: string, rangeKey: string) => {
    if (!previewKey || !rangeKey) {
      return;
    }

    setExpandedRanges(previewKey, rangeKey, (value) => value !== true);
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
              <Show when={activeComparisonSource() === 'snapshot'}>
                <div class="diff-subtitle">{props.toEntry?.description || ''}</div>
              </Show>
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
              <button class="collapse-button" id="toggleDiffFocusButton" type="button" onClick={props.onToggleDiffFocus}>{props.diffFocusMode ? 'Exit focus' : 'Focus diff'}</button>
            </div>
          </div>
        </div>
        <div
          class="diff-rows"
          id="diffRows"
          data-layout-mode={props.layoutMode}
          data-content-mode={props.contentMode}
          onClick={(event) => {
            const button = (event.target as HTMLElement | null)?.closest('.skip-button') as HTMLButtonElement | null;
            if (!button) {
              return;
            }

            toggleRange(button.dataset.previewKey || '', button.dataset.rangeKey || '');
          }}
        >
          <Show when={displayRows().length} fallback={emptyState()}>
            <Show
              when={props.layoutMode === 'split'}
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
    return (
      <div class="diff-row diff-row--skip">
        <button class="skip-button" type="button" data-preview-key={props.row.previewKey || ''} data-range-key={props.row.rangeKey || ''}>{props.row.text}</button>
      </div>
    );
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
    return (
      <div class="split-row split-row--skip">
        <button class="skip-button" type="button" data-preview-key={props.row.skip.previewKey || ''} data-range-key={props.row.skip.rangeKey || ''}>{props.row.skip.text}</button>
      </div>
    );
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

function collapseRowsForPreview(
  rows: DiffPreview['rows'],
  previewKey: string,
  expandedRanges: Record<string, Record<string, boolean>>,
  contextSize: number,
) {
  const changeIndexes = rows
    .map((row, index) => (row.type === 'add' || row.type === 'remove' ? index : -1))
    .filter((index) => index >= 0);

  if (!changeIndexes.length) {
    return rows.slice(0, 80);
  }

  const ranges: Array<[number, number]> = [];
  for (const changeIndex of changeIndexes) {
    const start = Math.max(0, changeIndex - contextSize);
    const end = Math.min(rows.length - 1, changeIndex + contextSize);
    const previousRange = ranges[ranges.length - 1];
    if (!previousRange || start > previousRange[1] + 1) {
      ranges.push([start, end]);
      continue;
    }

    previousRange[1] = Math.max(previousRange[1], end);
  }

  const visible: DiffPreview['rows'] = [];
  let previousEnd = -1;
  for (const [start, end] of ranges) {
    visible.push(...buildCollapsedSection(rows, previousEnd + 1, start - 1, previewKey, expandedRanges));
    visible.push(...rows.slice(start, end + 1));
    previousEnd = end;
  }
  visible.push(...buildCollapsedSection(rows, previousEnd + 1, rows.length - 1, previewKey, expandedRanges));
  return visible;
}

function buildCollapsedSection(
  rows: DiffPreview['rows'],
  start: number,
  end: number,
  previewKey: string,
  expandedRanges: Record<string, Record<string, boolean>>,
) {
  if (end < start) {
    return [];
  }

  const rangeKey = `${start}:${end}`;
  const isExpanded = expandedRanges[previewKey]?.[rangeKey] === true;
  if (!isExpanded) {
    return [{
      type: 'skip' as const,
      leftNumber: null,
      rightNumber: null,
      text: `Show ${end - start + 1} unchanged lines`,
      rangeKey,
      previewKey,
    }];
  }

  return rows.slice(start, end + 1).concat([{
    type: 'skip' as const,
    leftNumber: null,
    rightNumber: null,
    text: `Hide ${end - start + 1} unchanged lines`,
    rangeKey,
    previewKey,
  }]);
}
