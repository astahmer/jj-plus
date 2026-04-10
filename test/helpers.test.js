const test = require('node:test');
const assert = require('node:assert/strict');

const { textsMatchIgnoringLineEndings, normalizeTextForComparison } = require('../lib/diff-helpers.js');
const { dedupeAdjacentEntriesByChangeId, getGitHubRemoteBaseUrl, parseJjEvolutionLine, parseJjSummaryRenameLines } = require('../lib/history-helpers.js');
const { getEntriesForSource, getSelectedEntryCount, getSidebarPreviewRequests, getTimelineAnchorPercent, getUnitPreviewRange } = require('../webview/timeline.model.js');

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

test('getEntriesForSource returns snapshot entries only for JJ snapshot mode', () => {
  const data = {
    backend: 'jj',
    entries: [{ index: 0, revision: 'rev-1' }],
    snapshotEntries: [{ index: 0, revision: 'snap-1' }, { index: 1, revision: 'snap-2' }],
  };
  assert.deepEqual(getEntriesForSource(data, 'revision'), data.entries);
  assert.deepEqual(getEntriesForSource(data, 'snapshot'), data.snapshotEntries);
  assert.deepEqual(getEntriesForSource({ ...data, backend: 'git' }, 'snapshot'), data.entries);
});

test('timeline model computes unit preview ranges and selected counts', () => {
  const visibleEntries = [{ index: 4 }, { index: 8 }, { index: 10 }, { index: 14 }];
  assert.deepEqual(getUnitPreviewRange(visibleEntries, 10), { fromIndex: 8, toIndex: 10 });
  assert.equal(getUnitPreviewRange(visibleEntries, 4), null);
  assert.equal(getSelectedEntryCount(visibleEntries, 8, 14), 3);
});

test('timeline model positions anchors by timestamp, not just index', () => {
  const visibleEntries = [
    { index: 0, timestamp: 100 },
    { index: 1, timestamp: 190 },
    { index: 2, timestamp: 200 },
  ];

  assert.equal(getTimelineAnchorPercent(visibleEntries, 0), 0);
  assert.equal(getTimelineAnchorPercent(visibleEntries, 2), 100);
  assert.equal(getTimelineAnchorPercent(visibleEntries, 1), 90);
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
