import assert from 'node:assert/strict';
import test from 'node:test';
import { OPEN_TIMELINE_AT_LINE_COMMAND } from '../../src/extension/constants.ts';
import {
	buildCurrentLineBlameHoverMarkdown,
	buildTimelineAtLineCodeLens,
	formatCurrentLineBlameDecoration,
	formatTimelineAtLineHoverTitle,
	truncateBlameSummary,
} from '../../src/extension/timeline-at-line.ts';

test('buildTimelineAtLineCodeLens returns jjplus title and command payload', () => {
	const lens = buildTimelineAtLineCodeLens({ absolutePath: '/tmp/repo/src/a.ts', line: 12 });
	assert.equal(lens.title, 'JJ Plus: Open revision timeline · line 12');
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
	assert.match(text, /^ {2}Ada, last week • polish timeline tooltips$/);
});

test('hover title includes author relative time and short desc', () => {
	assert.match(
		formatTimelineAtLineHoverTitle({
			line: 9,
			author: 'Ada Lovelace',
			when: 'last week',
			summary: 'polish tooltips',
		}),
		/line 9 — Ada · last week · polish tooltips/,
	);
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
	assert.match(markdown, /\*\*Ada\*\* · 2d ago/);
	assert.match(markdown, /short/);
	assert.match(markdown, /long body/);
	assert.match(markdown, new RegExp(OPEN_TIMELINE_AT_LINE_COMMAND));
	assert.match(markdown, /Open revision timeline at line 4/);
	assert.match(markdown, /Line 4 · Revision `abcdef123456`/);
	assert.doesNotMatch(markdown, /Author:|Date:|Revision:|Summary:/);
});

test('buildCurrentLineBlameHoverMarkdown keeps commit text from changing hover structure', () => {
	const markdown = buildCurrentLineBlameHoverMarkdown({
		entry: {
			line: 2,
			revision: 'abcdef1234567890',
			author: 'Ada [Lovelace]',
			authorDate: 'today',
			summary: 'fix *hover* [labels]',
		},
		absolutePath: '/tmp/repo/a.ts',
		line: 2,
	});
	assert.ok(markdown.includes('Ada \\[Lovelace\\]'));
	assert.ok(markdown.includes('fix \\*hover\\* \\[labels\\]'));
	assert.equal(markdown.split('Open revision timeline at line 2').length - 1, 1);
});

test('truncateBlameSummary ellipsizes long text', () => {
	assert.equal(truncateBlameSummary('hello world', 20), 'hello world');
	assert.equal(truncateBlameSummary('abcdefghijklmnopqrstuvwxyz', 10), 'abcdefghi…');
});
