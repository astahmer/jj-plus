import assert from 'node:assert/strict';
import test from 'node:test';
import { OPEN_TIMELINE_AT_LINE_COMMAND } from '../../src/extension/constants.ts';
import { buildTimelineAtLineCodeLens } from '../../src/extension/timeline-at-line.ts';

test('buildTimelineAtLineCodeLens returns hardened title and command payload', () => {
	const lens = buildTimelineAtLineCodeLens({ absolutePath: '/tmp/repo/src/a.ts', line: 12 });
	assert.equal(lens.title, 'Open JJ timeline · line 12');
	assert.equal(lens.command, OPEN_TIMELINE_AT_LINE_COMMAND);
	assert.deepEqual(lens.arguments, [{ absolutePath: '/tmp/repo/src/a.ts', line: 12 }]);
});
