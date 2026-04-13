import { Show, createMemo } from 'solid-js';
import { useTimelineContext } from '../timeline-context.tsx';
import { Combobox, type ComboboxOption } from './combobox.tsx';
import { TimelineControls } from './timeline-controls.tsx';
import { TimelineHotkeys } from './timeline-hotkeys.tsx';
import { TimelineRevisionPickers } from './timeline-revision-pickers.tsx';
import { TimelineTrack } from './timeline-track.tsx';

export function TimelinePane() {
	const { state, actions } = useTimelineContext();
	const fileOptions = createMemo(() => {
		if (state.fileSwitcherMode() === 'overview') {
			return state.rangeOverviewItems().map(
				(item) =>
					({
						value: item.relativePath,
						description: `${item.changeCount} touched ${item.changeCount === 1 ? 'revision' : 'revisions'}${item.isCurrentFile ? ' · current file' : ''}`,
					}) satisfies ComboboxOption,
			);
		}

		return state.workspaceFiles().map((value) => ({ value }) satisfies ComboboxOption);
	});
	const collapseLabel = createMemo(() => (state.timelinePaneCollapsed() ? 'Expand timeline' : 'Collapse timeline'));
	const showStepStatusRow = createMemo(() => Boolean(state.stepStatus()) || state.showSnapshotStatus());
	const fileSwitcherPlaceholder = createMemo(() =>
		state.fileSwitcherMode() === 'overview' ? 'Jump to a top-changed file...' : 'Switch file...',
	);
	const overviewSummary = createMemo(() => {
		if (state.fileSwitcherMode() !== 'overview') {
			return '';
		}

		if (state.rangeOverviewLoading()) {
			return 'Scanning selected revisions...';
		}

		const itemCount = state.rangeOverviewItems().length;
		if (!itemCount) {
			return 'No changed files in the current range';
		}

		return `${itemCount} ${itemCount === 1 ? 'file' : 'files'} in the current range`;
	});

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
				<button
					class="collapse-button"
					id="toggleTimelinePaneButton"
					type="button"
					onClick={actions.toggleTimelinePane}
				>
					{collapseLabel()}
				</button>
			</div>

			<div class="diff-head" id="timelineChrome">
				<div class="diff-head-top">
					<div class="file-switcher-row">
						<div class="file-switcher-toolbar">
							<div class="file-switcher-modes" role="tablist" aria-label="File switcher mode">
								<button
									class={`toggle-chip${state.fileSwitcherMode() === 'workspace' ? ' active' : ''}`}
									type="button"
									onClick={() => actions.setFileSwitcherMode('workspace')}
								>
									All files
								</button>
								<button
									class={`toggle-chip${state.fileSwitcherMode() === 'overview' ? ' active' : ''}`}
									type="button"
									onClick={() => actions.setFileSwitcherMode('overview')}
								>
									Top changed
								</button>
							</div>
							<Show when={state.fileSwitcherMode() === 'overview'}>
								<div class={`file-switcher-summary${state.rangeOverviewLoading() ? ' is-loading' : ''}`}>
									{overviewSummary()}
								</div>
							</Show>
						</div>
						<Combobox
							id="fileSwitcher"
							inputClass="file-input"
							value={state.fileInputValue()}
							placeholder={fileSwitcherPlaceholder()}
							options={fileOptions()}
							onCommit={actions.submitFile}
						/>
					</div>
					<div class="head-actions">
						<button
							class="menu-button"
							id="toggleHotkeysButton"
							type="button"
							aria-label="Show hotkeys"
							onClick={actions.toggleHotkeys}
						>
							?
						</button>
						<div class="menu-wrap">
							<button class="menu-button" id="actionsButton" type="button" onClick={actions.toggleActionsMenu}>
								...
							</button>
							<div class={`menu${state.actionsMenuOpen() ? ' open' : ''}`} id="actionsMenu">
								<button
									class="menu-item"
									id="toggleSidebarAction"
									type="button"
									onClick={actions.toggleSidebarFromMenu}
								>
									{state.sidebarCollapsed() ? 'Show Sidebar' : 'Hide Sidebar'}
								</button>
								<button class="menu-item" id="openCurrentFileAction" type="button" onClick={actions.openCurrentFile}>
									Open File
								</button>
								<button class="menu-item" id="openEditorButton" type="button" onClick={actions.openEditorDiff}>
									Open diff
								</button>
								<button class="menu-item" id="openRangeFilesButton" type="button" onClick={actions.openSelectionDiffs}>
									Open diffs
								</button>
								<button
									class="menu-item"
									id="cancelActiveRequestAction"
									type="button"
									onClick={actions.cancelActiveRequest}
								>
									Cancel request
								</button>
								<button class="menu-item" id="refreshButton" type="button" onClick={actions.refreshTimeline}>
									Refresh
								</button>
								<button class="menu-item" id="resetPreferencesAction" type="button" onClick={actions.resetPreferences}>
									Reset preferences
								</button>
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
							<div class="step-status" id="stepStatus">
								{state.stepStatus()}
							</div>
						</Show>
						<Show when={state.showSnapshotStatus()}>
							<div class="loading-indicator" id="snapshotLoadingIndicator">
								{state.snapshotStatusLabel()}
							</div>
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
