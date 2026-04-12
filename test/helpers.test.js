const test = require('node:test');
const assert = require('node:assert/strict');

const { textsMatchIgnoringLineEndings, normalizeTextForComparison } = require('../lib/diff-helpers.js');
const { dedupeAdjacentEntriesByChangeId, getGitHubRemoteBaseUrl, normalizeSnapshotOperationKey, parseJjEvolutionLine, parseJjEvolutionSummaryEntries, parseJjSummaryChangedPaths, parseJjSummaryRenameLines } = require('../lib/history-helpers.js');
const { getEntriesForSource, getIntermediateToggleLabel, getPendingSelectionRange, getPendingSnapshotRevisionIndexes, getSelectedEntryCount, getSidebarPreviewRequests, getTimelineAnchorPercent, getUnitPreviewRange } = require('../lib/timeline-model.js');

test('normalizeTextForComparison normalizes CRLF to LF', () => {
  assert.equal(normalizeTextForComparison('a\r\nb\r\n'), 'a\nb\n');
});

test('textsMatchIgnoringLineEndings treats CRLF and LF as equal', () => {
  assert.equal(textsMatchIgnoringLineEndings('a\r\nb\r\n', 'a\nb\n'), true);
  assert.equal(textsMatchIgnoringLineEndings('a\nb\n', 'a\nc\n'), false);
});

test('parseJjSummaryRenameLines extracts renamed paths from jj diff summary output', () => {
  assert.deepEqual(
    parseJjSummaryRenameLines([
      'M src/index.js',
      'R old/name.ts => new/name.ts',
      'A src/added.ts',
      'R docs/old.md => docs/new.md',
    ].join('\n')),
    [
      { fromPath: 'old/name.ts', toPath: 'new/name.ts' },
      { fromPath: 'docs/old.md', toPath: 'docs/new.md' },
    ]
  );
});

test('parseJjEvolutionLine prefers commit description but keeps operation metadata available', () => {
  assert.deepEqual(
    parseJjEvolutionLine('38adf0870a65\tyvsqu\t2026-04-10T16:07:57+02:00\tAlex\tsnapshot working copy\tfix knip config'),
    {
      revision: '38adf0870a65',
      changeId: 'yvsqu',
      authorDate: '2026-04-10T16:07:57+02:00',
      authorName: 'Alex',
      description: 'fix knip config',
      operationDescription: 'snapshot working copy',
    }
  );
});

test('parseJjEvolutionLine falls back to operation description when commit description is empty', () => {
  assert.deepEqual(
    parseJjEvolutionLine('6db8e51d08d2\tyvsqu\t2026-04-10T16:07:57+02:00\tAlex\tsnapshot working copy\t'),
    {
      revision: '6db8e51d08d2',
      changeId: 'yvsqu',
      authorDate: '2026-04-10T16:07:57+02:00',
      authorName: 'Alex',
      description: 'snapshot working copy',
      operationDescription: 'snapshot working copy',
    }
  );
});

test('parseJjEvolutionSummaryEntries parses metadata and per-entry summaries from jj evolog --summary output', () => {
  const entries = parseJjEvolutionSummaryEntries([
    'kqppukkm/72 alex@example.com 2026-04-08 13:51:51 021cab5d (hidden)',
    '(no description set)',
    '-- operation 10938023ba48 snapshot working copy',
    'M knip.jsonc',
    'kqppukkm/73 alex@example.com 2026-04-08 13:51:40 f1bd5a80 (hidden)',
    'fix config',
    '-- operation 832f9ee85116 snapshot working copy',
    'R old/name.ts => new/name.ts',
  ].join('\n'));

  assert.deepEqual(entries, [
    {
      changeKey: 'kqppukkm/72',
      changeId: 'kqppukkm',
      operationIndex: 72,
      authorDate: '2026-04-08T13:51:51',
      authorName: 'alex@example.com',
      revision: '021cab5d',
      description: '(no description set)',
      operationId: '10938023ba48',
      operationDescription: 'snapshot working copy',
      summaryLines: ['M knip.jsonc'],
    },
    {
      changeKey: 'kqppukkm/73',
      changeId: 'kqppukkm',
      operationIndex: 73,
      authorDate: '2026-04-08T13:51:40',
      authorName: 'alex@example.com',
      revision: 'f1bd5a80',
      description: 'fix config',
      operationId: '832f9ee85116',
      operationDescription: 'snapshot working copy',
      summaryLines: ['R old/name.ts => new/name.ts'],
    },
  ]);
});

test('parseJjEvolutionSummaryEntries keeps the commit revision when a visible header includes bookmarks', () => {
  const [entry] = parseJjEvolutionSummaryEntries([
    'kqppukkm alex@example.com 2026-04-09 12:32:35 chore/rm-unused-endpoints 4c3a9ffa',
    'rm more unused stuff',
    '-- operation 49a69c738364 squash commits into 0c5b72791d43296dfc536cc1c83c914684d16667',
  ].join('\n'));

  assert.equal(entry.revision, '4c3a9ffa');
});

test('normalizeSnapshotOperationKey adds an explicit zero suffix for the visible revision snapshot', () => {
  assert.equal(normalizeSnapshotOperationKey('kqppukkm'), 'kqppukkm/0');
  assert.equal(normalizeSnapshotOperationKey('kqppukkm/4'), 'kqppukkm/4');
});

test('parseJjSummaryChangedPaths includes direct and renamed paths', () => {
  assert.deepEqual(
    parseJjSummaryChangedPaths([
      'M knip.jsonc',
      'R old/name.ts => new/name.ts',
      'D stale/file.ts',
    ]),
    ['knip.jsonc', 'stale/file.ts', 'old/name.ts', 'new/name.ts']
  );
});

test('getGitHubRemoteBaseUrl supports https and ssh remotes', () => {
  assert.equal(
    getGitHubRemoteBaseUrl('https://github.com/astahmer/visualjj-range-diff-helper.git'),
    'https://github.com/astahmer/visualjj-range-diff-helper'
  );
  assert.equal(
    getGitHubRemoteBaseUrl('git@github.com:astahmer/visualjj-range-diff-helper.git'),
    'https://github.com/astahmer/visualjj-range-diff-helper'
  );
  assert.equal(getGitHubRemoteBaseUrl('https://gitlab.com/astahmer/example.git'), undefined);
});

test('dedupeAdjacentEntriesByChangeId only collapses consecutive JJ evolutions', () => {
  assert.deepEqual(
    dedupeAdjacentEntriesByChangeId([
      { revision: 'a1', changeId: 'aaa' },
      { revision: 'a2', changeId: 'aaa' },
      { revision: 'b1', changeId: 'bbb' },
      { revision: 'a3', changeId: 'aaa' },
    ]),
    [
      { revision: 'a1', changeId: 'aaa' },
      { revision: 'b1', changeId: 'bbb' },
      { revision: 'a3', changeId: 'aaa' },
    ]
  );
});

test('getEntriesForSource progressively expands hydrated JJ snapshot entries', () => {
  const data = {
    backend: 'jj',
    entries: [
      { index: 0, revision: 'rev-1', changeId: 'aaa', touchesFile: true },
      { index: 1, revision: 'rev-2', changeId: 'bbb', touchesFile: true },
    ],
    snapshotEntries: [
      { index: 0, revision: 'snap-1', changeId: 'aaa', touchesFile: true },
      { index: 1, revision: 'snap-2', changeId: 'aaa', touchesFile: true },
    ],
    snapshotState: {
      loadedChangeIds: ['aaa'],
    },
  };
  assert.deepEqual(getEntriesForSource(data, 'revision'), data.entries);
  assert.deepEqual(getEntriesForSource(data, 'snapshot'), [
    { index: 0, revision: 'snap-1', changeId: 'aaa', touchesFile: true },
    { index: 1, revision: 'snap-2', changeId: 'aaa', touchesFile: true },
    { index: 2, revision: 'rev-2', changeId: 'bbb', touchesFile: true },
  ]);
  assert.deepEqual(getEntriesForSource({ ...data, backend: 'git' }, 'snapshot'), data.entries);
});

test('timeline model computes unit preview ranges and selected counts', () => {
  const visibleEntries = [{ index: 4 }, { index: 8 }, { index: 10 }, { index: 14 }];
  assert.deepEqual(getUnitPreviewRange(visibleEntries, 10), { fromIndex: 8, toIndex: 10 });
  assert.equal(getUnitPreviewRange(visibleEntries, 4), null);
  assert.equal(getSelectedEntryCount(visibleEntries, 8, 14), 3);
});

test('timeline model derives the pending selection range from the anchored start and hovered end', () => {
  const visibleEntries = [
    { index: 1, revision: 'a' },
    { index: 4, revision: 'b' },
    { index: 9, revision: 'c' },
  ];

  assert.deepEqual(getPendingSelectionRange(visibleEntries, 9, 4), {
    fromEntry: visibleEntries[1],
    toEntry: visibleEntries[2],
    selectedCount: 2,
  });
  assert.equal(getPendingSelectionRange(visibleEntries, 4, 4), null);
  assert.equal(getPendingSelectionRange(visibleEntries, null, 4), null);
});

test('timeline model formats the in-between toggle label with visible and total counts', () => {
  assert.equal(getIntermediateToggleLabel(5, 9, false), 'Show In-Between 5/9');
  assert.equal(getIntermediateToggleLabel(9, 9, true), 'Hide In-Between 9/9');
  assert.equal(getIntermediateToggleLabel(0, 0, false), 'Show In-Between');
});

test('timeline model positions anchors with equal spacing across visible entries', () => {
  const visibleEntries = [
    { index: 0, timestamp: 100 },
    { index: 1, timestamp: 190 },
    { index: 2, timestamp: 200 },
  ];

  assert.equal(getTimelineAnchorPercent(visibleEntries, 0), 0);
  assert.equal(getTimelineAnchorPercent(visibleEntries, 2), 100);
  assert.equal(getTimelineAnchorPercent(visibleEntries, 1), 50);
});

test('timeline model prioritizes selected changes when choosing pending snapshot hydration batches', () => {
  const revisionEntries = [
    { index: 0, changeId: 'aaa', touchesFile: true },
    { index: 1, changeId: 'bbb', touchesFile: true },
    { index: 2, changeId: 'ccc', touchesFile: true },
    { index: 3, changeId: 'ddd', touchesFile: true, isWorkingTree: true },
  ];

  assert.deepEqual(
    getPendingSnapshotRevisionIndexes(revisionEntries, new Set(['aaa']), 2, [2]),
    [2, 1]
  );
});

test('timeline model builds sidebar preview requests for uncached unit ranges', () => {
  const visibleEntries = [{ index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }];
  const previewByRange = { 'revision:1:2': { additions: 1 } };
  assert.deepEqual(
    getSidebarPreviewRequests(visibleEntries, 'revision', previewByRange, 'revision:2:3', (fromIndex, toIndex, source) => `${source}:${fromIndex}:${toIndex}`),
    [
      { key: 'revision:3:4', fromIndex: 3, toIndex: 4, comparisonSource: 'revision' },
    ]
  );
});
