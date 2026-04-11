(function () {
  const timelineModel = globalThis.TimelineModel;
  const vscode = typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : {
        postMessage(message) {
          if (typeof window.__TIMELINE_DEV_BRIDGE__ === 'function') {
            window.__TIMELINE_DEV_BRIDGE__(message);
          }
        },
      };

  const state = {
    data: null,
    preview: null,
    previewByRange: {},
    preset: 'year',
    visibleEntries: [],
    fromIndex: 0,
    toIndex: 0,
    previewFromIndex: 0,
    previewToIndex: 0,
    layoutMode: 'split',
    contentMode: 'diffs',
    comparisonMode: 'range',
    comparisonSource: 'revision',
    sidebarWidth: 280,
    sidebarCollapsed: false,
    timelinePaneHeight: 278,
    timelinePaneCollapsed: false,
    expandedDescriptions: {},
    expandedRanges: {},
    previewTimer: undefined,
    persistTimer: undefined,
    menuOpen: false,
    hotkeysOpen: false,
    sidebarPreviewQueue: [],
    sidebarPreviewInFlightKey: '',
    compactViewport: false,
    sidebarShownOnCompact: false,
    showIntermediateRevisions: false,
    focusedHistoryOrderIndex: -1,
    diffFocusMode: false,
    pendingRangeResolutionKey: '',
    sidebarSearchQuery: '',
    pendingSidebarAnchorIndex: null,
    snapshotHydrationInFlight: false,
    copiedIdentifierKey: '',
    copiedIdentifierTimer: undefined,
  };

  const elements = {
    workspace: document.getElementById('workspace'),
    resizeHandle: document.getElementById('resizeHandle'),
    timelinePane: document.getElementById('timelinePane'),
    timelineChrome: document.getElementById('timelineChrome'),
    timelineResizeHandle: document.getElementById('timelineResizeHandle'),
    toggleTimelinePaneButton: document.getElementById('toggleTimelinePaneButton'),
    toggleDiffFocusButton: document.getElementById('toggleDiffFocusButton'),
    fileSwitcher: document.getElementById('fileSwitcher'),
    workspaceFilesList: document.getElementById('workspaceFilesList'),
    fromRevisionInput: document.getElementById('fromRevisionInput'),
    toRevisionInput: document.getElementById('toRevisionInput'),
    revisionOptionsList: document.getElementById('revisionOptionsList'),
    actionsButton: document.getElementById('actionsButton'),
    actionsMenu: document.getElementById('actionsMenu'),
    toggleSidebarAction: document.getElementById('toggleSidebarAction'),
    sidebarSearchInput: document.getElementById('sidebarSearchInput'),
    openSidebarRangeDiffButton: document.getElementById('openSidebarRangeDiffButton'),
    openCurrentFileAction: document.getElementById('openCurrentFileAction'),
    openRangeFilesButton: document.getElementById('openRangeFilesButton'),
    cancelActiveRequestAction: document.getElementById('cancelActiveRequestAction'),
    openEditorButton: document.getElementById('openEditorButton'),
    refreshButton: document.getElementById('refreshButton'),
    toggleHotkeysButton: document.getElementById('toggleHotkeysButton'),
    hotkeysPopover: document.getElementById('hotkeysPopover'),
    closeHotkeysButton: document.getElementById('closeHotkeysButton'),
    timelineVersion: document.getElementById('timelineVersion'),
    hotkeysVersion: document.getElementById('hotkeysVersion'),
    rangeLabel: document.getElementById('rangeLabel'),
    rangeSubtitle: document.getElementById('rangeSubtitle'),
    rangeFill: document.getElementById('rangeFill'),
    fromMarker: document.getElementById('fromMarker'),
    toMarker: document.getElementById('toMarker'),
    fromHandleLabel: document.getElementById('fromHandleLabel'),
    toHandleLabel: document.getElementById('toHandleLabel'),
    fromRelativeLabel: document.getElementById('fromRelativeLabel'),
    toRelativeLabel: document.getElementById('toRelativeLabel'),
    track: document.getElementById('track'),
    monthRow: document.getElementById('monthRow'),
    sidebarHint: document.getElementById('sidebarHint'),
    historyList: document.getElementById('historyList'),
    presets: document.getElementById('presets'),
    comparisonModes: document.getElementById('comparisonModes'),
    comparisonSources: document.getElementById('comparisonSources'),
    layoutModes: document.getElementById('layoutModes'),
    contentModes: document.getElementById('contentModes'),
    intermediateToggle: document.getElementById('intermediateToggle'),
    stepFastBackwardButton: document.getElementById('stepFastBackwardButton'),
    stepBackwardButton: document.getElementById('stepBackwardButton'),
    stepForwardButton: document.getElementById('stepForwardButton'),
    stepFastForwardButton: document.getElementById('stepFastForwardButton'),
    sidebarToggleButton: document.getElementById('sidebarToggleButton'),
    anchorTooltip: document.getElementById('anchorTooltip'),
    stepStatus: document.getElementById('stepStatus'),
    snapshotLoadingIndicator: document.getElementById('snapshotLoadingIndicator'),
    diffModeEyebrow: document.getElementById('diffModeEyebrow'),
    diffTitle: document.getElementById('diffTitle'),
    diffTitleMeta: document.getElementById('diffTitleMeta'),
    diffSubtitle: document.getElementById('diffSubtitle'),
    diffStats: document.getElementById('diffStats'),
    selectionMeta: document.getElementById('selectionMeta'),
    diffRows: document.getElementById('diffRows'),
  };

  const presetLabels = {
    year: 'This year',
    '7d': 'Last 7D',
    '30d': '30D',
    '90d': '90D',
    all: 'All',
  };

  const layoutModeLabels = {
    split: 'Split',
    unified: 'Unified',
  };

  const contentModeLabels = {
    diffs: 'Diffs',
    full: 'Whole file',
  };

  const comparisonModeLabels = {
    range: 'Range',
    step: 'Single',
  };

  const comparisonSourceLabels = {
    revision: 'Revision',
    snapshot: 'Snapshot',
  };

  const compactViewportQuery = window.matchMedia('(max-width: 980px)');

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'timeline-data') {
      state.data = message.payload;
      applyPreferences(message.payload.preferences || {});
      state.preview = null;
      state.previewByRange = {};
      state.sidebarPreviewQueue = [];
      state.sidebarPreviewInFlightKey = '';
      state.expandedRanges = {};
      state.sidebarSearchQuery = '';
      state.pendingSidebarAnchorIndex = null;
      state.snapshotHydrationInFlight = false;
      elements.sidebarSearchInput.value = '';
      elements.timelineVersion.textContent = message.payload.version ? 'v' + message.payload.version : '';
      elements.hotkeysVersion.textContent = message.payload.version ? 'Version ' + message.payload.version : '';

      if (!state.data.entries.length) {
        renderEmpty();
        return;
      }

      state.fromIndex = Math.max(0, state.data.defaultIndex - 1);
      state.toIndex = state.data.defaultIndex || 0;
      elements.fileSwitcher.value = state.data.relativePath;
      syncViewportState(true);
      applySidebarState();
      applyTimelinePaneState();
      renderWorkspaceFiles();
      renderRevisionOptions();
      renderControlGroups();
      applyPreset(state.preset, true, true);
      requestPreview(0);
      return;
    }

    if (message && message.type === 'snapshot-entries') {
      if (!state.data) {
        return;
      }

      const currentSourceEntries = getSourceEntries();
      const selectedFromEntryId = currentSourceEntries[state.fromIndex] ? currentSourceEntries[state.fromIndex].id : null;
      const selectedToEntryId = currentSourceEntries[state.toIndex] ? currentSourceEntries[state.toIndex].id : null;

      state.data.snapshotEntries = message.payload.snapshotEntries || [];
      state.data.snapshotState = message.payload.snapshotState || { loadedChangeIds: [] };
      state.snapshotHydrationInFlight = false;

      if (state.comparisonSource === 'snapshot') {
        const nextSourceEntries = getSourceEntries();
        const nextFromIndex = selectedFromEntryId
          ? nextSourceEntries.findIndex((entry) => entry.id === selectedFromEntryId)
          : -1;
        const nextToIndex = selectedToEntryId
          ? nextSourceEntries.findIndex((entry) => entry.id === selectedToEntryId)
          : -1;

        if (nextFromIndex >= 0) {
          state.fromIndex = nextFromIndex;
        }
        if (nextToIndex >= 0) {
          state.toIndex = nextToIndex;
        }

        state.preview = null;
        state.previewByRange = {};
        applyPreset(state.preset, false, true, true);
        requestPreview(0);
        requestSnapshotHydration();
      }
      return;
    }

    if (message && message.type === 'resolved-range') {
      state.pendingRangeResolutionKey = '';
      if (!message.payload) {
        return;
      }

      state.fromIndex = message.payload.fromIndex;
      state.toIndex = message.payload.toIndex;
      renderSelection();
      requestPreview(0);
      return;
    }

    if (!message || message.type !== 'diff-preview') {
      return;
    }

    const previewSource = message.payload.comparisonSource || getEffectiveComparisonSource();
    const previewKey = getPreviewKey(
      message.payload.fromIndex,
      message.payload.toIndex,
      previewSource
    );

    state.previewByRange[previewKey] = message.payload;
    if (state.sidebarPreviewInFlightKey === previewKey) {
      state.sidebarPreviewInFlightKey = '';
    }

    if (
      message.payload.fromIndex !== state.previewFromIndex
      || message.payload.toIndex !== state.previewToIndex
      || previewSource !== getEffectiveComparisonSource()
    ) {
      pumpSidebarPreviewQueue();
      return;
    }

    state.preview = message.payload;

    if (
      !state.showIntermediateRevisions
      && state.comparisonMode === 'range'
      && !message.payload.hasChanges
      && state.fromIndex !== state.toIndex
    ) {
      maybeResolveHiddenRangeToNonEmpty(message.payload);
      return;
    }

    renderPreview();
    renderHistoryList();
    pumpSidebarPreviewQueue();
  });

  elements.stepBackwardButton.addEventListener('click', () => {
    navigateSelection(-1);
  });

  elements.stepFastBackwardButton.addEventListener('click', () => {
    navigateSelection(-5);
  });

  elements.stepForwardButton.addEventListener('click', () => {
    navigateSelection(1);
  });

  elements.stepFastForwardButton.addEventListener('click', () => {
    navigateSelection(5);
  });

  elements.actionsButton.addEventListener('click', (event) => {
    event.stopPropagation();
    state.menuOpen = !state.menuOpen;
    renderMenu();
  });

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;

    if (state.menuOpen && (!target || !target.closest('.menu-wrap'))) {
      state.menuOpen = false;
      renderMenu();
    }

    if (state.hotkeysOpen && (!target || !target.closest('.hotkeys-card') && !target.closest('#toggleHotkeysButton'))) {
      state.hotkeysOpen = false;
      renderHotkeysPopover();
    }
  });

  document.addEventListener('keydown', handleGlobalKeydown);

  elements.sidebarSearchInput.addEventListener('input', () => {
    state.sidebarSearchQuery = String(elements.sidebarSearchInput.value || '').trim().toLowerCase();
    state.focusedHistoryOrderIndex = -1;
    renderHistoryList();
  });

  elements.openEditorButton.addEventListener('click', () => {
    closeMenu();
    postRangeAction('open-editor-diff');
  });

  elements.openCurrentFileAction.addEventListener('click', () => {
    closeMenu();
    vscode.postMessage({ command: 'open-current-file' });
  });

  elements.openRangeFilesButton.addEventListener('click', () => {
    closeMenu();
    postRangeAction('open-range-files-diff');
  });

  elements.openSidebarRangeDiffButton.addEventListener('click', () => {
    postRangeAction('open-range-files-diff');
  });

  elements.refreshButton.addEventListener('click', () => {
    closeMenu();
    vscode.postMessage({ command: 'refresh' });
  });

  elements.cancelActiveRequestAction.addEventListener('click', () => {
    closeMenu();
    vscode.postMessage({ command: 'cancel-active-request' });
  });

  elements.toggleHotkeysButton.addEventListener('click', (event) => {
    event.stopPropagation();
    state.hotkeysOpen = !state.hotkeysOpen;
    renderHotkeysPopover();
  });

  elements.closeHotkeysButton.addEventListener('click', () => {
    state.hotkeysOpen = false;
    renderHotkeysPopover();
  });

  function toggleSidebar() {
    if (state.compactViewport) {
      const nextCollapsed = !getSidebarCollapsed();
      state.sidebarCollapsed = false;
      state.sidebarShownOnCompact = !nextCollapsed;
    } else {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    }
    applySidebarState();
    persistPreferences();
  }

  elements.toggleSidebarAction.addEventListener('click', () => {
    closeMenu();
    toggleSidebar();
  });

  elements.sidebarToggleButton.addEventListener('click', () => {
    toggleSidebar();
  });

  elements.toggleTimelinePaneButton.addEventListener('click', () => {
    state.timelinePaneCollapsed = !state.timelinePaneCollapsed;
    applyTimelinePaneState();
    persistPreferences();
  });

  elements.toggleDiffFocusButton.addEventListener('click', () => {
    state.diffFocusMode = !state.diffFocusMode;
    applyDiffFocusState();
  });

  elements.fileSwitcher.addEventListener('change', submitFileSwitch);
  elements.fileSwitcher.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submitFileSwitch();
    }
  });

  elements.fromRevisionInput.addEventListener('change', () => submitRevisionInput('from'));
  elements.toRevisionInput.addEventListener('change', () => submitRevisionInput('to'));
  elements.fromRevisionInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submitRevisionInput('from');
    }
  });
  elements.toRevisionInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submitRevisionInput('to');
    }
  });

  elements.fromHandleLabel.addEventListener('click', () => {
    scrollSidebarToEntry(state.fromIndex, true);
  });

  elements.toHandleLabel.addEventListener('click', () => {
    scrollSidebarToEntry(state.toIndex, true);
  });

  elements.resizeHandle.addEventListener('pointerdown', (event) => {
    if (state.compactViewport || getSidebarCollapsed()) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = state.sidebarWidth;
    elements.resizeHandle.classList.add('is-dragging');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    function onPointerMove(moveEvent) {
      const delta = moveEvent.clientX - startX;
      state.sidebarWidth = Math.max(180, Math.min(420, startWidth + delta));
      applySidebarState();
    }

    function onPointerUp() {
      elements.resizeHandle.classList.remove('is-dragging');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      persistPreferences();
    }
  });

  elements.timelineResizeHandle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = state.timelinePaneCollapsed ? 196 : state.timelinePaneHeight;
    if (state.timelinePaneCollapsed) {
      state.timelinePaneCollapsed = false;
      state.timelinePaneHeight = startHeight;
      applyTimelinePaneState();
    }
    elements.timelineResizeHandle.classList.add('is-dragging');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    function onPointerMove(moveEvent) {
      const delta = moveEvent.clientY - startY;
      state.timelinePaneHeight = Math.max(196, Math.min(420, startHeight + delta));
      applyTimelinePaneState();
    }

    function onPointerUp() {
      elements.timelineResizeHandle.classList.remove('is-dragging');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      persistPreferences();
    }
  });

  elements.rangeFill.addEventListener('pointerdown', (event) => {
    beginRangeDrag(event);
  });

  elements.track.addEventListener('pointerdown', (event) => {
    const pointerIndex = getVisibleIndexFromClientX(event.clientX);
    if (pointerIndex < 0) {
      return;
    }

    const fromVisibleIndex = getVisibleIndexForAbsoluteIndex(state.fromIndex);
    const toVisibleIndex = getVisibleIndexForAbsoluteIndex(state.toIndex);
    if (pointerIndex >= Math.min(fromVisibleIndex, toVisibleIndex) && pointerIndex <= Math.max(fromVisibleIndex, toVisibleIndex)) {
      beginRangeDrag(event);
    }
  });

  elements.fromMarker.addEventListener('pointerdown', (event) => {
    beginMarkerDrag('from', event);
  });

  elements.toMarker.addEventListener('pointerdown', (event) => {
    beginMarkerDrag('to', event);
  });

  elements.intermediateToggle.addEventListener('click', () => {
    if (!state.data || !state.data.hasIntermediateRevisions) {
      return;
    }
    state.showIntermediateRevisions = !state.showIntermediateRevisions;
    renderControlGroups();
    applyPreset(state.preset, false);
  });

  if (typeof compactViewportQuery.addEventListener === 'function') {
    compactViewportQuery.addEventListener('change', () => syncViewportState(false));
  } else if (typeof compactViewportQuery.addListener === 'function') {
    compactViewportQuery.addListener(() => syncViewportState(false));
  }

  function handleGlobalKeydown(event) {
    if (!state.data || event.defaultPrevented) {
      return;
    }

    const tagName = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : '';
    if (tagName === 'input' || tagName === 'textarea') {
      return;
    }

    const commandPressed = event.metaKey || event.ctrlKey;
    const jumpAmount = event.shiftKey ? 5 : 1;

    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      postRangeAction('open-range-files-diff', {
        fromIndex: state.fromIndex,
        toIndex: state.toIndex,
      });
      return;
    }

    if (event.key === '?') {
      event.preventDefault();
      state.hotkeysOpen = !state.hotkeysOpen;
      renderHotkeysPopover();
      return;
    }

    if (event.key === 'Escape' && state.hotkeysOpen) {
      event.preventDefault();
      state.hotkeysOpen = false;
      renderHotkeysPopover();
      return;
    }

    if (event.metaKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      moveRangeToVisibleEdge('start');
      return;
    }

    if (event.metaKey && event.key === 'ArrowRight') {
      event.preventDefault();
      moveRangeToVisibleEdge('end');
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (event.altKey) {
        nudgeRangeBoundary('to', -jumpAmount);
      } else if (event.ctrlKey) {
        nudgeRangeBoundary('from', -jumpAmount);
      } else {
      navigateSelection(-jumpAmount);
      }
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (event.altKey) {
        nudgeRangeBoundary('to', jumpAmount);
      } else if (event.ctrlKey) {
        nudgeRangeBoundary('from', jumpAmount);
      } else {
      navigateSelection(jumpAmount);
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      navigateSelection(-jumpAmount);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      navigateSelection(jumpAmount);
    }
  }

  function renderControlGroups() {
    renderSegmentedControl(elements.comparisonModes, comparisonModeLabels, state.comparisonMode, (value) => {
      if (value === state.comparisonMode) {
        return;
      }

      state.comparisonMode = value;
      if (value === 'step') {
        alignSingleSelection();
      }
      clearPendingSidebarSelection();
      state.preview = null;
      renderSelection();
      renderControlGroups();
      persistPreferences();
      requestPreview(0);
    });

    if (state.data && state.data.backend === 'jj') {
      elements.comparisonSources.hidden = false;
      renderSegmentedControl(elements.comparisonSources, comparisonSourceLabels, state.comparisonSource, (value) => {
        if (value === state.comparisonSource) {
          return;
        }

        state.comparisonSource = value;
        clearPendingSidebarSelection();
        state.preview = null;
        state.previewByRange = {};
        state.expandedRanges = {};
        state.snapshotHydrationInFlight = false;
        applyPreset(state.preset, true);
      });
    } else {
      elements.comparisonSources.hidden = true;
      elements.comparisonSources.innerHTML = '';
    }

    renderSegmentedControl(elements.layoutModes, layoutModeLabels, state.layoutMode, (value) => {
      state.layoutMode = value;
      renderControlGroups();
      renderPreview();
      persistPreferences();
    });

    renderSegmentedControl(elements.contentModes, contentModeLabels, state.contentMode, (value) => {
      state.contentMode = value;
      renderControlGroups();
      renderPreview();
      persistPreferences();
    });

    renderSegmentedControl(elements.presets, presetLabels, state.preset, (value) => {
      applyPreset(value, true);
    });

    elements.intermediateToggle.disabled = !state.data || !state.data.hasIntermediateRevisions;
    elements.intermediateToggle.classList.toggle('active', state.showIntermediateRevisions);
    elements.intermediateToggle.textContent = state.showIntermediateRevisions ? 'Hide In-Between' : 'Show In-Between';
  }

  function renderSegmentedControl(container, labels, activeValue, onSelect) {
    container.innerHTML = '';
    Object.entries(labels).forEach(([value, label]) => {
      const button = document.createElement('button');
      button.className = 'segment' + (activeValue === value ? ' active' : '');
      button.textContent = label;
      button.type = 'button';
      button.addEventListener('click', () => onSelect(value));
      container.appendChild(button);
    });
  }

  function renderWorkspaceFiles() {
    elements.workspaceFilesList.innerHTML = (state.data.workspaceFiles || [])
      .map((relativePath) => '<option value="' + escapeHtml(relativePath) + '"></option>')
      .join('');
  }

  function renderRevisionOptions() {
    elements.revisionOptionsList.innerHTML = state.visibleEntries
      .map((entry) => '<option value="' + escapeHtml(entry.shortRevision) + '" label="' + escapeHtml(formatEntryShort(entry)) + '"></option>')
      .join('');
  }

  function applySidebarState() {
    document.documentElement.style.setProperty('--sidebar-width', String(state.sidebarWidth) + 'px');
    const isCollapsed = getSidebarCollapsed();
    elements.workspace.classList.toggle('is-collapsed', isCollapsed);
    elements.workspace.classList.toggle('is-compact', state.compactViewport);
    elements.toggleSidebarAction.textContent = isCollapsed ? 'Show Revisions' : 'Hide Revisions';
    elements.sidebarToggleButton.textContent = isCollapsed ? '\u25B8' : '\u25C2';
    elements.sidebarToggleButton.classList.toggle('is-collapsed', isCollapsed);
    elements.sidebarToggleButton.setAttribute('aria-label', isCollapsed ? 'Show sidebar' : 'Hide sidebar');
  }

  function applyTimelinePaneState() {
    document.documentElement.style.setProperty('--timeline-pane-height', String(state.timelinePaneCollapsed ? 118 : state.timelinePaneHeight) + 'px');
    elements.timelinePane.classList.toggle('is-collapsed', state.timelinePaneCollapsed);
    elements.toggleTimelinePaneButton.textContent = state.timelinePaneCollapsed ? 'Expand' : 'Timeline only';
  }

  function renderSnapshotLoadingIndicator() {
    const pendingCount = getSnapshotHydrationRevisionIndexes().length;
    const shouldShow = getEffectiveComparisonSource() === 'snapshot' && (state.snapshotHydrationInFlight || pendingCount > 0);
    elements.snapshotLoadingIndicator.hidden = !shouldShow;
    elements.snapshotLoadingIndicator.textContent = state.snapshotHydrationInFlight
      ? 'Loading snapshots…'
      : pendingCount > 0
        ? 'Snapshots pending…'
        : 'Loading snapshots…';
  }

  function applyDiffFocusState() {
    elements.workspace.classList.toggle('is-diff-focus', state.diffFocusMode);
    elements.toggleDiffFocusButton.textContent = state.diffFocusMode ? 'Exit focus' : 'Focus diff';
  }

  function applyPreferences(preferences) {
    state.sidebarWidth = typeof preferences.sidebarWidth === 'number' ? preferences.sidebarWidth : state.sidebarWidth;
    state.sidebarCollapsed = preferences.sidebarCollapsed === true;
    state.timelinePaneHeight = typeof preferences.timelinePaneHeight === 'number' ? preferences.timelinePaneHeight : state.timelinePaneHeight;
    state.timelinePaneCollapsed = preferences.timelinePaneCollapsed === true;
    state.layoutMode = preferences.layoutMode === 'unified' ? 'unified' : 'split';
    state.contentMode = preferences.contentMode === 'full' ? 'full' : 'diffs';
    state.comparisonMode = preferences.comparisonMode === 'step' ? 'step' : 'range';
    state.comparisonSource = preferences.comparisonSource === 'snapshot' ? 'snapshot' : 'revision';
    state.showIntermediateRevisions = preferences.showIntermediateRevisions === true;
    state.preset = presetLabels[preferences.preset] ? preferences.preset : 'year';
  }

  function persistPreferences() {
    if (state.persistTimer) {
      window.clearTimeout(state.persistTimer);
    }

    state.persistTimer = window.setTimeout(() => {
      vscode.postMessage({
        command: 'persist-state',
        sidebarWidth: state.sidebarWidth,
        sidebarCollapsed: state.sidebarCollapsed,
        timelinePaneHeight: state.timelinePaneHeight,
        timelinePaneCollapsed: state.timelinePaneCollapsed,
        layoutMode: state.layoutMode,
        contentMode: state.contentMode,
        comparisonMode: state.comparisonMode,
        comparisonSource: state.comparisonSource,
        showIntermediateRevisions: state.showIntermediateRevisions,
        preset: state.preset,
      });
    }, 80);
  }

  function renderMenu() {
    elements.actionsMenu.classList.toggle('open', state.menuOpen);
  }

  function renderHotkeysPopover() {
    elements.hotkeysPopover.hidden = !state.hotkeysOpen;
  }

  function closeMenu() {
    state.menuOpen = false;
    renderMenu();
  }

  function getSidebarCollapsed() {
    return state.sidebarCollapsed || (state.compactViewport && !state.sidebarShownOnCompact);
  }

  function syncViewportState(isInitialLoad) {
    const nextCompactViewport = compactViewportQuery.matches;
    if (nextCompactViewport && (isInitialLoad || !state.compactViewport)) {
      state.sidebarShownOnCompact = false;
    }
    if (!nextCompactViewport) {
      state.sidebarShownOnCompact = false;
    }
    state.compactViewport = nextCompactViewport;
    applySidebarState();
  }

  function submitFileSwitch() {
    if (!state.data) {
      return;
    }
    const nextPath = String(elements.fileSwitcher.value || '').trim();
    if (!nextPath || nextPath === state.data.relativePath) {
      return;
    }
    if (!(state.data.workspaceFiles || []).includes(nextPath)) {
      return;
    }
    closeMenu();
    vscode.postMessage({ command: 'switch-file', relativePath: nextPath });
  }

  function submitRevisionInput(side) {
    clearPendingSidebarSelection();
    const input = side === 'from' ? elements.fromRevisionInput : elements.toRevisionInput;
    const entry = findEntryByRevisionQuery(String(input.value || '').trim());
    if (!entry) {
      renderSelection();
      return;
    }

    if (state.comparisonMode === 'step') {
      selectSingleEntry(entry.index);
    } else if (side === 'from') {
      state.fromIndex = Math.min(entry.index, state.toIndex);
    } else {
      state.toIndex = Math.max(entry.index, state.fromIndex);
    }

    renderSelection();
    requestPreview(0);
  }

  function findEntryByRevisionQuery(query) {
    if (!query) {
      return null;
    }

    return state.visibleEntries.find((entry) => entry.shortRevision === query)
      || state.visibleEntries.find((entry) => entry.revision === query)
      || state.visibleEntries.find((entry) => entry.shortRevision.toLowerCase() === query.toLowerCase())
      || state.visibleEntries.find((entry) => entry.revision.toLowerCase().startsWith(query.toLowerCase()));
  }

  function postRangeAction(command, range) {
    const nextRange = range || getCommandRange(command);
    vscode.postMessage({
      command: command,
      fromIndex: nextRange.fromIndex,
      toIndex: nextRange.toIndex,
      comparisonSource: getEffectiveComparisonSource(),
    });
  }

  function getEffectiveComparisonSource() {
    return state.data && state.data.backend === 'jj'
      ? state.comparisonSource
      : 'revision';
  }

  function applyPreset(preset, resetSelection, suppressPreviewRequest, suppressSnapshotHydration) {
    state.preset = preset;
    clearPendingSidebarSelection();
    const allEntries = getSourceEntries();
    const lastEntry = allEntries[allEntries.length - 1];
    const windowDays = state.data.presets[preset];
    const cutoff = Number.isFinite(windowDays)
      ? lastEntry.timestamp - windowDays * 24 * 60 * 60 * 1000
      : Number.NEGATIVE_INFINITY;

    const filtered = allEntries.filter((entry) => entry.timestamp >= cutoff);
    const filteredVisibleEntries = filtered.filter((entry) => state.showIntermediateRevisions || entry.touchesFile);
    const fallbackEntries = allEntries.filter((entry) => state.showIntermediateRevisions || entry.touchesFile);
    state.visibleEntries = filteredVisibleEntries.length >= 2 ? filteredVisibleEntries : fallbackEntries;

    if (!state.visibleEntries.length) {
      renderEmpty();
      return;
    }

    if (resetSelection || !state.visibleEntries.some((entry) => entry.index === state.toIndex)) {
      state.toIndex = state.visibleEntries[state.visibleEntries.length - 1].index;
    }

    if (resetSelection || !state.visibleEntries.some((entry) => entry.index === state.fromIndex)) {
      state.fromIndex = Math.max(state.visibleEntries[0].index, state.toIndex - 1);
    }

    if (state.comparisonMode === 'step') {
      alignSingleSelection();
    } else {
      state.fromIndex = Math.min(state.fromIndex, state.toIndex);
    }

    renderRevisionOptions();
    syncActivePreviewRange();
    renderControlGroups();
    renderSelection();

    if (!suppressSnapshotHydration) {
      requestSnapshotHydration();
    }

    if (!suppressPreviewRequest) {
      persistPreferences();
      requestPreview(0);
    }
  }

  function renderSelection() {
    if (!state.visibleEntries.length) {
      renderEmpty();
      return;
    }

    if (state.comparisonMode === 'step') {
      alignSingleSelection();
    } else {
      state.fromIndex = Math.min(state.fromIndex, state.toIndex);
      ensureMinimumRangeWidth('to');
    }

    syncActivePreviewRange();

    const fromVisibleIndex = Math.max(0, getVisibleIndexForAbsoluteIndex(state.fromIndex));
    const toVisibleIndex = Math.max(0, getVisibleIndexForAbsoluteIndex(state.toIndex));
    const fromEntry = state.visibleEntries[fromVisibleIndex];
    const toEntry = state.visibleEntries[toVisibleIndex];
    const activeRange = getActivePreviewRange();
    const sourceEntries = getSourceEntries();
    const activeFromEntry = sourceEntries[activeRange.fromIndex] || fromEntry;
    const activeToEntry = sourceEntries[activeRange.toIndex] || toEntry;
    const knownPreview = state.previewByRange[getPreviewKey(activeRange.fromIndex, activeRange.toIndex, getEffectiveComparisonSource())];

    positionRangeVisuals(fromVisibleIndex, toVisibleIndex);

    elements.fromRevisionInput.value = fromEntry.shortRevision;
    elements.toRevisionInput.value = toEntry.shortRevision;
    elements.fromHandleLabel.innerHTML = 'From ' + renderIdentifierMarkup(fromEntry.shortRevision, fromEntry.changeId);
    elements.toHandleLabel.innerHTML = 'To ' + renderIdentifierMarkup(toEntry.shortRevision, toEntry.changeId);
    elements.fromRelativeLabel.textContent = fromEntry.relativeDate || '';
    elements.toRelativeLabel.textContent = toEntry.relativeDate || '';
    elements.rangeLabel.textContent = formatRangeSubtitle(fromEntry, toEntry);
    elements.rangeSubtitle.textContent = formatRangeTitle();
    elements.sidebarHint.textContent = '';
    elements.selectionMeta.textContent = '';
    elements.diffModeEyebrow.textContent = layoutModeLabels[state.layoutMode]
      + ' · ' + contentModeLabels[state.contentMode]
      + ' · ' + comparisonModeLabels[state.comparisonMode]
      + (state.data.backend === 'jj' ? ' · ' + comparisonSourceLabels[state.comparisonSource] : '');

    renderStepControls();
    renderTrackAnchors();
    renderMonths();
    renderHistoryList();
    renderPreview();
    renderSnapshotLoadingIndicator();
    prefetchSidebarPreviews();
  }

  function formatRangeTitle() {
    const selectedCount = getSelectedRevisionCount();
    const touchingCount = getSourceEntries().filter((entry) => entry.touchesFile).length;
    return String(selectedCount) + '/' + String(touchingCount) + ' ' + (state.comparisonSource === 'snapshot' ? 'snapshots' : 'revisions');
  }

  function formatRangeSubtitle(fromEntry, toEntry) {
    const fromLabel = fromEntry.isWorkingTree ? 'Today' : formatDisplayDate(fromEntry.authorDate, fromEntry.shortDate);
    const toLabel = toEntry.isWorkingTree ? 'Today' : formatDisplayDate(toEntry.authorDate, toEntry.shortDate);
    return fromLabel + ' - ' + toLabel + ' · ' + state.data.backend.toUpperCase();
  }

  function getSelectedRevisionCount() {
    return timelineModel.getSelectedEntryCount(state.visibleEntries, state.fromIndex, state.toIndex);
  }

  function positionRangeVisuals(fromVisibleIndex, toVisibleIndex) {
    const fromPercent = timelineModel.getTimelineAnchorPercent(state.visibleEntries, fromVisibleIndex);
    const toPercent = timelineModel.getTimelineAnchorPercent(state.visibleEntries, toVisibleIndex);
    elements.fromMarker.style.left = String(fromPercent) + '%';
    elements.toMarker.style.left = String(toPercent) + '%';
    elements.rangeFill.style.left = String(fromPercent) + '%';
    elements.rangeFill.style.width = String(Math.max(0, toPercent - fromPercent)) + '%';
  }

  function formatEntryShort(entry) {
    return entry.isWorkingTree ? 'Current' : entry.shortDate + ' · ' + entry.shortRevision;
  }

  function formatSelectionMeta(fromEntry, toEntry, preview) {
    const parts = [];
    if (state.comparisonMode === 'step') {
      parts.push(formatMetaLabel(fromEntry, 'from') + ' -> ' + formatMetaLabel(toEntry, 'to'));
    } else {
      parts.push(formatMetaLabel(fromEntry, 'from'));
      parts.push(formatMetaLabel(toEntry, 'to'));
    }
    if (preview) {
      parts.push('+' + String(preview.additions) + ' / -' + String(preview.deletions));
    }
    return parts.join('   ');
  }

  function formatMetaLabel(entry, side) {
    if (entry.isWorkingTree) {
      return side === 'from' ? 'From working tree' : 'To working tree';
    }

    return entry.relativeDate + ' · ' + entry.shortRevision;
  }

  function renderMonths() {
    const labels = [];
    const seen = new Set();
    state.visibleEntries.forEach((entry) => {
      const label = formatMonthLabel(entry.authorDate, entry.monthLabel);
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    });

    const compact = labels.slice(-4);
    elements.monthRow.innerHTML = compact.map((label) => '<div>' + escapeHtml(label) + '</div>').join('');
  }

  function renderHistoryList() {
    if (!state.visibleEntries.length) {
      elements.historyList.innerHTML = '<div class="empty">No revisions in the current filter.</div>';
      return;
    }

    elements.historyList.innerHTML = '';
    const orderedEntries = getOrderedHistoryEntries();
    const filteredEntries = orderedEntries.filter(matchesSidebarSearch);

    if (!filteredEntries.length) {
      elements.historyList.innerHTML = '<div class="empty">No revisions match the current search.</div>';
      return;
    }

    filteredEntries.forEach((entry, orderIndex) => {
      const preview = getSidebarPreview(entry.index);
      const descriptionExpanded = Boolean(state.expandedDescriptions[String(entry.index)]);
      const showMore = entry.description.length > 48;
      const isFrom = entry.index === state.fromIndex;
      const isTo = entry.index === state.toIndex;
      const isPendingAnchor = entry.index === state.pendingSidebarAnchorIndex;
      const inRange = entry.index >= Math.min(state.fromIndex, state.toIndex) && entry.index <= Math.max(state.fromIndex, state.toIndex);
      const item = document.createElement('article');
      item.className = 'history-item'
        + (isFrom || isTo ? ' active' : '')
        + (inRange ? ' in-range' : '')
        + (isPendingAnchor ? ' pending-anchor' : '')
        + (!entry.touchesFile ? ' is-intermediate' : '');
      item.tabIndex = 0;
      item.dataset.entryIndex = String(entry.index);
      item.dataset.historyOrder = String(orderIndex);

      item.innerHTML = [
        '<div class="history-top">',
        '<div class="history-primary">' + renderEntryPrimary(entry) + renderHistoryBadges(entry, isFrom, isTo) + '</div>',
        '<div class="history-actions"><span>' + escapeHtml(entry.shortDate) + '</span>'
          + (entry.remoteUrl ? '<button class="history-action history-action-remote" type="button" title="Open this revision on GitHub">Remote</button>' : '')
          + (entry.hasPreviousEntry ? '<button class="history-action history-action-diff" type="button" title="Open diffs for this revision">Open diffs</button>' : '')
          + '</div>',
        '</div>',
        '<div class="history-description' + (descriptionExpanded || !showMore ? '' : ' is-truncated') + '">' + escapeHtml(entry.description) + '</div>',
        '<div class="history-bottom">',
        '<span class="history-meta">' + escapeHtml(entry.relativeDate + (entry.authorName ? ' · ' + entry.authorName : '')) + '</span>',
        '<span class="history-stats">' + (preview ? renderHistoryStats(preview) : '') + '</span>',
        '</div>',
        showMore ? '<button class="history-more" type="button">' + (descriptionExpanded ? 'Less' : 'More') + '</button>' : '',
      ].join('');

      item.addEventListener('focus', () => {
        state.focusedHistoryOrderIndex = orderIndex;
      });

      item.addEventListener('click', () => {
        handleSidebarEntryClick(entry.index);
      });

      if (showMore) {
        const moreButton = item.querySelector('.history-more');
        if (moreButton) {
          moreButton.addEventListener('click', (event) => {
            event.stopPropagation();
            state.expandedDescriptions[String(entry.index)] = !descriptionExpanded;
            renderHistoryList();
          });
        }
      }

      Array.from(item.querySelectorAll('[data-copy-value]')).forEach((button) => {
        button.addEventListener('click', async (event) => {
          event.stopPropagation();
          await copyIdentifier(String(button.getAttribute('data-copy-key') || ''), String(button.getAttribute('data-copy-value') || ''));
        });
      });

      const actionButton = item.querySelector('.history-action-diff');
      if (actionButton) {
        actionButton.addEventListener('click', (event) => {
          event.stopPropagation();
          vscode.postMessage({
            command: 'open-revision-files-diff',
            entryIndex: entry.index,
            comparisonSource: getEffectiveComparisonSource(),
          });
        });
      }

      const remoteButton = item.querySelector('.history-action-remote');
      if (remoteButton) {
        remoteButton.addEventListener('click', (event) => {
          event.stopPropagation();
          vscode.postMessage({
            command: 'open-revision-remote',
            entryIndex: entry.index,
            comparisonSource: getEffectiveComparisonSource(),
          });
        });
      }

      elements.historyList.appendChild(item);
    });

    if (state.focusedHistoryOrderIndex < 0) {
      state.focusedHistoryOrderIndex = filteredEntries.findIndex((entry) => entry.index === state.toIndex);
    }
  }

  function getOrderedHistoryEntries() {
    return state.visibleEntries.slice().reverse();
  }

  function matchesSidebarSearch(entry) {
    if (!state.sidebarSearchQuery) {
      return true;
    }

    const haystack = [entry.description, entry.authorName, entry.shortRevision, entry.revision]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(state.sidebarSearchQuery);
  }

  function selectEntryFromSidebar(entryIndex) {
    clearPendingSidebarSelection();
    if (state.comparisonMode === 'step') {
      selectSingleEntry(entryIndex);
    } else if (Math.abs(entryIndex - state.fromIndex) <= Math.abs(entryIndex - state.toIndex)) {
      state.fromIndex = Math.min(entryIndex, state.toIndex);
    } else {
      state.toIndex = Math.max(entryIndex, state.fromIndex);
    }

    renderSelection();
    requestPreview(0);
  }

  function handleSidebarEntryClick(entryIndex) {
    if (state.comparisonMode === 'step') {
      selectEntryFromSidebar(entryIndex);
      return;
    }

    if (state.pendingSidebarAnchorIndex === null) {
      state.pendingSidebarAnchorIndex = entryIndex;
      renderHistoryList();
      scrollSidebarToEntry(entryIndex, false);
      return;
    }

    if (state.pendingSidebarAnchorIndex === entryIndex) {
      clearPendingSidebarSelection();
      renderHistoryList();
      return;
    }

    state.fromIndex = Math.min(state.pendingSidebarAnchorIndex, entryIndex);
    state.toIndex = Math.max(state.pendingSidebarAnchorIndex, entryIndex);
    clearPendingSidebarSelection();
    renderSelection();
    requestPreview(0);
  }

  function clearPendingSidebarSelection() {
    state.pendingSidebarAnchorIndex = null;
  }

  function nudgeSidebarSelection(direction) {
    const orderedEntries = getOrderedHistoryEntries().filter(matchesSidebarSearch);
    if (!orderedEntries.length) {
      return;
    }

    const startIndex = state.focusedHistoryOrderIndex >= 0
      ? state.focusedHistoryOrderIndex
      : Math.max(0, orderedEntries.findIndex((entry) => entry.index === state.toIndex));
    const nextIndex = Math.min(Math.max(startIndex + direction, 0), orderedEntries.length - 1);
    state.focusedHistoryOrderIndex = nextIndex;
    selectEntryFromSidebar(orderedEntries[nextIndex].index);
    scrollSidebarToEntry(orderedEntries[nextIndex].index, true);
  }

  function scrollSidebarToEntry(entryIndex, focusItem) {
    const item = elements.historyList.querySelector('[data-entry-index="' + String(entryIndex) + '"]');
    if (!item) {
      return;
    }
    item.scrollIntoView({ block: 'nearest' });
    if (focusItem) {
      item.focus();
    }
  }

  function renderHistoryBadges(entry, isFrom, isTo) {
    const parts = [];
    if (entry.operationKey) {
      parts.push(renderCopyBadge('operation-key:' + entry.id, entry.operationKey, renderIdentifierMarkup(entry.operationKey, entry.changeId)));
    }
    if (!entry.touchesFile) {
      parts.push('<span class="mini-badge other">OTHER</span>');
    }
    if (isFrom) {
      parts.push('<span class="mini-badge from">FROM</span>');
    }
    if (isTo) {
      parts.push('<span class="mini-badge to">TO</span>');
    }
    return parts.join('');
  }

  function renderHistoryStats(preview) {
    if (!preview.hasChanges) {
      return '<span class="stat">No text</span>';
    }

    return [
      '<span class="stat stat--plus">+' + String(preview.additions) + '</span>',
      '<span class="stat stat--minus">-' + String(preview.deletions) + '</span>',
    ].join('');
  }

  function renderEntryPrimary(entry) {
    const copyKey = 'primary:' + entry.id;
    const copyValue = entry.operationId || entry.revision || entry.shortRevision;
    const markup = entry.operationId
      ? '<span class="identifier identifier-plain">' + escapeHtml(entry.operationId) + '</span>'
      : renderIdentifierMarkup(entry.shortRevision, entry.changeId);
    const label = state.copiedIdentifierKey === copyKey ? 'Copied!' : markup;
    return '<button class="history-id-button" type="button" data-copy-key="' + escapeHtml(copyKey) + '" data-copy-value="' + escapeHtml(copyValue) + '">' + label + '</button>';
  }

  function renderCopyBadge(copyKey, copyValue, markup) {
    const label = state.copiedIdentifierKey === copyKey ? 'Copied!' : markup;
    return '<button class="mini-badge other mini-badge-copy" type="button" data-copy-key="' + escapeHtml(copyKey) + '" data-copy-value="' + escapeHtml(copyValue) + '">' + label + '</button>';
  }

  function renderIdentifierMarkup(value, highlightedPrefix) {
    const text = String(value || '');
    const prefix = String(highlightedPrefix || '');
    if (!prefix || !text.startsWith(prefix)) {
      return '<span class="identifier"><span class="identifier-prefix">' + escapeHtml(text) + '</span></span>';
    }

    return '<span class="identifier"><span class="identifier-prefix">' + escapeHtml(prefix) + '</span><span class="identifier-suffix">' + escapeHtml(text.slice(prefix.length)) + '</span></span>';
  }

  async function copyIdentifier(copyKey, copyValue) {
    if (!copyValue) {
      return;
    }

    try {
      await navigator.clipboard.writeText(copyValue);
    } catch {
      return;
    }

    state.copiedIdentifierKey = copyKey;
    renderHistoryList();

    if (state.copiedIdentifierTimer) {
      window.clearTimeout(state.copiedIdentifierTimer);
    }

    state.copiedIdentifierTimer = window.setTimeout(() => {
      state.copiedIdentifierKey = '';
      renderHistoryList();
    }, 2000);
  }

  function renderPreview() {
    if (!state.data) {
      return;
    }

    const activeRange = getActivePreviewRange();
    const sourceEntries = getSourceEntries();
    const fromEntry = sourceEntries[activeRange.fromIndex];
    const toEntry = sourceEntries[activeRange.toIndex];
    if (!fromEntry || !toEntry) {
      elements.diffTitle.textContent = 'No diff available';
      elements.diffTitleMeta.textContent = '';
      elements.diffSubtitle.textContent = '';
      elements.diffStats.innerHTML = '';
      elements.diffRows.innerHTML = '<div class="empty-diff">Pick a revision range to inspect it.</div>';
      return;
    }

    const previewSource = state.preview && state.preview.comparisonSource ? state.preview.comparisonSource : 'revision';
    if (
      !state.preview
      || state.preview.fromIndex !== activeRange.fromIndex
      || state.preview.toIndex !== activeRange.toIndex
      || previewSource !== getEffectiveComparisonSource()
    ) {
      elements.diffTitle.textContent = 'Loading diff…';
      elements.diffTitleMeta.textContent = '';
      elements.diffSubtitle.textContent = toEntry.description;
      elements.diffStats.innerHTML = '';
      elements.diffRows.innerHTML = '<div class="empty-diff">Computing diff preview…</div>';
      return;
    }

    const rawTitle = state.preview.title || '';
    const eyebrowText = elements.diffModeEyebrow.textContent || '';
    const snapshotInEyebrow = eyebrowText.toLowerCase().includes('snapshot');
    elements.diffTitle.textContent = snapshotInEyebrow ? rawTitle.replace(/^snapshot\s*/i, '') : rawTitle;
    elements.diffTitleMeta.textContent = state.preview.subtitle || '';
    elements.diffSubtitle.textContent = toEntry.description || '';
    elements.diffStats.innerHTML = renderStatChips(state.preview);

    const visibleRows = getDisplayRows(state.preview);
    if (!visibleRows.length) {
      elements.diffRows.innerHTML = state.contentMode === 'full'
        ? '<div class="empty-diff">The file has no content at this revision.</div>'
        : renderNoTextualChanges(state.preview);
      return;
    }

    elements.diffRows.innerHTML = state.layoutMode === 'split'
      ? renderSplitRows(visibleRows)
      : visibleRows.map((row) => renderUnifiedRow(row)).join('');

    Array.from(elements.diffRows.querySelectorAll('.skip-button')).forEach((button) => {
      button.addEventListener('click', () => {
        toggleRange(button.dataset.previewKey, button.dataset.rangeKey);
      });
    });
  }

  function renderEmpty() {
    elements.rangeLabel.textContent = 'No revisions found';
    elements.rangeSubtitle.textContent = '';
    elements.sidebarHint.textContent = '';
    elements.selectionMeta.textContent = '';
    elements.historyList.innerHTML = '<div class="empty">Make a change and commit it, then reopen the timeline.</div>';
    elements.diffTitle.textContent = 'No diff available';
    elements.diffSubtitle.textContent = '';
    elements.diffStats.innerHTML = '';
    elements.diffRows.innerHTML = '<div class="empty-diff">Make a change and commit it, then reopen the timeline.</div>';
  }

  function requestPreview(delay) {
    if (state.previewTimer) {
      window.clearTimeout(state.previewTimer);
    }

    state.previewTimer = window.setTimeout(() => {
      postRangeAction('select-entry', getActivePreviewRange());
    }, delay);
  }

  function getActivePreviewRange() {
    return {
      fromIndex: state.previewFromIndex,
      toIndex: state.previewToIndex,
    };
  }

  function getCommandRange(command) {
    if (command === 'open-range-files-diff' && state.comparisonMode === 'range') {
      return {
        fromIndex: state.fromIndex,
        toIndex: state.toIndex,
      };
    }

    return getActivePreviewRange();
  }

  function alignSingleSelection() {
    if (state.visibleEntries.length < 2) {
      return;
    }

    const toVisibleIndex = Math.min(Math.max(getVisibleIndexForAbsoluteIndex(state.toIndex), 1), state.visibleEntries.length - 1);
    state.fromIndex = state.visibleEntries[toVisibleIndex - 1].index;
    state.toIndex = state.visibleEntries[toVisibleIndex].index;
  }

  function selectSingleEntry(entryIndex) {
    const visibleIndex = getVisibleIndexForAbsoluteIndex(entryIndex);
    if (visibleIndex < 0 || state.visibleEntries.length < 2) {
      return;
    }

    const toVisibleIndex = Math.min(Math.max(visibleIndex, 1), state.visibleEntries.length - 1);
    state.fromIndex = state.visibleEntries[toVisibleIndex - 1].index;
    state.toIndex = state.visibleEntries[toVisibleIndex].index;
  }

  function getVisibleIndexForAbsoluteIndex(index) {
    return state.visibleEntries.findIndex((entry) => entry.index === index);
  }

  function getVisibleIndexFromClientX(clientX) {
    const trackRect = elements.track.getBoundingClientRect();
    if (!trackRect.width || !state.visibleEntries.length) {
      return -1;
    }

    const ratio = Math.min(Math.max((clientX - trackRect.left) / trackRect.width, 0), 1);
    const denominator = Math.max(1, state.visibleEntries.length - 1);
    return Math.min(state.visibleEntries.length - 1, Math.max(0, Math.round(ratio * denominator)));
  }

  function syncActivePreviewRange() {
    if (state.comparisonMode === 'step') {
      alignSingleSelection();
    }

    state.previewFromIndex = state.fromIndex;
    state.previewToIndex = state.toIndex;
  }

  function renderStepControls() {
    const availableCount = Math.max(0, state.visibleEntries.length - 1);
    const isSnapshotMode = state.data.backend === 'jj' && state.comparisonSource === 'snapshot';
    if (state.comparisonMode === 'range') {
      elements.stepStatus.textContent = '';
    } else {
      const current = Math.max(1, getVisibleIndexForAbsoluteIndex(state.toIndex));
      elements.stepStatus.textContent = String(current) + '/' + String(Math.max(1, availableCount)) + ' ' + (isSnapshotMode ? 'snapshots' : 'diffs');
    }

    elements.stepBackwardButton.disabled = !canNavigateSelection(-1);
    elements.stepForwardButton.disabled = !canNavigateSelection(1);
    elements.stepFastBackwardButton.disabled = !canNavigateSelection(-1);
    elements.stepFastForwardButton.disabled = !canNavigateSelection(1);
    renderSnapshotLoadingIndicator();
  }

  function canNavigateSelection(direction) {
    if (state.comparisonMode === 'step') {
      const toVisibleIndex = getVisibleIndexForAbsoluteIndex(state.toIndex);
      return direction < 0 ? toVisibleIndex > 1 : toVisibleIndex < state.visibleEntries.length - 1;
    }

    const fromVisibleIndex = getVisibleIndexForAbsoluteIndex(state.fromIndex);
    const toVisibleIndex = getVisibleIndexForAbsoluteIndex(state.toIndex);
    return direction < 0 ? fromVisibleIndex > 0 : toVisibleIndex < state.visibleEntries.length - 1;
  }

  function navigateSelection(direction) {
    clearPendingSidebarSelection();
    const previousFromIndex = state.fromIndex;
    const previousToIndex = state.toIndex;
    if (state.comparisonMode === 'step') {
      moveSingleSelection(direction);
    } else {
      moveRangeSelection(direction);
    }

    renderSelection();
    if (previousFromIndex !== state.fromIndex || previousToIndex !== state.toIndex) {
      scrollSidebarToEntry(state.comparisonMode === 'step' ? state.toIndex : state.fromIndex, false);
    }
    persistPreferences();
    requestPreview(0);
  }

  function setRangeBoundaryToVisibleEdge(side, edge) {
    if (!state.visibleEntries.length) {
      return;
    }

    clearPendingSidebarSelection();
    const targetVisibleIndex = edge === 'start' ? 0 : state.visibleEntries.length - 1;
    state.comparisonMode = 'range';
    renderControlGroups();

    if (side === 'from') {
      const maxFromVisibleIndex = Math.max(0, getVisibleIndexForAbsoluteIndex(state.toIndex) - 1);
      state.fromIndex = state.visibleEntries[Math.min(targetVisibleIndex, maxFromVisibleIndex)].index;
    } else {
      const minToVisibleIndex = Math.min(state.visibleEntries.length - 1, getVisibleIndexForAbsoluteIndex(state.fromIndex) + 1);
      state.toIndex = state.visibleEntries[Math.max(targetVisibleIndex, minToVisibleIndex)].index;
    }

    ensureMinimumRangeWidth(side);
    renderSelection();
    scrollSidebarToEntry(side === 'from' ? state.fromIndex : state.toIndex, false);
    persistPreferences();
    requestPreview(0);
  }

  function moveRangeToVisibleEdge(edge) {
    if (!state.visibleEntries.length) {
      return;
    }

    clearPendingSidebarSelection();
    state.comparisonMode = 'range';
    renderControlGroups();
    const fromVisibleIndex = getVisibleIndexForAbsoluteIndex(state.fromIndex);
    const toVisibleIndex = getVisibleIndexForAbsoluteIndex(state.toIndex);
    const width = Math.max(0, toVisibleIndex - fromVisibleIndex);
    const nextFromVisibleIndex = edge === 'start'
      ? 0
      : Math.max(0, state.visibleEntries.length - 1 - width);
    const nextToVisibleIndex = Math.min(state.visibleEntries.length - 1, nextFromVisibleIndex + width);
    state.fromIndex = state.visibleEntries[nextFromVisibleIndex].index;
    state.toIndex = state.visibleEntries[nextToVisibleIndex].index;

    ensureMinimumRangeWidth('to');
    renderSelection();
    scrollSidebarToEntry(state.fromIndex, false);
    persistPreferences();
    requestPreview(0);
  }

  function moveSingleSelection(direction) {
    const stepDirection = Math.sign(direction);
    let remaining = Math.abs(direction);
    while (remaining > 0 && canNavigateSelection(stepDirection)) {
      const toVisibleIndex = getVisibleIndexForAbsoluteIndex(state.toIndex);
      const nextToVisibleIndex = toVisibleIndex + stepDirection;
      state.fromIndex = state.visibleEntries[nextToVisibleIndex - 1].index;
      state.toIndex = state.visibleEntries[nextToVisibleIndex].index;
      remaining -= 1;
    }
  }

  function moveRangeSelection(direction) {
    const stepDirection = Math.sign(direction);
    let remaining = Math.abs(direction);
    while (remaining > 0 && canNavigateSelection(stepDirection)) {
      const fromVisibleIndex = getVisibleIndexForAbsoluteIndex(state.fromIndex);
      const toVisibleIndex = getVisibleIndexForAbsoluteIndex(state.toIndex);
      const width = toVisibleIndex - fromVisibleIndex;
      const nextFromVisibleIndex = fromVisibleIndex + stepDirection;
      const nextToVisibleIndex = nextFromVisibleIndex + width;
      state.fromIndex = state.visibleEntries[nextFromVisibleIndex].index;
      state.toIndex = state.visibleEntries[nextToVisibleIndex].index;
      remaining -= 1;
    }
  }

  function nudgeRangeBoundary(side, direction) {
    clearPendingSidebarSelection();
    state.comparisonMode = 'range';
    renderControlGroups();
    const stepDirection = Math.sign(direction);
    let remaining = Math.abs(direction);
    while (remaining > 0) {
      const currentVisibleIndex = getVisibleIndexForAbsoluteIndex(side === 'from' ? state.fromIndex : state.toIndex);
      const nextVisibleIndex = currentVisibleIndex + stepDirection;
      if (nextVisibleIndex < 0 || nextVisibleIndex >= state.visibleEntries.length) {
        break;
      }

      if (side === 'from') {
        if (nextVisibleIndex >= getVisibleIndexForAbsoluteIndex(state.toIndex)) {
          break;
        }
        state.fromIndex = state.visibleEntries[nextVisibleIndex].index;
      } else {
        if (nextVisibleIndex <= getVisibleIndexForAbsoluteIndex(state.fromIndex)) {
          break;
        }
        state.toIndex = state.visibleEntries[nextVisibleIndex].index;
      }
      remaining -= 1;
    }

    ensureMinimumRangeWidth(side);
    renderSelection();
    scrollSidebarToEntry(side === 'from' ? state.fromIndex : state.toIndex, false);
    persistPreferences();
    requestPreview(0);
  }

  function beginRangeDrag(event) {
    if (!state.visibleEntries.length) {
      return;
    }

    clearPendingSidebarSelection();
    event.preventDefault();
    event.stopPropagation();

    const trackRect = elements.track.getBoundingClientRect();
    const startFromVisibleIndex = getVisibleIndexForAbsoluteIndex(state.fromIndex);
    const startToVisibleIndex = getVisibleIndexForAbsoluteIndex(state.toIndex);
    const width = Math.max(1, startToVisibleIndex - startFromVisibleIndex);
    const startX = event.clientX;
    const denominator = Math.max(1, state.visibleEntries.length - 1);
    elements.rangeFill.classList.add('is-dragging');

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    function onPointerMove(moveEvent) {
      const deltaRatio = (moveEvent.clientX - startX) / Math.max(1, trackRect.width);
      const deltaSteps = Math.round(deltaRatio * denominator);
      const nextFromVisibleIndex = Math.min(Math.max(startFromVisibleIndex + deltaSteps, 0), Math.max(0, state.visibleEntries.length - 1 - width));
      const nextToVisibleIndex = nextFromVisibleIndex + width;
      state.fromIndex = state.visibleEntries[nextFromVisibleIndex].index;
      state.toIndex = state.visibleEntries[nextToVisibleIndex].index;
      ensureMinimumRangeWidth('to');
      renderSelection();
      requestPreview(70);
    }

    function onPointerUp() {
      elements.rangeFill.classList.remove('is-dragging');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      requestPreview(0);
    }
  }

  function beginMarkerDrag(side, event) {
    if (!state.visibleEntries.length) {
      return;
    }

    clearPendingSidebarSelection();
    event.preventDefault();
    event.stopPropagation();
    state.comparisonMode = 'range';
    renderControlGroups();

    updateMarkerSelection(side, event.clientX);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    function onPointerMove(moveEvent) {
      updateMarkerSelection(side, moveEvent.clientX);
      requestPreview(70);
    }

    function onPointerUp() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      requestPreview(0);
    }
  }

  function updateMarkerSelection(side, clientX) {
    const nextVisibleIndex = getVisibleIndexFromClientX(clientX);
    if (nextVisibleIndex < 0) {
      return;
    }

    if (side === 'from') {
      const clampedVisibleIndex = Math.min(nextVisibleIndex, Math.max(0, getVisibleIndexForAbsoluteIndex(state.toIndex) - 1));
      state.fromIndex = state.visibleEntries[clampedVisibleIndex].index;
    } else {
      const clampedVisibleIndex = Math.max(nextVisibleIndex, Math.min(state.visibleEntries.length - 1, getVisibleIndexForAbsoluteIndex(state.fromIndex) + 1));
      state.toIndex = state.visibleEntries[clampedVisibleIndex].index;
    }

    ensureMinimumRangeWidth(side);
    renderSelection();
  }

  function ensureMinimumRangeWidth(preferredSide) {
    if (state.comparisonMode !== 'range' || state.visibleEntries.length < 2) {
      return;
    }

    let fromVisibleIndex = getVisibleIndexForAbsoluteIndex(state.fromIndex);
    let toVisibleIndex = getVisibleIndexForAbsoluteIndex(state.toIndex);
    if (fromVisibleIndex < 0 || toVisibleIndex < 0) {
      return;
    }

    if (fromVisibleIndex === toVisibleIndex) {
      if (preferredSide === 'from') {
        fromVisibleIndex = Math.max(0, toVisibleIndex - 1);
        toVisibleIndex = Math.max(fromVisibleIndex + 1, toVisibleIndex);
      } else {
        toVisibleIndex = Math.min(state.visibleEntries.length - 1, fromVisibleIndex + 1);
        fromVisibleIndex = Math.min(fromVisibleIndex, toVisibleIndex - 1);
      }

      if (fromVisibleIndex === toVisibleIndex) {
        fromVisibleIndex = Math.max(0, toVisibleIndex - 1);
        toVisibleIndex = Math.min(state.visibleEntries.length - 1, fromVisibleIndex + 1);
      }

      state.fromIndex = state.visibleEntries[fromVisibleIndex].index;
      state.toIndex = state.visibleEntries[toVisibleIndex].index;
    }
  }

  function maybeResolveHiddenRangeToNonEmpty(preview) {
    const candidateIndexes = state.visibleEntries
      .filter((entry) => entry.index >= Math.min(preview.fromIndex, preview.toIndex) && entry.index <= Math.max(preview.fromIndex, preview.toIndex))
      .map((entry) => entry.index);

    if (candidateIndexes.length < 2) {
      renderPreview();
      renderHistoryList();
      return;
    }

    const resolutionKey = candidateIndexes.join(':');
    if (state.pendingRangeResolutionKey === resolutionKey) {
      renderPreview();
      renderHistoryList();
      return;
    }

    state.pendingRangeResolutionKey = resolutionKey;
    vscode.postMessage({
      command: 'resolve-nonempty-range',
      candidateIndexes,
    });
  }

  function renderTrackAnchors() {
    const fragment = document.createDocumentFragment();
    state.visibleEntries.forEach((entry, visibleIndex) => {
      const left = timelineModel.getTimelineAnchorPercent(state.visibleEntries, visibleIndex);
      const inRange = entry.index >= Math.min(state.fromIndex, state.toIndex) && entry.index <= Math.max(state.fromIndex, state.toIndex);
      const isFrom = entry.index === state.fromIndex;
      const isTo = entry.index === state.toIndex;
      const anchor = document.createElement('span');
      anchor.className = 'track-anchor'
        + (inRange ? ' in-range' : '')
        + (isFrom ? ' is-from' : '')
        + (isTo ? ' is-to' : '')
        + (!entry.touchesFile ? ' is-intermediate' : '');
      anchor.style.left = String(left) + '%';
      anchor.dataset.entryIndex = String(entry.index);
      fragment.appendChild(anchor);
    });
    elements.track.replaceChildren(fragment);
    void elements.track.offsetWidth;
  }

  elements.track.addEventListener('mouseover', (event) => {
    const anchor = event.target.closest('.track-anchor');
    if (!anchor) {
      return;
    }
    const entryIndex = Number(anchor.dataset.entryIndex);
    const entry = state.visibleEntries.find((e) => e.index === entryIndex);
    if (!entry) {
      return;
    }
    showAnchorTooltip(anchor, entry);
  });

  elements.track.addEventListener('mouseout', (event) => {
    if (!event.relatedTarget || !event.relatedTarget.closest || !event.relatedTarget.closest('.anchor-tooltip')) {
      elements.anchorTooltip.hidden = true;
    }
  });

  elements.anchorTooltip.addEventListener('mouseleave', () => {
    elements.anchorTooltip.hidden = true;
  });

  function showAnchorTooltip(anchorEl, entry) {
    const tooltip = elements.anchorTooltip;
    tooltip.innerHTML = buildAnchorTooltipHtml(entry);
    tooltip.hidden = false;
    const aRect = anchorEl.getBoundingClientRect();
    const tRect = tooltip.getBoundingClientRect();
    let left = aRect.left + aRect.width / 2 - tRect.width / 2;
    left = Math.max(8, Math.min(window.innerWidth - tRect.width - 8, left));
    const top = aRect.top - tRect.height - 8;
    tooltip.style.left = String(left) + 'px';
    tooltip.style.top = String(top) + 'px';
  }

  function buildAnchorTooltipHtml(entry) {
    const parts = [];
    if (entry.isWorkingTree) {
      parts.push('<div class="anchor-tooltip-id">Current working tree</div>');
    } else {
      parts.push('<div class="anchor-tooltip-id">' + renderIdentifierMarkup(entry.shortRevision, entry.changeId) + '</div>');
    }
    if (entry.relativeDate) {
      parts.push('<div class="anchor-tooltip-meta">' + escapeHtml(entry.relativeDate) + '</div>');
    }
    if (entry.description) {
      parts.push('<div class="anchor-tooltip-desc">' + escapeHtml(entry.description.slice(0, 80)) + (entry.description.length > 80 ? '…' : '') + '</div>');
    }
    return parts.join('');
  }

  function getUnitPreviewRange(entryIndex) {
    const range = timelineModel.getUnitPreviewRange(state.visibleEntries, entryIndex);
    return range ? { ...range, comparisonSource: getEffectiveComparisonSource() } : null;
  }

  function getSidebarPreview(entryIndex) {
    const range = getUnitPreviewRange(entryIndex);
    if (!range) {
      return null;
    }

    return state.previewByRange[getPreviewKey(range.fromIndex, range.toIndex, range.comparisonSource)] || null;
  }

  function prefetchSidebarPreviews() {
    const isSnapshotSource = getEffectiveComparisonSource() === 'snapshot';
    if (isSnapshotSource && state.snapshotHydrationInFlight) {
      state.sidebarPreviewQueue = [];
      state.sidebarPreviewInFlightKey = '';
      return;
    }

    const previewRequests = timelineModel.getSidebarPreviewRequests(
      state.visibleEntries,
      getEffectiveComparisonSource(),
      state.previewByRange,
      state.sidebarPreviewInFlightKey,
      getPreviewKey,
      isSnapshotSource ? 4 : 6
    );
    state.sidebarPreviewQueue = previewRequests.sort((left, right) => {
      const activeIndex = state.toIndex;
      const leftDistance = Math.abs(left.toIndex - activeIndex);
      const rightDistance = Math.abs(right.toIndex - activeIndex);
      return leftDistance - rightDistance;
    });
    pumpSidebarPreviewQueue();
  }

  function getSourceEntries() {
    return timelineModel.getEntriesForSource(state.data, getEffectiveComparisonSource());
  }

  function getSnapshotHydrationRevisionIndexes() {
    if (!state.data || state.data.backend !== 'jj' || state.comparisonSource !== 'snapshot') {
      return [];
    }

    const loadedChangeIds = new Set(
      Array.isArray(state.data.snapshotState && state.data.snapshotState.loadedChangeIds)
        ? state.data.snapshotState.loadedChangeIds
        : []
    );
    const revisionEntries = timelineModel.getEntriesForSource(state.data, 'revision');
    const lastEntry = revisionEntries[revisionEntries.length - 1];
    if (!lastEntry) {
      return [];
    }

    const windowDays = state.data.presets[state.preset];
    const cutoff = Number.isFinite(windowDays)
      ? lastEntry.timestamp - windowDays * 24 * 60 * 60 * 1000
      : Number.NEGATIVE_INFINITY;

    const visibleRevisionEntries = revisionEntries
      .filter((entry) => entry.timestamp >= cutoff)
      .filter((entry) => state.showIntermediateRevisions || entry.touchesFile)
      .filter((entry) => entry.touchesFile);

    const preferredIndexes = [state.fromIndex, state.toIndex].filter((index) => Number.isInteger(index));
    return timelineModel.getPendingSnapshotRevisionIndexes(visibleRevisionEntries, loadedChangeIds, 8, preferredIndexes);
  }

  function requestSnapshotHydration() {
    if (state.snapshotHydrationInFlight) {
      return;
    }

    const revisionIndexes = getSnapshotHydrationRevisionIndexes();
    if (!revisionIndexes.length) {
      return;
    }

    state.snapshotHydrationInFlight = true;
    renderSnapshotLoadingIndicator();
    vscode.postMessage({
      command: 'hydrate-snapshot-entries',
      revisionIndexes,
    });
  }

  function pumpSidebarPreviewQueue() {
    if (state.sidebarPreviewInFlightKey || !state.sidebarPreviewQueue.length) {
      return;
    }

    const nextRequest = state.sidebarPreviewQueue.shift();
    if (!nextRequest) {
      return;
    }

    state.sidebarPreviewInFlightKey = nextRequest.key;
    vscode.postMessage({
      command: 'select-entry',
      fromIndex: nextRequest.fromIndex,
      toIndex: nextRequest.toIndex,
      comparisonSource: nextRequest.comparisonSource,
    });
  }

  function getPreviewKey(fromIndex, toIndex, comparisonSource = 'revision') {
    const normalizedFrom = Math.min(fromIndex, toIndex);
    const normalizedTo = Math.max(fromIndex, toIndex);
    return comparisonSource + ':' + String(normalizedFrom) + ':' + String(normalizedTo);
  }

  function renderStatChips(preview) {
    return [
      '<span class="stat stat--plus">+' + String(preview.additions) + '</span>',
      '<span class="stat stat--minus">-' + String(preview.deletions) + '</span>',
      '<span class="stat">' + String(preview.hunkCount) + ' hunks</span>',
    ].join('');
  }

  function renderNoTextualChanges(preview) {
    const details = Array.isArray(preview.nonTextualDetails) ? preview.nonTextualDetails : [];
    return '<div class="empty-diff"><div>No textual changes in this selection.</div>'
      + (details.length
        ? '<div class="empty-diff-details">' + details.map((detail) => '<div>' + escapeHtml(detail) + '</div>').join('') + '</div>'
        : '')
      + '</div>';
  }

  function formatDisplayDate(authorDate, fallbackLabel) {
    const date = new Date(authorDate);
    if (Number.isNaN(date.getTime())) {
      return fallbackLabel || 'Unknown date';
    }

    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function formatMonthLabel(authorDate, fallbackLabel) {
    const date = new Date(authorDate);
    if (Number.isNaN(date.getTime())) {
      return fallbackLabel || 'Unknown month';
    }

    return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(date);
  }

  function getDisplayRows(preview) {
    if (state.contentMode === 'full') {
      return preview.rows;
    }
    if (!preview.hasChanges) {
      return [];
    }
    return collapseRowsForPreview(preview.rows, getPreviewKey(preview.fromIndex, preview.toIndex), 3);
  }

  function collapseRowsForPreview(rows, previewKey, contextSize) {
    const changedIndexes = [];
    rows.forEach((row, index) => {
      if (row.type === 'add' || row.type === 'remove') {
        changedIndexes.push(index);
      }
    });
    if (!changedIndexes.length) {
      return [];
    }

    const ranges = [];
    changedIndexes.forEach((changeIndex) => {
      const start = Math.max(0, changeIndex - contextSize);
      const end = Math.min(rows.length - 1, changeIndex + contextSize);
      const previousRange = ranges[ranges.length - 1];
      if (!previousRange || start > previousRange[1] + 1) {
        ranges.push([start, end]);
      } else {
        previousRange[1] = Math.max(previousRange[1], end);
      }
    });

    const visible = [];
    let previousEnd = -1;
    ranges.forEach((range) => {
      const start = range[0];
      const end = range[1];
      visible.push.apply(visible, buildCollapsedSection(rows, previousEnd + 1, start - 1, previewKey));
      visible.push.apply(visible, rows.slice(start, end + 1));
      previousEnd = end;
    });
    visible.push.apply(visible, buildCollapsedSection(rows, previousEnd + 1, rows.length - 1, previewKey));
    return visible;
  }

  function buildCollapsedSection(rows, start, end, previewKey) {
    if (end < start) {
      return [];
    }
    const rangeKey = String(start) + ':' + String(end);
    const expandedState = state.expandedRanges[previewKey] || {};
    if (!expandedState[rangeKey]) {
      return [{
        type: 'skip',
        leftNumber: null,
        rightNumber: null,
        text: 'Show ' + String(end - start + 1) + ' unchanged lines',
        rangeKey: rangeKey,
        previewKey: previewKey,
      }];
    }

    return rows.slice(start, end + 1).concat([{
      type: 'skip',
      leftNumber: null,
      rightNumber: null,
      text: 'Hide ' + String(end - start + 1) + ' unchanged lines',
      rangeKey: rangeKey,
      previewKey: previewKey,
    }]);
  }

  function toggleRange(previewKey, rangeKey) {
    if (!state.expandedRanges[previewKey]) {
      state.expandedRanges[previewKey] = {};
    }
    state.expandedRanges[previewKey][rangeKey] = !state.expandedRanges[previewKey][rangeKey];
    renderPreview();
  }

  function renderUnifiedRow(row) {
    if (row.type === 'skip') {
      return renderSkipRow(row, 'diff-row');
    }
    const marker = row.type === 'add' ? '+' : row.type === 'remove' ? '-' : ' ';
    return [
      '<div class="diff-row diff-row--' + row.type + '">',
      '<div class="cell marker">' + marker + '</div>',
      '<div class="cell line-number">' + formatLineNumber(row.leftNumber) + '</div>',
      '<div class="cell line-number">' + formatLineNumber(row.rightNumber) + '</div>',
      '<div class="cell code">' + escapeHtml(row.text || ' ') + '</div>',
      '</div>',
    ].join('');
  }

  function renderSplitRows(rows) {
    return buildSplitRows(rows).map((row) => renderSplitRow(row)).join('');
  }

  function buildSplitRows(rows) {
    const splitRows = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.type === 'skip') {
        splitRows.push({ type: 'skip', skip: row });
        continue;
      }
      if (row.type === 'context') {
        splitRows.push({ type: 'context', left: row, right: row });
        continue;
      }

      const leftRows = [];
      const rightRows = [];
      while (index < rows.length && rows[index].type === 'remove') {
        leftRows.push(rows[index]);
        index += 1;
      }
      while (index < rows.length && rows[index].type === 'add') {
        rightRows.push(rows[index]);
        index += 1;
      }
      index -= 1;

      const pairCount = Math.max(leftRows.length, rightRows.length);
      for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
        splitRows.push({
          type: 'change',
          left: leftRows[pairIndex] || null,
          right: rightRows[pairIndex] || null,
        });
      }
    }
    return splitRows;
  }

  function renderSplitRow(row) {
    if (row.type === 'skip') {
      return renderSkipRow(row.skip, 'split-row');
    }
    if (row.type === 'context') {
      return [
        '<div class="split-row">',
        '<div class="split-cell split-number">' + formatLineNumber(row.left.leftNumber) + '</div>',
        '<div class="split-cell split-code">' + escapeHtml(row.left.text || ' ') + '</div>',
        '<div class="split-cell split-number">' + formatLineNumber(row.right.rightNumber) + '</div>',
        '<div class="split-cell split-code">' + escapeHtml(row.right.text || ' ') + '</div>',
        '</div>',
      ].join('');
    }
    return [
      '<div class="split-row split-row--change">',
      '<div class="split-cell split-number">' + formatLineNumber(row.left ? row.left.leftNumber : null) + '</div>',
      '<div class="split-cell split-code split-code--left">' + escapeHtml(row.left ? row.left.text || ' ' : ' ') + '</div>',
      '<div class="split-cell split-number">' + formatLineNumber(row.right ? row.right.rightNumber : null) + '</div>',
      '<div class="split-cell split-code split-code--right">' + escapeHtml(row.right ? row.right.text || ' ' : ' ') + '</div>',
      '</div>',
    ].join('');
  }

  function renderSkipRow(row, className) {
    return [
      '<div class="' + className + ' ' + className + '--skip">',
      '<button class="skip-button" type="button" data-preview-key="' + escapeHtml(row.previewKey || '') + '" data-range-key="' + escapeHtml(row.rangeKey || '') + '">',
      escapeHtml(row.text),
      '</button>',
      '</div>',
    ].join('');
  }

  function formatLineNumber(value) {
    return value == null ? '' : String(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  syncViewportState(true);
  vscode.postMessage({ command: 'ready' });
})();
