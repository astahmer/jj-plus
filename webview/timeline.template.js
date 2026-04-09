(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.TimelineTemplate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function renderTimelineBodyHtml() {
    return `<div class="app">
      <section class="workspace" id="workspace">
        <aside class="panel sidebar" id="sidebar">
          <div class="sidebar-head">
            <div class="eyebrow">Revisions</div>
            <div class="sidebar-hint" id="sidebarHint"></div>
          </div>
          <div class="history-list" id="historyList"></div>
        </aside>
        <div class="resize-handle" id="resizeHandle"></div>
        <section class="panel diff-panel">
          <div class="timeline-pane" id="timelinePane">
            <div class="timeline-pane-head">
              <div class="eyebrow">Revision Timeline</div>
              <button class="collapse-button" id="toggleTimelinePaneButton" type="button">Timeline only</button>
            </div>
            <div class="diff-head" id="timelineChrome">
              <div class="diff-head-top">
                <div class="file-switcher-row">
                  <input class="file-input" id="fileSwitcher" list="workspaceFilesList" placeholder="Switch file..." autocomplete="off" />
                  <datalist id="workspaceFilesList"></datalist>
                </div>
                <div class="head-actions">
                  <div class="menu-wrap">
                    <button class="menu-button" id="actionsButton" type="button">...</button>
                    <div class="menu" id="actionsMenu">
                      <button class="menu-item" id="toggleSidebarAction" type="button">Hide Sidebar</button>
                      <button class="menu-item" id="openCurrentFileAction" type="button">Open File</button>
                      <button class="menu-item" id="openEditorButton" type="button">Open diff</button>
                      <button class="menu-item" id="openRangeFilesButton" type="button">Open diffs</button>
                      <button class="menu-item" id="refreshButton" type="button">Refresh</button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="timeline-head">
                <div class="revision-picker-row">
                  <input class="revision-input" id="fromRevisionInput" list="revisionOptionsList" placeholder="From revision" autocomplete="off" />
                  <span class="revision-arrow">&#8594;</span>
                  <input class="revision-input" id="toRevisionInput" list="revisionOptionsList" placeholder="To revision" autocomplete="off" />
                  <datalist id="revisionOptionsList"></datalist>
                </div>
                <div class="control-row">
                  <div class="segmented" id="comparisonModes"></div>
                  <div class="segmented" id="layoutModes"></div>
                  <div class="segmented" id="contentModes"></div>
                  <button class="toggle-chip" id="intermediateToggle" type="button">Show In-Between</button>
                  <div class="segmented" id="presets"></div>
                </div>
              </div>

              <div class="range-steps">
                <button class="step-button" id="stepBackwardButton" type="button" aria-label="Previous range">&#x2039;</button>
                <div class="step-center">
                  <div class="step-status" id="stepStatus">Range view</div>
                  <div class="handle-pills">
                    <button class="handle-pill from" id="fromHandleLabel" type="button">From</button>
                    <button class="handle-pill to" id="toHandleLabel" type="button">To</button>
                  </div>
                </div>
                <button class="step-button" id="stepForwardButton" type="button" aria-label="Next range">&#x203A;</button>
              </div>

              <div class="timeline">
                <div class="selection-meta" id="selectionMeta"></div>
                <div class="track" id="track"></div>
                <div class="range-fill" id="rangeFill"></div>
                <button class="handle-marker from" id="fromMarker" type="button" aria-label="Adjust from revision"></button>
                <button class="handle-marker to" id="toMarker" type="button" aria-label="Adjust to revision"></button>
                <div class="month-row" id="monthRow"></div>
              </div>

              <div class="range-summary">
                <div class="range-label" id="rangeLabel">Loading revisions...</div>
                <div class="range-subtitle" id="rangeSubtitle"></div>
              </div>
            </div>
          </div>
          <div class="timeline-resize-handle" id="timelineResizeHandle"></div>
          <div class="diff-content">
            <div class="diff-summary">
              <div class="diff-title-row">
                <div>
                  <div class="eyebrow" id="diffModeEyebrow">Diff</div>
                  <h3 class="diff-title" id="diffTitle">Loading diff...</h3>
                </div>
                <div class="diff-actions">
                  <div class="history-stats" id="diffStats"></div>
                  <button class="collapse-button" id="toggleDiffFocusButton" type="button">Focus diff</button>
                </div>
              </div>
              <div class="diff-subtitle" id="diffSubtitle"></div>
            </div>
            <div class="diff-rows" id="diffRows"></div>
          </div>
        </section>
      </section>
    </div>`;
  }

  function renderTimelineDocumentHtml(options) {
    const title = escapeHtml((options && options.title) || 'Revision Timeline');
    const styleHref = escapeAttribute((options && options.styleHref) || './timeline.css');
    const scriptSrc = escapeAttribute((options && options.scriptSrc) || './timeline.js');
    const cspSource = options && options.cspSource;

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
    <script src="${scriptSrc}"></script>
  </body>
</html>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  return {
    renderTimelineBodyHtml,
    renderTimelineDocumentHtml,
  };
});
