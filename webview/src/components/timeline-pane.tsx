import { Show, createMemo } from 'solid-js';
import { useTimelineContext } from '../timeline-context';
import { Combobox, type ComboboxOption } from './combobox';
import { TimelineControls } from './timeline-controls';
import { TimelineHotkeys } from './timeline-hotkeys';
import { TimelineRevisionPickers } from './timeline-revision-pickers';
import { TimelineTrack } from './timeline-track';

export function TimelinePane() {
  const { state, actions } = useTimelineContext();
  const fileOptions = createMemo(() => state.workspaceFiles().map((value) => ({ value } satisfies ComboboxOption)));
  const collapseLabel = createMemo(() => state.timelinePaneCollapsed() ? 'Expand' : 'Timeline only');
  const showStepStatusRow = createMemo(() => Boolean(state.stepStatus()) || state.showSnapshotStatus());

  return (
    <div class={`timeline-pane${state.timelinePaneCollapsed() ? ' is-collapsed' : ''}`} id="timelinePane">
      <div class="timeline-pane-head">
        <button
          class={`sidebar-toggle-button${state.sidebarCollapsed() ? ' is-collapsed' : ''}`}
          id="sidebarToggleButton"
          type="button"
          aria-label="Toggle sidebar"
          onClick={actions.toggleSidebar}
        >
          {state.sidebarCollapsed() ? '▸' : '◂'}
        </button>
        <div class="timeline-pane-title">
          <div class="eyebrow">Revision Timeline</div>
          <span class="version-badge">{state.version()}</span>
        </div>
        <div class="timeline-head-summary">
          <div class="range-label">{state.rangeLabel()}</div>
          <div class="range-subtitle">{state.rangeSubtitle()}</div>
        </div>
        <button class="collapse-button" id="toggleTimelinePaneButton" type="button" onClick={actions.toggleTimelinePane}>{collapseLabel()}</button>
      </div>

      <div class="diff-head" id="timelineChrome">
        <div class="diff-head-top">
          <div class="file-switcher-row">
            <Combobox
              id="fileSwitcher"
              inputClass="file-input"
              value={state.fileInputValue()}
              placeholder="Switch file..."
              options={fileOptions()}
              onCommit={actions.submitFile}
            />
          </div>
          <div class="head-actions">
            <button class="menu-button" id="toggleHotkeysButton" type="button" aria-label="Show hotkeys" onClick={actions.toggleHotkeys}>?</button>
            <div class="menu-wrap">
              <button class="menu-button" id="actionsButton" type="button" onClick={actions.toggleActionsMenu}>...</button>
              <div class={`menu${state.actionsMenuOpen() ? ' open' : ''}`} id="actionsMenu">
                <button class="menu-item" id="toggleSidebarAction" type="button" onClick={actions.toggleSidebarFromMenu}>{state.sidebarCollapsed() ? 'Show Sidebar' : 'Hide Sidebar'}</button>
                <button class="menu-item" id="openCurrentFileAction" type="button" onClick={actions.openCurrentFile}>Open File</button>
                <button class="menu-item" id="openEditorButton" type="button" onClick={actions.openEditorDiff}>Open diff</button>
                <button class="menu-item" id="openRangeFilesButton" type="button" onClick={actions.openSelectionDiffs}>Open diffs</button>
                <button class="menu-item" id="cancelActiveRequestAction" type="button" onClick={actions.cancelActiveRequest}>Cancel request</button>
                <button class="menu-item" id="refreshButton" type="button" onClick={actions.refreshTimeline}>Refresh</button>
                <button class="menu-item" id="resetPreferencesAction" type="button" onClick={actions.resetPreferences}>Reset preferences</button>
              </div>
            </div>
          </div>
        </div>

        <div class="timeline-head">
          <TimelineRevisionPickers />
          <TimelineControls />
        </div>

        <TimelineTrack />

        <Show when={showStepStatusRow()}>
          <div class="step-status-row">
            <Show when={state.stepStatus()}>
              <div class="step-status" id="stepStatus">{state.stepStatus()}</div>
            </Show>
            <Show when={state.showSnapshotStatus()}>
              <div class="loading-indicator" id="snapshotLoadingIndicator">{state.snapshotStatusLabel()}</div>
            </Show>
          </div>
        </Show>
      </div>

      <Show when={state.hotkeysOpen()}>
        <TimelineHotkeys />
      </Show>
    </div>
  );
}
