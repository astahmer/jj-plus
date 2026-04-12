import { For, Show } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { DiffPreview, FileRevisionEntry } from '../types';
import { RevisionIdentifier } from './RevisionIdentifier';

type SidebarProps = {
  entries: Accessor<FileRevisionEntry[]>;
  activeFromIndex: Accessor<number>;
  activeToIndex: Accessor<number>;
  pendingAnchorIndex: Accessor<number | null>;
  onSelectEntry: (entryIndex: number) => void;
  onSearchInput: (value: string) => void;
  searchValue: Accessor<string>;
  fileCount: Accessor<number>;
  onOpenRangeDiff: () => void;
  onOpenRevisionFilesDiff: (entryIndex: number) => void;
  onOpenRevisionRemote: (entryIndex: number) => void;
  previewForEntry: (entryIndex: number) => DiffPreview | null;
};

export function Sidebar(props: SidebarProps) {
  return (
    <aside class="panel sidebar" id="sidebar">
      <div class="sidebar-head">
        <div class="sidebar-head-main">
          <div class="eyebrow">Revisions</div>
          <div class="sidebar-hint" id="sidebarHint">{props.fileCount()} visible</div>
        </div>
        <button class="sidebar-head-action" id="openSidebarRangeDiffButton" type="button" onClick={props.onOpenRangeDiff}>Open diff</button>
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
            const active = () => entry.index === props.activeFromIndex() || entry.index === props.activeToIndex();
            const isFrom = () => entry.index === props.activeFromIndex();
            const isTo = () => entry.index === props.activeToIndex();
            const inRange = () => entry.index >= Math.min(props.activeFromIndex(), props.activeToIndex()) && entry.index <= Math.max(props.activeFromIndex(), props.activeToIndex());
            const pending = () => props.pendingAnchorIndex() === entry.index;
            const descriptionMeta = () => [entry.relativeDate, entry.authorName].filter(Boolean).join(' · ');
            const preview = () => props.previewForEntry(entry.index);
            return (
              <article
                class={`history-item${!entry.touchesFile ? ' is-intermediate' : ''}${active() ? ' active' : ''}${inRange() ? ' in-range' : ''}${pending() ? ' pending-anchor' : ''}`}
                data-entry-index={entry.index}
                tabindex="0"
                onClick={() => props.onSelectEntry(entry.index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    props.onSelectEntry(entry.index);
                  }
                }}
              >
                <div class="history-top">
                  <div class="history-primary">
                    <span class="history-id-button">
                      <Show
                        when={entry.operationId}
                        fallback={<RevisionIdentifier value={entry.shortRevision} highlightPrefix={entry.changeId} plain={entry.isWorkingTree} />}
                      >
                        <span class="identifier">
                          <span class="identifier-plain">{entry.operationId}</span>
                        </span>
                      </Show>
                    </span>
                    <Show when={entry.operationKey}>
                      <span class="mini-badge other mini-badge-copy">
                        <RevisionIdentifier value={entry.operationKey || ''} highlightPrefix={entry.changeId} />
                      </span>
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
                    <span>{entry.shortDate}</span>
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
                  <span class="history-meta">{descriptionMeta()}</span>
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
