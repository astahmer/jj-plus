(function () {
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
    preset: '90d',
    visibleEntries: [],
    fromIndex: 0,
    toIndex: 0,
    previewFromIndex: 0,
    previewToIndex: 0,
    stepStartIndex: 0,
    layoutMode: 'split',
    contentMode: 'diffs',
    comparisonMode: 'range',
    sidebarWidth: 280,
    sidebarCollapsed: false,
    expandedDescriptions: {},
    expandedRanges: {},
    previewTimer: undefined,
    persistTimer: undefined,
    menuOpen: false,
    compactViewport: false,
    sidebarShownOnCompact: false,
  };

  const elements = {
    workspace: document.getElementById('workspace'),
    resizeHandle: document.getElementById('resizeHandle'),
    fileSwitcher: document.getElementById('fileSwitcher'),
    workspaceFilesList: document.getElementById('workspaceFilesList'),
    actionsButton: document.getElementById('actionsButton'),
    actionsMenu: document.getElementById('actionsMenu'),
    toggleSidebarAction: document.getElementById('toggleSidebarAction'),
    openCurrentFileAction: document.getElementById('openCurrentFileAction'),
    openRangeFilesButton: document.getElementById('openRangeFilesButton'),
    openEditorButton: document.getElementById('openEditorButton'),
    refreshButton: document.getElementById('refreshButton'),
    rangeLabel: document.getElementById('rangeLabel'),
    rangeSubtitle: document.getElementById('rangeSubtitle'),
    fromPill: document.getElementById('fromPill'),
    toPill: document.getElementById('toPill'),
    rangeFill: document.getElementById('rangeFill'),
    fromSlider: document.getElementById('fromSlider'),
    toSlider: document.getElementById('toSlider'),
    fromHandleLabel: document.getElementById('fromHandleLabel'),
    toHandleLabel: document.getElementById('toHandleLabel'),
    track: document.querySelector('.track'),
    monthRow: document.getElementById('monthRow'),
    sidebarHint: document.getElementById('sidebarHint'),
    historyList: document.getElementById('historyList'),
    presets: document.getElementById('presets'),
    comparisonModes: document.getElementById('comparisonModes'),
    layoutModes: document.getElementById('layoutModes'),
    contentModes: document.getElementById('contentModes'),
    stepBackwardButton: document.getElementById('stepBackwardButton'),
    stepForwardButton: document.getElementById('stepForwardButton'),
    stepStatus: document.getElementById('stepStatus'),
    diffModeEyebrow: document.getElementById('diffModeEyebrow'),
    diffTitle: document.getElementById('diffTitle'),
    diffSubtitle: document.getElementById('diffSubtitle'),
    diffStats: document.getElementById('diffStats'),
    selectionMeta: document.getElementById('selectionMeta'),
    diffRows: document.getElementById('diffRows'),
  };

  const presetLabels = {
    month: 'This month',
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

  const compactViewportQuery = window.matchMedia('(max-width: 980px)');

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'timeline-data') {
      state.data = message.payload;
      applyPreferences(message.payload.preferences || {});
      state.fromIndex = Math.max(0, state.data.defaultIndex - 1);
      state.toIndex = state.data.defaultIndex || 0;
      state.preview = null;
      state.previewByRange = {};
      state.expandedRanges = {};

      if (!state.data.entries.length) {
        renderEmpty();
        return;
      }

      elements.fileSwitcher.value = state.data.relativePath;
      syncViewportState(true);
      renderWorkspaceFiles();
      applySidebarState();
      renderControlGroups();
      applyPreset(state.preset, true, true);
      return;
    }

    if (!message || message.type !== 'diff-preview') {
      return;
    }

    if (message.payload.fromIndex !== state.previewFromIndex || message.payload.toIndex !== state.previewToIndex) {
      return;
    }

    state.preview = message.payload;
    state.previewByRange[getPreviewKey(message.payload.fromIndex, message.payload.toIndex)] = message.payload;
    renderPreview();
    renderHistoryList();
  });

  elements.fromSlider.addEventListener('input', () => {
    const nextEntry = getEntryFromVisiblePosition(Number(elements.fromSlider.value));
    if (!nextEntry) {
      return;
    }

    state.fromIndex = Math.min(nextEntry.index, state.toIndex);
    renderSelection();
    requestPreview(70);
  });

  elements.toSlider.addEventListener('input', () => {
    const nextEntry = getEntryFromVisiblePosition(Number(elements.toSlider.value));
    if (!nextEntry) {
      return;
    }

    state.toIndex = Math.max(nextEntry.index, state.fromIndex);
    renderSelection();
    requestPreview(70);
  });

  elements.fromSlider.addEventListener('change', () => requestPreview(0));
  elements.toSlider.addEventListener('change', () => requestPreview(0));

  elements.stepBackwardButton.addEventListener('click', () => {
    navigateStep(-1);
  });

  elements.stepForwardButton.addEventListener('click', () => {
    navigateStep(1);
  });

  elements.actionsButton.addEventListener('click', (event) => {
    event.stopPropagation();
    state.menuOpen = !state.menuOpen;
    renderMenu();
  });

  document.addEventListener('click', () => {
    if (!state.menuOpen) {
      return;
    }
    state.menuOpen = false;
    renderMenu();
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

  elements.refreshButton.addEventListener('click', () => {
    closeMenu();
    vscode.postMessage({ command: 'refresh' });
  });

  elements.toggleSidebarAction.addEventListener('click', () => {
    closeMenu();
    if (state.compactViewport) {
      const nextCollapsed = !getSidebarCollapsed();
      state.sidebarCollapsed = false;
      state.sidebarShownOnCompact = !nextCollapsed;
    } else {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    }
    applySidebarState();
    persistPreferences();
  });

  elements.fileSwitcher.addEventListener('change', submitFileSwitch);
  elements.fileSwitcher.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submitFileSwitch();
    }
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

  [elements.rangeFill, elements.fromPill, elements.toPill].forEach((element) => {
    element.addEventListener('pointerdown', (event) => {
      beginRangeDrag(event);
    });
  });

  if (typeof compactViewportQuery.addEventListener === 'function') {
    compactViewportQuery.addEventListener('change', () => syncViewportState(false));
  } else if (typeof compactViewportQuery.addListener === 'function') {
    compactViewportQuery.addListener(() => syncViewportState(false));
  }

  function renderControlGroups() {
    renderSegmentedControl(elements.comparisonModes, comparisonModeLabels, state.comparisonMode, (value) => {
      if (value === state.comparisonMode) {
        return;
      }
      state.comparisonMode = value;
      if (state.comparisonMode === 'step') {
        ensureStepRange();
        state.stepStartIndex = state.fromIndex;
      }
      syncActivePreviewRange();
      renderControlGroups();
      renderSelection();
      persistPreferences();
      requestPreview(0);
    });

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

  function applySidebarState() {
    document.documentElement.style.setProperty('--sidebar-width', String(state.sidebarWidth) + 'px');
    const isCollapsed = getSidebarCollapsed();
    elements.workspace.classList.toggle('is-collapsed', isCollapsed);
    elements.workspace.classList.toggle('is-compact', state.compactViewport);
    elements.toggleSidebarAction.textContent = isCollapsed ? 'Show Revisions' : 'Hide Revisions';
  }

  function applyPreferences(preferences) {
    state.sidebarWidth = typeof preferences.sidebarWidth === 'number' ? preferences.sidebarWidth : state.sidebarWidth;
    state.sidebarCollapsed = preferences.sidebarCollapsed === true;
    state.layoutMode = preferences.layoutMode === 'unified' ? 'unified' : 'split';
    state.contentMode = preferences.contentMode === 'full' ? 'full' : 'diffs';
    state.comparisonMode = preferences.comparisonMode === 'step' ? 'step' : 'range';
    state.preset = presetLabels[preferences.preset] ? preferences.preset : '90d';
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
        layoutMode: state.layoutMode,
        contentMode: state.contentMode,
        comparisonMode: state.comparisonMode,
        preset: state.preset,
      });
    }, 80);
  }

  function renderMenu() {
    elements.actionsMenu.classList.toggle('open', state.menuOpen);
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

  function postRangeAction(command, range) {
    const nextRange = range || getCommandRange(command);
    vscode.postMessage({
      command: command,
      fromIndex: nextRange.fromIndex,
      toIndex: nextRange.toIndex,
    });
  }

  function applyPreset(preset, resetSelection, suppressPreviewRequest) {
    state.preset = preset;
    const allEntries = state.data.entries;
    const lastEntry = allEntries[allEntries.length - 1];
    const windowDays = state.data.presets[preset];
    const cutoff = Number.isFinite(windowDays)
      ? lastEntry.timestamp - windowDays * 24 * 60 * 60 * 1000
      : Number.NEGATIVE_INFINITY;

    const filtered = allEntries.filter((entry) => entry.timestamp >= cutoff);
    state.visibleEntries = filtered.length >= 2 ? filtered : allEntries;

    if (resetSelection || !state.visibleEntries.some((entry) => entry.index === state.toIndex)) {
      state.toIndex = state.visibleEntries[state.visibleEntries.length - 1].index;
    }
    if (resetSelection || !state.visibleEntries.some((entry) => entry.index === state.fromIndex)) {
      state.fromIndex = Math.max(state.visibleEntries[0].index, state.toIndex - 1);
    }

    state.fromIndex = Math.min(state.fromIndex, state.toIndex);
    ensureStepRange();
    syncActivePreviewRange();
    renderControlGroups();
    renderSelection();
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

    ensureStepRange();
    syncActivePreviewRange();

    const fromVisibleIndex = Math.max(0, state.visibleEntries.findIndex((entry) => entry.index === state.fromIndex));
    const toVisibleIndex = Math.max(0, state.visibleEntries.findIndex((entry) => entry.index === state.toIndex));
    const fromEntry = state.visibleEntries[fromVisibleIndex];
    const toEntry = state.visibleEntries[toVisibleIndex];
    const activeRange = getActivePreviewRange();
    const activeFromEntry = state.data.entries[activeRange.fromIndex] || fromEntry;
    const activeToEntry = state.data.entries[activeRange.toIndex] || toEntry;
    const first = state.visibleEntries[0];
    const last = state.visibleEntries[state.visibleEntries.length - 1];
    const knownPreview = state.previewByRange[getPreviewKey(activeRange.fromIndex, activeRange.toIndex)];

    elements.fromSlider.max = String(Math.max(0, state.visibleEntries.length - 1));
    elements.toSlider.max = String(Math.max(0, state.visibleEntries.length - 1));
    elements.fromSlider.value = String(fromVisibleIndex);
    elements.toSlider.value = String(toVisibleIndex);
    positionRangeVisuals(fromVisibleIndex, toVisibleIndex);

    elements.fromPill.textContent = 'From ' + formatEntryShort(fromEntry);
    elements.toPill.textContent = 'To ' + formatEntryShort(toEntry);
    elements.fromHandleLabel.textContent = 'From ' + fromEntry.shortRevision;
    elements.toHandleLabel.textContent = 'To ' + toEntry.shortRevision;
    elements.rangeLabel.textContent = activeFromEntry.shortRevision + ' -> ' + activeToEntry.shortRevision;
    elements.rangeSubtitle.textContent = formatRangeSubtitle(fromEntry, toEntry, first, last);
    elements.sidebarHint.textContent = getSidebarCollapsed() ? '' : 'Range';
    elements.selectionMeta.textContent = formatSelectionMeta(activeFromEntry, activeToEntry, knownPreview, fromEntry, toEntry);
    elements.diffModeEyebrow.textContent = layoutModeLabels[state.layoutMode] + ' · ' + contentModeLabels[state.contentMode] + ' · ' + comparisonModeLabels[state.comparisonMode];
    renderStepControls();

    renderMonths();
    renderHistoryList();
    renderPreview();
  }

  function positionRangeVisuals(fromVisibleIndex, toVisibleIndex) {
    const denominator = Math.max(1, state.visibleEntries.length - 1);
    const fromPercent = (fromVisibleIndex / denominator) * 100;
    const toPercent = (toVisibleIndex / denominator) * 100;
    elements.fromPill.style.left = String(fromPercent) + '%';
    elements.toPill.style.left = String(toPercent) + '%';
    elements.rangeFill.style.left = String(fromPercent) + '%';
    elements.rangeFill.style.width = String(Math.max(0, toPercent - fromPercent)) + '%';
  }

  function formatEntryShort(entry) {
    return entry.isWorkingTree ? 'Current' : entry.shortDate + ' · ' + entry.shortRevision;
  }

  function formatSelectionMeta(fromEntry, toEntry, preview, selectedFromEntry, selectedToEntry) {
    const parts = [];
    if (state.comparisonMode === 'step' && selectedFromEntry && selectedToEntry && selectedFromEntry.index !== selectedToEntry.index) {
      parts.push(formatMetaLabel(fromEntry, 'from') + ' -> ' + formatMetaLabel(toEntry, 'to'));
      parts.push('inside ' + selectedFromEntry.shortRevision + ' -> ' + selectedToEntry.shortRevision);
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

  function formatRangeSubtitle(fromEntry, toEntry, first, last) {
    const base = String(state.visibleEntries.length) + ' revisions in ' + state.data.backend.toUpperCase() + ' history · ' + first.shortDate + ' - ' + (last.isWorkingTree ? 'Today' : last.shortDate);
    if (state.comparisonMode !== 'step' || fromEntry.index === toEntry.index) {
      return base;
    }
    return 'Step ' + String(getStepPosition() + 1) + ' of ' + String(getStepCount()) + ' inside ' + fromEntry.shortRevision + ' -> ' + toEntry.shortRevision + ' · ' + base;
  }

  function getEntryFromVisiblePosition(position) {
    return state.visibleEntries[position] || null;
  }

  function renderMonths() {
    const labels = [];
    const seen = new Set();
    state.visibleEntries.forEach((entry) => {
      if (!seen.has(entry.monthLabel)) {
        seen.add(entry.monthLabel);
        labels.push(entry.monthLabel);
      }
    });

    const compact = labels.slice(-4);
    elements.monthRow.innerHTML = compact.map((label) => {
      const active = state.visibleEntries.some((entry) =>
        (entry.index === state.fromIndex || entry.index === state.toIndex) && entry.monthLabel === label
      );
      return '<div>' + (active ? '<strong>' + label + '</strong>' : label) + '</div>';
    }).join('');
  }

  function renderHistoryList() {
    if (!state.visibleEntries.length) {
      elements.historyList.innerHTML = '<div class="empty">No revisions in the current filter.</div>';
      return;
    }

    elements.historyList.innerHTML = '';
    state.visibleEntries.slice().reverse().forEach((entry) => {
      const preview = state.previewByRange[getPreviewKey(entry.index, state.toIndex)] || state.previewByRange[getPreviewKey(state.fromIndex, entry.index)] || null;
      const descriptionExpanded = Boolean(state.expandedDescriptions[String(entry.index)]);
      const showMore = entry.description.length > 48;
      const isFrom = entry.index === state.fromIndex;
      const isTo = entry.index === state.toIndex;
      const inRange = entry.index >= Math.min(state.fromIndex, state.toIndex) && entry.index <= Math.max(state.fromIndex, state.toIndex);
      const button = document.createElement('button');
      button.className = 'history-item' + (isFrom || isTo ? ' active' : '') + (inRange ? ' in-range' : '');
      button.type = 'button';
      button.addEventListener('click', () => {
        if (Math.abs(entry.index - state.fromIndex) <= Math.abs(entry.index - state.toIndex)) {
          state.fromIndex = Math.min(entry.index, state.toIndex);
        } else {
          state.toIndex = Math.max(entry.index, state.fromIndex);
        }
        renderSelection();
        requestPreview(0);
      });

      button.innerHTML = [
        '<div class="history-top">',
        '<div class="history-primary"><strong>' + escapeHtml(entry.shortRevision) + '</strong>' + renderHistoryBadges(isFrom, isTo) + '</div>',
        '<span>' + escapeHtml(entry.shortDate) + '</span>',
        '</div>',
        '<div class="history-description' + (descriptionExpanded || !showMore ? '' : ' is-truncated') + '">' + escapeHtml(entry.description) + '</div>',
        '<div class="history-bottom">',
        '<span class="history-meta">' + escapeHtml(entry.relativeDate) + '</span>',
        '<span class="history-stats">' + (preview ? renderHistoryStats(preview) : '') + '</span>',
        '</div>',
        showMore ? '<button class="history-more" type="button">' + (descriptionExpanded ? 'Less' : 'More') + '</button>' : '',
      ].join('');

      if (showMore) {
        const moreButton = button.querySelector('.history-more');
        if (moreButton) {
          moreButton.addEventListener('click', (event) => {
            event.stopPropagation();
            state.expandedDescriptions[String(entry.index)] = !descriptionExpanded;
            renderHistoryList();
          });
        }
      }

      elements.historyList.appendChild(button);
    });
  }

  function renderHistoryBadges(isFrom, isTo) {
    const parts = [];
    if (isFrom) {
      parts.push('<span class="mini-badge from">FROM</span>');
    }
    if (isTo) {
      parts.push('<span class="mini-badge to">TO</span>');
    }
    return parts.join('');
  }

  function renderHistoryStats(preview) {
    return [
      '<span class="stat stat--plus">+' + String(preview.additions) + '</span>',
      '<span class="stat stat--minus">-' + String(preview.deletions) + '</span>',
    ].join('');
  }

  function renderPreview() {
    if (!state.data) {
      return;
    }

    const activeRange = getActivePreviewRange();
    const fromEntry = state.data.entries[activeRange.fromIndex];
    const toEntry = state.data.entries[activeRange.toIndex];
    if (!fromEntry || !toEntry) {
      elements.diffTitle.textContent = 'No diff available';
      elements.diffSubtitle.textContent = '';
      elements.diffStats.innerHTML = '';
      elements.diffRows.innerHTML = '<div class="empty-diff">Pick a revision range to inspect it.</div>';
      return;
    }

    if (!state.preview || state.preview.fromIndex !== activeRange.fromIndex || state.preview.toIndex !== activeRange.toIndex) {
      elements.diffTitle.textContent = 'Loading diff…';
      elements.diffSubtitle.textContent = toEntry.description;
      elements.diffStats.innerHTML = '';
      elements.diffRows.innerHTML = '<div class="empty-diff">Computing diff preview…</div>';
      return;
    }

    elements.diffTitle.textContent = state.preview.title;
    elements.diffSubtitle.textContent = state.preview.subtitle;
    elements.diffStats.innerHTML = renderStatChips(state.preview);

    const visibleRows = getDisplayRows(state.preview);
    if (!visibleRows.length) {
      elements.diffRows.innerHTML = state.contentMode === 'full'
        ? '<div class="empty-diff">The file has no content at this revision.</div>'
        : '<div class="empty-diff">No textual changes in this selection.</div>';
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
    if (state.comparisonMode === 'step') {
      return {
        fromIndex: state.previewFromIndex,
        toIndex: state.previewToIndex,
      };
    }

    return {
      fromIndex: state.fromIndex,
      toIndex: state.toIndex,
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

  function ensureStepRange() {
    if (!state.visibleEntries.length) {
      return;
    }

    if (state.comparisonMode === 'step' && state.fromIndex === state.toIndex) {
      const nextEntry = state.visibleEntries.find((entry) => entry.index > state.fromIndex);
      if (nextEntry) {
        state.toIndex = nextEntry.index;
      } else if (state.visibleEntries.length >= 2) {
        state.fromIndex = state.visibleEntries[state.visibleEntries.length - 2].index;
        state.toIndex = state.visibleEntries[state.visibleEntries.length - 1].index;
      }
    }
  }

  function syncActivePreviewRange() {
    if (state.comparisonMode !== 'step') {
      state.previewFromIndex = state.fromIndex;
      state.previewToIndex = state.toIndex;
      state.stepStartIndex = Math.min(Math.max(state.stepStartIndex, state.fromIndex), Math.max(state.fromIndex, state.toIndex - 1));
      return;
    }

    const maxStepStart = Math.max(state.fromIndex, state.toIndex - 1);
    state.stepStartIndex = Math.min(Math.max(state.stepStartIndex, state.fromIndex), maxStepStart);
    state.previewFromIndex = state.stepStartIndex;
    state.previewToIndex = Math.min(state.toIndex, state.stepStartIndex + 1);
  }

  function renderStepControls() {
    const stepCount = getStepCount();
    const canNavigate = stepCount > 1;
    elements.stepBackwardButton.disabled = !canNavigate;
    elements.stepForwardButton.disabled = !canNavigate;

    if (state.comparisonMode === 'range') {
      elements.stepStatus.textContent = stepCount > 1
        ? 'Range view · ' + String(stepCount) + ' single diffs available'
        : 'Range view';
      return;
    }

    elements.stepStatus.textContent = 'Step ' + String(getStepPosition() + 1) + ' of ' + String(Math.max(1, stepCount));
    elements.stepBackwardButton.disabled = getStepPosition() <= 0;
    elements.stepForwardButton.disabled = getStepPosition() >= stepCount - 1;
  }

  function getStepCount() {
    return Math.max(0, state.toIndex - state.fromIndex);
  }

  function getStepPosition() {
    return Math.max(0, state.stepStartIndex - state.fromIndex);
  }

  function navigateStep(direction) {
    const stepCount = getStepCount();
    if (!stepCount) {
      return;
    }

    if (state.comparisonMode !== 'step') {
      state.comparisonMode = 'step';
      state.stepStartIndex = direction < 0 ? Math.max(state.fromIndex, state.toIndex - 1) : state.fromIndex;
    } else {
      const maxStepStart = Math.max(state.fromIndex, state.toIndex - 1);
      state.stepStartIndex = Math.min(Math.max(state.stepStartIndex + direction, state.fromIndex), maxStepStart);
    }

    syncActivePreviewRange();
    renderControlGroups();
    renderSelection();
    persistPreferences();
    requestPreview(0);
  }

  function beginRangeDrag(event) {
    if (!state.visibleEntries.length || !elements.track) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const trackRect = elements.track.getBoundingClientRect();
    if (!trackRect.width) {
      return;
    }

    const startFromVisibleIndex = Math.max(0, state.visibleEntries.findIndex((entry) => entry.index === state.fromIndex));
    const startToVisibleIndex = Math.max(0, state.visibleEntries.findIndex((entry) => entry.index === state.toIndex));
    const rangeSize = Math.max(0, startToVisibleIndex - startFromVisibleIndex);
    const stepOffset = state.stepStartIndex - state.fromIndex;
    const denominator = Math.max(1, state.visibleEntries.length - 1);
    const startX = event.clientX;

    elements.rangeFill.classList.add('is-dragging');
    elements.fromPill.classList.add('is-dragging');
    elements.toPill.classList.add('is-dragging');

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    function onPointerMove(moveEvent) {
      const deltaRatio = (moveEvent.clientX - startX) / trackRect.width;
      const deltaSteps = Math.round(deltaRatio * denominator);
      const maxStart = Math.max(0, state.visibleEntries.length - 1 - rangeSize);
      const nextFromVisibleIndex = Math.min(Math.max(startFromVisibleIndex + deltaSteps, 0), maxStart);
      const nextToVisibleIndex = nextFromVisibleIndex + rangeSize;
      const nextFromEntry = state.visibleEntries[nextFromVisibleIndex];
      const nextToEntry = state.visibleEntries[nextToVisibleIndex];
      if (!nextFromEntry || !nextToEntry) {
        return;
      }

      state.fromIndex = nextFromEntry.index;
      state.toIndex = nextToEntry.index;
      if (state.comparisonMode === 'step') {
        state.stepStartIndex = Math.min(Math.max(state.fromIndex + stepOffset, state.fromIndex), Math.max(state.fromIndex, state.toIndex - 1));
      }
      syncActivePreviewRange();
      renderSelection();
      requestPreview(70);
    }

    function onPointerUp() {
      elements.rangeFill.classList.remove('is-dragging');
      elements.fromPill.classList.remove('is-dragging');
      elements.toPill.classList.remove('is-dragging');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      requestPreview(0);
    }
  }

  function getPreviewKey(fromIndex, toIndex) {
    const normalizedFrom = Math.min(fromIndex, toIndex);
    const normalizedTo = Math.max(fromIndex, toIndex);
    return String(normalizedFrom) + ':' + String(normalizedTo);
  }

  function renderStatChips(preview) {
    return [
      '<span class="stat stat--plus">+' + String(preview.additions) + '</span>',
      '<span class="stat stat--minus">-' + String(preview.deletions) + '</span>',
      '<span class="stat">' + String(preview.hunkCount) + ' hunks</span>',
    ].join('');
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
