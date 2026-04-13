export type TimelineDocumentHtmlOptions = {
	title?: string;
	styleHref?: string;
	appSrc?: string;
	modelSrc?: string;
	scriptSrc?: string;
	cspSource?: string;
};

export function renderTimelineBodyHtml(): string {
	return `<div class="app">
      <section class="workspace" id="workspace">
        <aside class="panel sidebar" id="sidebar">
          <div class="sidebar-head">
            <div class="sidebar-head-main">
              <div class="eyebrow">Revisions</div>
              <div class="sidebar-hint" id="sidebarHint"></div>
            </div>
            <button class="sidebar-head-action" id="openSidebarRangeDiffButton" type="button">Open diff</button>
          </div>
          <div class="sidebar-search-wrap">
            <input class="sidebar-search-input" id="sidebarSearchInput" type="search" placeholder="Search revisions" autocomplete="off" />
          </div>
          <div class="history-list" id="historyList"></div>
        </aside>
        <div class="resize-handle" id="resizeHandle"></div>
        <section class="panel diff-panel">
          <div class="timeline-pane" id="timelinePane">
            <div class="timeline-pane-head">
              <button class="sidebar-toggle-button" id="sidebarToggleButton" type="button" aria-label="Toggle sidebar">&#x25C2;</button>
              <div class="timeline-pane-title">
                <div class="eyebrow">Revision Timeline</div>
                <span class="version-badge" id="timelineVersion"></span>
              </div>
              <div class="timeline-head-summary">
                <div class="range-label" id="rangeLabel">Loading revisions...</div>
                <div class="range-subtitle" id="rangeSubtitle"></div>
              </div>
              <button class="collapse-button" id="toggleTimelinePaneButton" type="button">Timeline only</button>
            </div>
            <div class="diff-head" id="timelineChrome">
              <div class="diff-head-top">
                <div class="file-switcher-row">
                  <input class="file-input" id="fileSwitcher" list="workspaceFilesList" placeholder="Switch file..." autocomplete="off" />
                  <datalist id="workspaceFilesList"></datalist>
                </div>
                <div class="head-actions">
                  <button class="menu-button" id="toggleHotkeysButton" type="button" aria-label="Show hotkeys">?</button>
                  <div class="menu-wrap">
                    <button class="menu-button" id="actionsButton" type="button">...</button>
                    <div class="menu" id="actionsMenu">
                      <button class="menu-item" id="toggleSidebarAction" type="button">Hide Sidebar</button>
                      <button class="menu-item" id="openCurrentFileAction" type="button">Open File</button>
                      <button class="menu-item" id="openEditorButton" type="button">Open diff</button>
                      <button class="menu-item" id="openRangeFilesButton" type="button">Open diffs</button>
                      <button class="menu-item" id="cancelActiveRequestAction" type="button">Cancel request</button>
                      <button class="menu-item" id="refreshButton" type="button">Refresh</button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="timeline-head">
                <div class="revision-picker-row">
                  <div class="revision-picker-col">
                    <input class="revision-input" id="fromRevisionInput" list="revisionOptionsList" placeholder="From revision" autocomplete="off" />
                    <div class="revision-picker-meta">
                      <button class="handle-pill from" id="fromHandleLabel" type="button">From</button>
                      <span class="revision-picker-relative" id="fromRelativeLabel"></span>
                    </div>
                  </div>
                  <span class="revision-arrow">&#8594;</span>
                  <div class="revision-picker-col">
                    <input class="revision-input" id="toRevisionInput" list="revisionOptionsList" placeholder="To revision" autocomplete="off" />
                    <div class="revision-picker-meta">
                      <button class="handle-pill to" id="toHandleLabel" type="button">To</button>
                      <span class="revision-picker-relative" id="toRelativeLabel"></span>
                    </div>
                  </div>
                  <datalist id="revisionOptionsList"></datalist>
                </div>
                <div class="control-row">
                  <div class="segmented" id="comparisonModes"></div>
                  <div class="segmented" id="comparisonSources"></div>
                  <div class="segmented" id="layoutModes"></div>
                  <div class="segmented" id="contentModes"></div>
                  <button class="toggle-chip" id="intermediateToggle" type="button">Show In-Between</button>
                  <div class="segmented" id="presets"></div>
                </div>
              </div>

              <div class="timeline-row">
                <button class="step-button" id="stepFastBackwardButton" type="button" aria-label="Jump backward">&#171;</button>
                <button class="step-button" id="stepBackwardButton" type="button" aria-label="Previous range">&#x2039;</button>
                <div class="timeline">
                  <div class="selection-meta" id="selectionMeta"></div>
                  <div class="track" id="track"></div>
                  <div class="range-fill" id="rangeFill"></div>
                  <button class="handle-marker from" id="fromMarker" type="button" aria-label="Adjust from revision"></button>
                  <button class="handle-marker to" id="toMarker" type="button" aria-label="Adjust to revision"></button>
                  <div class="month-row" id="monthRow"></div>
                </div>
                <button class="step-button" id="stepForwardButton" type="button" aria-label="Next range">&#x203A;</button>
                <button class="step-button" id="stepFastForwardButton" type="button" aria-label="Jump forward">&#187;</button>
              </div>

              <div class="step-status-row" id="stepStatusRow">
                <div class="step-status" id="stepStatus"></div>
                <div class="loading-indicator" id="snapshotLoadingIndicator" hidden>Loading snapshots&#8230;</div>
              </div>
            </div>
          </div>
          <div class="anchor-tooltip" id="anchorTooltip" hidden></div>
          <div class="timeline-resize-handle" id="timelineResizeHandle"></div>
          <div class="diff-content">
            <div class="diff-summary">
              <div class="diff-title-row">
                <div class="diff-summary-left">
                  <div class="diff-title-block">
                    <h3 class="diff-title" id="diffTitle">Loading diff...</h3>
                    <div class="diff-title-meta" id="diffTitleMeta"></div>
                  </div>
                  <div class="diff-subtitle" id="diffSubtitle"></div>
                </div>
                <div class="diff-actions">
                  <div class="eyebrow diff-mode-eyebrow" id="diffModeEyebrow">Diff</div>
                  <div class="history-stats" id="diffStats"></div>
                  <button class="collapse-button" id="toggleDiffFocusButton" type="button">Focus diff</button>
                </div>
              </div>
            </div>
            <div class="diff-rows" id="diffRows"></div>
          </div>
          <div class="hotkeys-popover" id="hotkeysPopover" hidden>
            <div class="hotkeys-card">
              <div class="hotkeys-head">
                <div>
                  <div style="display:flex;align-items:baseline;gap:6px;">
                    <div class="eyebrow">Shortcuts</div>
                    <div class="hotkeys-version" id="hotkeysVersion"></div>
                  </div>
                  <div class="hotkeys-subtitle">Range selection, sidebar navigation, and diff actions</div>
                </div>
                <button class="collapse-button" id="closeHotkeysButton" type="button">Close</button>
              </div>
              <div class="hotkeys-grid">
                <div class="hotkey-section">
                  <div class="hotkey-section-title">Selection</div>
                  <div class="hotkey-row"><span class="hotkey-label">Move range</span><span class="hotkey-value"><kbd>←</kbd><kbd>→</kbd></span></div>
                  <div class="hotkey-row"><span class="hotkey-label">Fast move range</span><span class="hotkey-value"><kbd>Shift</kbd><kbd>←</kbd><kbd>→</kbd></span></div>
                  <div class="hotkey-row"><span class="hotkey-label">Move range vertically</span><span class="hotkey-value"><kbd>↑</kbd><kbd>↓</kbd></span></div>
                  <div class="hotkey-row"><span class="hotkey-label">Adjust to marker</span><span class="hotkey-value"><kbd>Option</kbd><kbd>←</kbd><kbd>→</kbd></span></div>
                  <div class="hotkey-row"><span class="hotkey-label">Adjust from marker</span><span class="hotkey-value"><kbd>Ctrl</kbd><kbd>←</kbd><kbd>→</kbd></span></div>
                  <div class="hotkey-row"><span class="hotkey-label">Dock range to start/end</span><span class="hotkey-value"><kbd>Cmd</kbd><kbd>←</kbd><kbd>→</kbd></span></div>
                </div>
                <div class="hotkey-section">
                  <div class="hotkey-section-title">Actions</div>
                  <div class="hotkey-row"><span class="hotkey-label">Open cumulative diff</span><span class="hotkey-value"><kbd>Space</kbd></span></div>
                  <div class="hotkey-row"><span class="hotkey-label">Toggle help</span><span class="hotkey-value"><kbd>?</kbd></span></div>
                  <div class="hotkey-row"><span class="hotkey-label">Toggle sidebar</span><span class="hotkey-value"><kbd>B</kbd></span></div>
                  <div class="hotkey-row"><span class="hotkey-label">Pick range by click</span><span class="hotkey-note">Click one revision, then another</span></div>
                  <div class="hotkey-row"><span class="hotkey-label">Drag markers</span><span class="hotkey-note">Adjust range directly on the timeline</span></div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </section>
    </div>`;
}

export function renderTimelineDocumentHtml(options: TimelineDocumentHtmlOptions): string {
	const title = escapeHtml(options.title || 'Revision Timeline');
	const styleHref = escapeAttribute(options.styleHref || './timeline.css');
	const appSrc = escapeAttribute(options.appSrc || '');
	const modelSrc = escapeAttribute(options.modelSrc || '');
	const scriptSrc = escapeAttribute(options.scriptSrc || '');
	const cspSource = options.cspSource;

	if (appSrc) {
		return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    ${cspSource ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource}; script-src ${cspSource};" />` : ''}
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="stylesheet" href="${styleHref}" />
  </head>
  <body>
    <div id="timelineApp"></div>
    <script type="module" src="${appSrc}"></script>
  </body>
</html>`;
	}

	return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    ${cspSource ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource}; script-src ${cspSource};" />` : ''}
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="stylesheet" href="${styleHref}" />
  </head>
  <body>
    ${renderTimelineBodyHtml()}
    ${modelSrc ? `<script src="${modelSrc}"></script>` : ''}
    ${scriptSrc ? `<script src="${scriptSrc}"></script>` : ''}
  </body>
</html>`;
}

function escapeHtml(value: string): string {
	return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/"/g, '&quot;');
}
