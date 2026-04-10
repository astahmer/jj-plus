const test = require('node:test');
const assert = require('node:assert/strict');

const { textsMatchIgnoringLineEndings, normalizeTextForComparison } = require('../lib/diff-helpers.js');
const { dedupeEntriesByChangeId, getGitHubRemoteBaseUrl, parseJjSummaryRenameLines } = require('../lib/history-helpers.js');
const { getEntriesForSource, getSelectedEntryCount, getSidebarPreviewRequests, getUnitPreviewRange } = require('../webview/timeline.model.js');

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

test('dedupeEntriesByChangeId keeps the latest entry for each JJ change', () => {
  assert.deepEqual(
    dedupeEntriesByChangeId([
      { revision: 'old-a', changeId: 'aaa' },
      { revision: 'old-b', changeId: 'bbb' },
      { revision: 'new-a', changeId: 'aaa' },
      { revision: 'new-c', changeId: 'ccc' },
    ]),
    [
      { revision: 'old-b', changeId: 'bbb' },
      { revision: 'new-a', changeId: 'aaa' },
      { revision: 'new-c', changeId: 'ccc' },
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
