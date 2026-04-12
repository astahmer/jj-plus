import { For, Show, createSignal, onCleanup } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { DiffPreview, FileRevisionEntry } from '../types';
import { RevisionIdentifier, getRevisionIdentifierValue } from './RevisionIdentifier';

type SidebarProps = {
  entries: Accessor<FileRevisionEntry[]>;
  activeFromIndex: Accessor<number>;
  activeToIndex: Accessor<number>;
  pendingAnchorIndex: Accessor<number | null>;
  hoveredSelectionIndex: Accessor<number | null>;
  onSelectEntry: (entryIndex: number) => void;
  onHoverEntry: (entryIndex: number | null) => void;
  onSearchInput: (value: string) => void;
  searchValue: Accessor<string>;
  fileCount: Accessor<number>;
  oldestFirst: Accessor<boolean>;
  onToggleSortOrder: () => void;
  onOpenSelectionDiffs: () => void;
  onOpenRevisionFilesDiff: (entryIndex: number) => void;
  onOpenRevisionRemote: (entryIndex: number) => void;
  previewForEntry: (entryIndex: number) => DiffPreview | null;
  onShowTimestampTooltip: (event: MouseEvent, entry: FileRevisionEntry) => void;
  onHideTooltip: () => void;
};

export function Sidebar(props: SidebarProps) {
  const [copiedIdentifierKey, setCopiedIdentifierKey] = createSignal('');
  let copiedIdentifierTimer: number | undefined;

  onCleanup(() => {
    if (copiedIdentifierTimer) {
      window.clearTimeout(copiedIdentifierTimer);
    }
  });

  async function copyIdentifier(copyKey: string, copyValue: string) {
    if (!copyValue) {
      return;
    }

    try {
      await navigator.clipboard.writeText(copyValue);
    } catch {
      return;
    }

    setCopiedIdentifierKey(copyKey);
    if (copiedIdentifierTimer) {
      window.clearTimeout(copiedIdentifierTimer);
    }

    copiedIdentifierTimer = window.setTimeout(() => {
      setCopiedIdentifierKey('');
    }, 2000);
  }

  return (
    <aside class="panel sidebar" id="sidebar">
      <div class="sidebar-head">
        <div class="sidebar-head-main">
          <div class="eyebrow">Revisions</div>
          <div class="sidebar-hint" id="sidebarHint">{props.fileCount()} visible</div>
        </div>
        <div class="sidebar-head-actions">
          <button class="sidebar-icon-button" id="toggleSidebarOrderButton" type="button" aria-label={props.oldestFirst() ? 'Show newest revisions first' : 'Show oldest revisions first'} onClick={props.onToggleSortOrder}>{props.oldestFirst() ? '↓' : '↑'}</button>
          <button class="sidebar-head-action" id="openSidebarRangeDiffButton" type="button" onClick={props.onOpenSelectionDiffs}>Open selection diffs</button>
        </div>
      </div>
      <div class="sidebar-search-wrap">
        <input
          class="sidebar-search-input"
          id="sidebarSearchInput"
          type="search"
          placeholder="Search revisions"
          autocomplete="off"
          value={props.searchValue()}
          onInput={(event) => props.onSearchInput(event.currentTarget.value)}
        />
      </div>
      <div class="history-list" id="historyList">
        <Show when={props.entries().length} fallback={<div class="empty">{props.searchValue().trim() ? 'No revisions match the current search.' : 'No revisions in the current filter.'}</div>}>
          <For each={props.entries()}>
            {(entry) => {
              const isFrom = () => entry.index === props.activeFromIndex();
              const isTo = () => entry.index === props.activeToIndex();
              const inRange = () => entry.index >= Math.min(props.activeFromIndex(), props.activeToIndex()) && entry.index <= Math.max(props.activeFromIndex(), props.activeToIndex());
              const pending = () => props.pendingAnchorIndex() === entry.index;
              const preview = () => props.previewForEntry(entry.index);
              const inPendingRange = () => {
                const pendingIndex = props.pendingAnchorIndex();
                const hoveredIndex = props.hoveredSelectionIndex();
                if (pendingIndex === null || hoveredIndex === null) {
                  return false;
                }

                return entry.index >= Math.min(pendingIndex, hoveredIndex) && entry.index <= Math.max(pendingIndex, hoveredIndex);
              };
              const copyKey = `primary:${entry.id}`;
              const primaryCopyValue = entry.operationId || entry.revision || entry.shortRevision;
              const primaryContent = () => copiedIdentifierKey() === copyKey
                ? 'Copied!'
                : entry.operationId
                  ? <span class="identifier"><span class="identifier-plain">{entry.operationId}</span></span>
                  : <RevisionIdentifier value={getRevisionIdentifierValue(entry)} highlightPrefix={entry.changeId} plain={entry.isWorkingTree} />;
              const operationCopyKey = `operation-key:${entry.id}`;

              return (
                <article
                  class={`history-item${!entry.touchesFile ? ' is-intermediate' : ''}${inRange() ? ' in-range' : ''}${pending() ? ' pending-anchor' : ''}${inPendingRange() ? ' pending-range' : ''}${isFrom() ? ' is-from' : ''}${isTo() ? ' is-to' : ''}`}
                  data-entry-index={entry.index}
                  tabindex="0"
                  onClick={() => props.onSelectEntry(entry.index)}
                  onMouseEnter={() => props.onHoverEntry(entry.index)}
                  onMouseLeave={() => props.onHoverEntry(null)}
                  onFocus={() => props.onHoverEntry(entry.index)}
                  onBlur={() => props.onHoverEntry(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      props.onSelectEntry(entry.index);
                    }
                  }}
                >
                  <div class="history-top">
                    <div class="history-primary">
                      <button
                        class="history-id-button"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void copyIdentifier(copyKey, primaryCopyValue);
                        }}
                      >
                        {primaryContent()}
                      </button>
                      <Show when={entry.operationKey}>
                        <button
                          class="mini-badge other mini-badge-copy"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void copyIdentifier(operationCopyKey, entry.operationKey || '');
                          }}
                        >
                          <Show when={copiedIdentifierKey() === operationCopyKey} fallback={<RevisionIdentifier value={entry.operationKey || ''} highlightPrefix={entry.changeId} />}>
                            Copied!
                          </Show>
                        </button>
                      </Show>
                      <Show when={!entry.touchesFile}>
                        <span class="mini-badge other">OTHER</span>
                      </Show>
                      <Show when={isFrom()}>
                        <span class="mini-badge from">FROM</span>
                      </Show>
                      <Show when={isTo()}>
                        <span class="mini-badge to">TO</span>
                      </Show>
                    </div>
                    <div class="history-actions">
                      <span
                        class="history-date-trigger"
                        onMouseEnter={(event) => props.onShowTimestampTooltip(event, entry)}
                        onMouseLeave={props.onHideTooltip}
                      >
                        {entry.shortDate}
                      </span>
                    <Show when={entry.remoteUrl}>
                      <button
                        class="history-action history-action-remote"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onOpenRevisionRemote(entry.index);
                        }}
                      >
                        Remote
                      </button>
                    </Show>
                    <Show when={entry.hasPreviousEntry}>
                      <button
                        class="history-action history-action-diff"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onOpenRevisionFilesDiff(entry.index);
                        }}
                      >
                        Open diffs
                      </button>
                    </Show>
                  </div>
                </div>
                <div class="history-description">{entry.description}</div>
                <div class="history-bottom">
                    <span class="history-meta">
                      <span
                        class="history-meta-timestamp"
                        onMouseEnter={(event) => props.onShowTimestampTooltip(event, entry)}
                        onMouseLeave={props.onHideTooltip}
                      >
                        {entry.relativeDate}
                      </span>
                      <Show when={entry.authorName}>
                        <span> · {entry.authorName}</span>
                      </Show>
                    </span>
                    <span class="history-stats">
                      <Show when={preview()}>
                        <Show when={preview()!.hasChanges} fallback={<span class="stat">No text</span>}>
                          <span class="stat stat--plus">+{preview()!.additions}</span>
                          <span class="stat stat--minus">-{preview()!.deletions}</span>
                        </Show>
                      </Show>
                    </span>
                  </div>
                </article>
              );
            }}
          </For>
        </Show>
      </div>
    </aside>
  );
}
