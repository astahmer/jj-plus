import assert from 'node:assert/strict';
import test from 'node:test';
import { OPEN_TIMELINE_AT_LINE_COMMAND } from '../../src/extension/constants.ts';
import {
	buildCurrentLineBlameHoverMarkdown,
	buildTimelineAtLineCodeLens,
	formatCurrentLineBlameDecoration,
	truncateBlameSummary,
} from '../../src/extension/timeline-at-line.ts';

test('buildTimelineAtLineCodeLens returns jjplus title and command payload', () => {
	const lens = buildTimelineAtLineCodeLens({ absolutePath: '/tmp/repo/src/a.ts', line: 12 });
	assert.equal(lens.title, 'jjplus: Open revision timeline · line 12');
	assert.equal(lens.command, OPEN_TIMELINE_AT_LINE_COMMAND);
	assert.deepEqual(lens.arguments, [{ absolutePath: '/tmp/repo/src/a.ts', line: 12 }]);
});

test('formatCurrentLineBlameDecoration puts author date and summary on the right', () => {
	const text = formatCurrentLineBlameDecoration({
		line: 1,
		revision: 'abcdef1234567890',
		author: 'Ada Lovelace',
		authorDate: 'last week',
		summary: 'polish timeline tooltips',
	});
	assert.match(text, /^ {2}Ada · last week · polish timeline tooltips$/);
});

test('buildCurrentLineBlameHoverMarkdown includes open-timeline command link', () => {
	const markdown = buildCurrentLineBlameHoverMarkdown({
		entry: {
			line: 4,
			revision: 'abcdef1234567890',
			author: 'Ada',
			authorDate: '2d ago',
			summary: 'short',
		},
		absolutePath: '/tmp/repo/a.ts',
		line: 4,
		fullDescription: 'long body\nmore',
	});
	assert.match(markdown, /Ada · 2d ago/);
	assert.match(markdown, /short/);
	assert.match(markdown, /long body/);
	assert.match(markdown, new RegExp(OPEN_TIMELINE_AT_LINE_COMMAND));
	assert.match(markdown, /Open revision timeline/);
});

test('truncateBlameSummary ellipsizes long text', () => {
	assert.equal(truncateBlameSummary('hello world', 20), 'hello world');
	assert.equal(truncateBlameSummary('abcdefghijklmnopqrstuvwxyz', 10), 'abcdefghi…');
});
