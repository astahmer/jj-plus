(function () {
  const mockEntries = [
    { index: 0, shortRevision: '0d2bb208', shortDate: 'Feb 28', monthLabel: 'February', relativeDate: '40 days ago', description: 'branch/commit selectors', timestamp: Date.parse('2026-02-28T12:00:00Z'), isWorkingTree: false },
    { index: 1, shortRevision: '83b03ba2', shortDate: 'Mar 1', monthLabel: 'March', relativeDate: '39 days ago', description: 'tsgo + noUncheckedIndexedAccess', timestamp: Date.parse('2026-03-01T12:00:00Z'), isWorkingTree: false },
    { index: 2, shortRevision: '204dd463', shortDate: 'Mar 1', monthLabel: 'March', relativeDate: '39 days ago', description: 'rename from/to -> base/head', timestamp: Date.parse('2026-03-01T16:00:00Z'), isWorkingTree: false },
    { index: 3, shortRevision: '6308f5fe', shortDate: 'Mar 1', monthLabel: 'March', relativeDate: '39 days ago', description: 'only show icon if expandable', timestamp: Date.parse('2026-03-01T18:00:00Z'), isWorkingTree: false },
    { index: 4, shortRevision: '5c3bc4fb', shortDate: 'Mar 22', monthLabel: 'March', relativeDate: '17 days ago', description: 'worktree tree changes (staged only or with unstaged)', timestamp: Date.parse('2026-03-22T22:20:59Z'), isWorkingTree: false },
    { index: 5, shortRevision: '2a43f3f8', shortDate: 'Mar 22', monthLabel: 'March', relativeDate: '17 days ago', description: 'better sidebar + global light/dark mode', timestamp: Date.parse('2026-03-22T22:40:59Z'), isWorkingTree: false },
    { index: 6, shortRevision: 'fdc8198e', shortDate: 'Mar 23', monthLabel: 'March', relativeDate: '17 days ago', description: 'fix global light/dark mode & ui tweaks', timestamp: Date.parse('2026-03-23T01:15:52Z'), isWorkingTree: false },
    { index: 7, shortRevision: 'Current', shortDate: 'Apr 9', monthLabel: 'April', relativeDate: 'this minute', description: 'Working tree', timestamp: Date.now(), isWorkingTree: true },
  ];

  const mockRows = [
    { type: 'context', leftNumber: 1, rightNumber: 1, text: 'import { FC, useState } from "react";' },
    { type: 'remove', leftNumber: 2, rightNumber: null, text: 'import { CommitInfo } from "~/lib/types";' },
    { type: 'add', leftNumber: null, rightNumber: 2, text: 'import { getCommitDisplayLabel, isLocalCommit } from "~/lib/local-refs";' },
    { type: 'add', leftNumber: null, rightNumber: 3, text: 'import { CommitInfo } from "~/lib/types";' },
    { type: 'context', leftNumber: 3, rightNumber: 4, text: '' },
    { type: 'skip', leftNumber: null, rightNumber: null, text: 'Show 22 unchanged lines', previewKey: '3:4', rangeKey: '4:25' },
    { type: 'context', leftNumber: 27, rightNumber: 28, text: 'const [headFirstLine, headRemaining] = headCommit.message.split("\\n", 2).map((v) => v.trim());' },
    { type: 'context', leftNumber: 28, rightNumber: 29, text: 'const [baseFirstLine, baseRemaining] = baseCommit.message.split("\\n", 2).map((v) => v.trim());' },
    { type: 'remove', leftNumber: 29, rightNumber: null, text: '' },
    { type: 'add', leftNumber: null, rightNumber: 30, text: 'const baseLabel = getCommitDisplayLabel(baseCommit);' },
    { type: 'add', leftNumber: null, rightNumber: 31, text: 'const headLabel = getCommitDisplayLabel(headCommit);' },
  ];

  function buildPreview(fromIndex, toIndex) {
    const normalizedFrom = Math.min(fromIndex, toIndex);
    const normalizedTo = Math.max(fromIndex, toIndex);
    const fromEntry = mockEntries[normalizedFrom];
    const toEntry = mockEntries[normalizedTo];
    return {
      index: normalizedTo,
      title: fromEntry.shortRevision + ' -> ' + toEntry.shortRevision,
      subtitle: toEntry.isWorkingTree ? 'Working tree' : toEntry.description,
      additions: 22 + normalizedTo,
      deletions: 19 + normalizedFrom,
      hunkCount: 8,
      hasChanges: true,
      fromIndex: normalizedFrom,
      toIndex: normalizedTo,
      rows: mockRows,
    };
  }

  const payload = {
    backend: 'git',
    workspacePath: '/tmp/mock',
    relativePath: 'src/components/commit-compare.tsx',
    fileName: 'commit-compare.tsx',
    presets: { month: 30, '7d': 7, '30d': 30, '90d': 90, all: Infinity },
    defaultIndex: 7,
    latestIndex: 7,
    preferences: { sidebarWidth: 280, sidebarCollapsed: false, layoutMode: 'split', contentMode: 'diffs', preset: '90d' },
    workspaceFiles: ['src/components/commit-compare.tsx', 'src/components/sidebar.tsx', 'src/lib/local-refs.ts'],
    entries: mockEntries,
  };

  window.__TIMELINE_DEV_BRIDGE__ = function (message) {
    if (message.command === 'ready' || message.command === 'refresh') {
      window.postMessage({ type: 'timeline-data', payload }, '*');
      window.postMessage({ type: 'diff-preview', payload: buildPreview(6, 7) }, '*');
      return;
    }
    if (message.command === 'select-entry') {
      window.postMessage({ type: 'diff-preview', payload: buildPreview(message.fromIndex, message.toIndex) }, '*');
      return;
    }
    console.log('timeline dev action', message);
  };
})();
