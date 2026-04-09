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
          <div class="diff-head">
            <div class="diff-head-top">
              <div class="file-switcher">
                <div class="eyebrow">Revision Timeline</div>
                <div class="file-switcher-row">
                  <div class="file-title" id="fileName">Loading...</div>
                  <div class="title-path" id="filePath"></div>
                </div>
                <input class="file-input" id="fileSwitcher" list="workspaceFilesList" placeholder="Switch file..." />
                <datalist id="workspaceFilesList"></datalist>
              </div>
              <div class="head-actions">
                <div class="menu-wrap">
                  <button class="menu-button" id="actionsButton" type="button">...</button>
                  <div class="menu" id="actionsMenu">
                    <button class="menu-item" id="toggleSidebarAction" type="button">Hide Sidebar</button>
                    <button class="menu-item" id="openCurrentFileAction" type="button">Open File</button>
                    <button class="menu-item" id="openEditorButton" type="button">Open File Range Diff</button>
                    <button class="menu-item" id="openRangeFilesButton" type="button">Open Range Files Diff</button>
                    <button class="menu-item" id="refreshButton" type="button">Refresh</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="timeline-head">
              <div>
                <div class="range-label" id="rangeLabel">Loading revisions...</div>
                <div class="range-subtitle" id="rangeSubtitle"></div>
              </div>
              <div class="control-row">
                <div class="segmented" id="layoutModes"></div>
                <div class="segmented" id="contentModes"></div>
                <div class="segmented" id="presets"></div>
              </div>
            </div>

            <div class="timeline">
              <div class="timeline-labels">
                <div class="handle-pills">
                  <span class="handle-pill from" id="fromHandleLabel">From</span>
                  <span class="handle-pill to" id="toHandleLabel">To</span>
                </div>
                <div class="selection-meta" id="selectionMeta"></div>
              </div>
              <div class="track"></div>
              <div class="range-fill" id="rangeFill"></div>
              <div class="selection-pill from" id="fromPill">From</div>
              <div class="selection-pill to" id="toPill">To</div>
              <div class="sliders">
                <input id="fromSlider" type="range" min="0" max="0" value="0" />
                <input id="toSlider" type="range" min="0" max="0" value="0" />
              </div>
              <div class="month-row" id="monthRow"></div>
            </div>

            <div class="diff-title-row">
              <div>
                <div class="eyebrow" id="diffModeEyebrow">Diff</div>
                <h3 class="diff-title" id="diffTitle">Loading diff...</h3>
              </div>
              <div class="history-stats" id="diffStats"></div>
            </div>
            <div class="diff-subtitle" id="diffSubtitle"></div>
          </div>
          <div class="diff-rows" id="diffRows"></div>
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
