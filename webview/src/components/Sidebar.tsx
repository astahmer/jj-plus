import { For, Show } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { FileRevisionEntry } from '../types';

type SidebarProps = {
  entries: Accessor<FileRevisionEntry[]>;
  activeFromIndex: Accessor<number>;
  activeToIndex: Accessor<number>;
  onSelectEntry: (entryIndex: number) => void;
  onSearchInput: (value: string) => void;
  searchValue: Accessor<string>;
  fileCount: Accessor<number>;
};

export function Sidebar(props: SidebarProps) {
  return (
    <aside class="panel sidebar" id="sidebar">
      <div class="sidebar-head">
        <div class="sidebar-head-main">
          <div class="eyebrow">Revisions</div>
          <div class="sidebar-hint">{props.fileCount()} visible</div>
        </div>
        <button class="sidebar-head-action" type="button">Open diff</button>
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
            return (
              <button
                class={`history-item${!entry.touchesFile ? ' is-intermediate' : ''}${active() ? ' active' : ''}${inRange() ? ' in-range' : ''}`}
                type="button"
                onClick={() => props.onSelectEntry(entry.index)}
              >
                <div class="history-top">
                  <span class="history-primary">{entry.shortRevision}</span>
                  <span class="history-meta">{entry.relativeDate}</span>
                </div>
                <div class="history-meta">{entry.shortDate}</div>
                <div>{entry.description}</div>
                <Show when={entry.changeId}>
                  <div class="identifier">
                    <span class="identifier-prefix">{entry.changeId}</span>
                    <span class="identifier-suffix">/{entry.index}</span>
                  </div>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </aside>
  );
}