import { For, Show } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { FileRevisionEntry } from '../types';
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
};

export function Sidebar(props: SidebarProps) {
  return (
    <aside class="panel sidebar" id="sidebar">
      <div class="sidebar-head">
        <div class="sidebar-head-main">
          <div class="eyebrow">Revisions</div>
          <div class="sidebar-hint">{props.fileCount()} visible</div>
        </div>
        <button class="sidebar-head-action" type="button" onClick={props.onOpenRangeDiff}>Open diff</button>
      </div>
      <div class="sidebar-search-wrap">
        <input
          class="sidebar-search-input"
          type="search"
          placeholder="Search revisions"
          autocomplete="off"
          value={props.searchValue()}
          onInput={(event) => props.onSearchInput(event.currentTarget.value)}
        />
      </div>
      <div class="history-list">
        <For each={props.entries()}>
          {(entry) => {
            const active = () => entry.index === props.activeFromIndex() || entry.index === props.activeToIndex();
            const inRange = () => entry.index >= Math.min(props.activeFromIndex(), props.activeToIndex()) && entry.index <= Math.max(props.activeFromIndex(), props.activeToIndex());
            const pending = () => props.pendingAnchorIndex() === entry.index;
            const descriptionMeta = () => [entry.relativeDate, entry.authorName].filter(Boolean).join(' · ');
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
                    <RevisionIdentifier value={entry.shortRevision} highlightPrefix={entry.changeId} plain={entry.isWorkingTree} />
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
                  <Show when={entry.changeId}>
                    <span class="identifier">
                      <span class="identifier-prefix">{entry.changeId}</span>
                      <span class="identifier-suffix">/{entry.index}</span>
                    </span>
                  </Show>
                </div>
              </article>
            );
          }}
        </For>
      </div>
    </aside>
  );
}
