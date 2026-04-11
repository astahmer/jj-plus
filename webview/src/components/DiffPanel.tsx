import { For, Show } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { DiffPreview, FileRevisionEntry, LayoutMode } from '../types';

type DiffPanelProps = {
  preview: Accessor<DiffPreview | null>;
  fromEntry: Accessor<FileRevisionEntry | undefined>;
  toEntry: Accessor<FileRevisionEntry | undefined>;
  layoutMode: Accessor<LayoutMode>;
};

export function DiffPanel(props: DiffPanelProps) {
  const title = () => {
    const fromEntry = props.fromEntry();
    const toEntry = props.toEntry();
    if (!fromEntry || !toEntry) {
      return 'No diff available';
    }
    return `${fromEntry.shortRevision} → ${toEntry.shortRevision}`;
  };

  return (
    <>
      <div class="timeline-resize-handle" id="timelineResizeHandle" />
      <div class="diff-content">
        <div class="diff-summary">
          <div class="diff-title-row">
            <div class="diff-summary-left">
              <div class="diff-title-block">
                <h3 class="diff-title" id="diffTitle">{title()}</h3>
                <div class="diff-title-meta">{props.preview()?.subtitle || ''}</div>
              </div>
              <div class="diff-subtitle">{props.toEntry()?.description || ''}</div>
            </div>
            <div class="diff-actions">
              <div class="eyebrow diff-mode-eyebrow">{props.layoutMode()} · preview</div>
              <div class="history-stats">
                <Show when={props.preview()}>
                  <span class="stat stat--plus">+{props.preview()?.additions}</span>
                  <span class="stat stat--minus">−{props.preview()?.deletions}</span>
                  <span class="stat">{props.preview()?.hunkCount} hunks</span>
                </Show>
              </div>
              <button class="collapse-button" type="button">Focus diff</button>
            </div>
          </div>
        </div>
        <div class="diff-rows" id="diffRows" data-layout-mode={props.layoutMode()}>
          <Show when={props.preview()} fallback={<div class="empty-diff">Loading diff…</div>}>
            <For each={props.preview()?.rows || []}>
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
