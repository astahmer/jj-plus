import type { DiffPreview, FileRevisionEntry, TimelineData } from './types';

const now = Date.now();

export const mockEntries: FileRevisionEntry[] = [
  makeEntry(0, 'lovsqtms/4', '2026-04-09T15:04:25Z', 'prepare lazy di rollout', true, 'lvsqtms'),
  makeEntry(1, 'uvxlzutk/4', '2026-04-09T18:12:00Z', 'snapshot working copy', false, 'uvxlzutk'),
  makeEntry(2, 'vmuyrxrm/6', '2026-04-10T15:24:25Z', 'patch introduced by vmuyrxrm/6', true, 'vmuyrxrm'),
  makeEntry(3, 'wywrvxml/1', '2026-04-10T17:24:25Z', 'another change to the plan', false, 'wywrvxml'),
  makeEntry(4, 'wywrvxml/0', '2026-04-10T19:27:39Z', 'snapshot working copy', true, 'wywrvxml'),
  {
    ...makeEntry(5, 'Current', new Date(now).toISOString(), 'Working tree', true, 'working'),
    isWorkingTree: true,
    shortRevision: 'Current',
    revision: 'Current',
    touchesFile: true,
  },
];

export const mockData: TimelineData = {
  backend: 'jj',
  workspacePath: '/tmp/mock',
  relativePath: 'apps/backend/instructions/lazy-di-rollout-plan.md',
  fileName: 'lazy-di-rollout-plan.md',
  version: '0.0.2',
  presets: { year: 365, '7d': 7, '30d': 30, '90d': 90, all: Number.POSITIVE_INFINITY },
  defaultIndex: mockEntries.length - 1,
  latestIndex: mockEntries.length - 1,
  preferences: {
    sidebarWidth: 280,
    layoutMode: 'split',
    contentMode: 'diffs',
    comparisonMode: 'range',
    comparisonSource: 'snapshot',
    preset: '90d',
    showIntermediateRevisions: true,
  },
  workspaceFiles: [
    'apps/backend/instructions/lazy-di-rollout-plan.md',
    'apps/backend/src/lazy.ts',
    'package.json',
  ],
  hasIntermediateRevisions: true,
  entries: mockEntries,
  snapshotEntries: mockEntries,
  snapshotState: {
    loadedChangeIds: mockEntries.map((entry) => entry.changeId || '').filter(Boolean),
  },
};

export function buildMockPreview(fromIndex: number, toIndex: number): DiffPreview {
  const normalizedFrom = Math.min(fromIndex, toIndex);
  const normalizedTo = Math.max(fromIndex, toIndex);
  const fromEntry = mockEntries[normalizedFrom];
  const toEntry = mockEntries[normalizedTo];

  return {
    index: normalizedTo,
    title: `${fromEntry.shortRevision} -> ${toEntry.shortRevision}`,
    subtitle: toEntry.isWorkingTree ? 'snapshot working copy' : toEntry.description,
    additions: 7 + normalizedTo,
    deletions: 1 + normalizedFrom,
    hunkCount: 2,
    hasChanges: true,
    fromIndex: normalizedFrom,
    toIndex: normalizedTo,
    comparisonSource: 'snapshot',
    rows: [
      { type: 'context', leftNumber: 1, rightNumber: 1, text: '## What the PoC established' },
      { type: 'remove', leftNumber: 5, rightNumber: null, text: 'old line from previous revision' },
      { type: 'add', leftNumber: null, rightNumber: 5, text: 'another' },
      { type: 'add', leftNumber: null, rightNumber: 6, text: 'change' },
      { type: 'add', leftNumber: null, rightNumber: 7, text: 'to' },
      { type: 'add', leftNumber: null, rightNumber: 8, text: 'the' },
      { type: 'add', leftNumber: null, rightNumber: 9, text: 'plan' },
      { type: 'skip', leftNumber: null, rightNumber: null, text: 'Show 15 unchanged lines' },
      { type: 'context', leftNumber: 40, rightNumber: 46, text: '**HTTP `mainInjector` registers (baseline snapshot):**' },
    ],
    nonTextualDetails: [],
  };
}

function makeEntry(index: number, shortRevision: string, authorDate: string, description: string, touchesFile: boolean, changeId: string): FileRevisionEntry {
  const timestamp = Date.parse(authorDate);
  return {
    id: `${shortRevision}-${index}`,
    index,
    revision: shortRevision,
    shortRevision,
    changeId,
    authorDate,
    authorName: 'Alex',
    description,
    isWorkingTree: false,
    touchesFile,
    timestamp,
    hasPreviousEntry: index > 0,
    monthLabel: new Intl.DateTimeFormat('en', { month: 'long' }).format(timestamp),
    shortDate: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(timestamp),
    relativeDate: index === 5 ? 'this minute' : 'yesterday',
    remoteUrl: 'https://github.com/astahmer/visualjj-range-diff-helper',
  };
}