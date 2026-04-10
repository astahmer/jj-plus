const test = require('node:test');
const assert = require('node:assert/strict');

const { textsMatchIgnoringLineEndings, normalizeTextForComparison } = require('../lib/diff-helpers.js');
const { getGitHubRemoteBaseUrl, parseJjSummaryRenameLines } = require('../lib/history-helpers.js');

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
