const test = require('node:test');
const assert = require('node:assert/strict');

const { parseRangeDiffArgs, parseTimelineArgs } = require('../lib/cli.js');
const { renderPreviewText } = require('../lib/standalone-webview.js');

test('parseRangeDiffArgs accepts aliases and preserves the existing deep-link flags', () => {
	assert.deepEqual(
		parseRangeDiffArgs(['--confirm', '--base', 'main', '--target', '@', '--title', 'Review', '--ide', 'cursor']),
		{
			help: false,
			confirm: true,
			from: 'main',
			ide: 'cursor',
			to: '@',
			title: 'Review',
			verbose: false,
			workspacePath: undefined,
		}
	);
});

test('parseTimelineArgs accepts positional files and standalone-specific options', () => {
	assert.deepEqual(
		parseTimelineArgs(['--workspace', '/tmp/repo', '--port', '4123', '--no-open', 'README.md']),
		{
			help: false,
			filePath: 'README.md',
			open: false,
			port: 4123,
			verbose: false,
			workspacePath: '/tmp/repo',
		}
	);
});

test('parseTimelineArgs rejects invalid ports', () => {
	assert.throws(
		() => parseTimelineArgs(['--port', '90000', 'README.md']),
		/Invalid port/
	);
});

test('renderPreviewText prints the preview header and line rows in a readable export format', () => {
	const rendered = renderPreviewText({
		title: 'abc123 -> def456',
		subtitle: 'Working tree',
		additions: 1,
		deletions: 1,
		hunkCount: 1,
		nonTextualDetails: ['Binary file changed'],
		rows: [
			{ type: 'context', leftNumber: 1, rightNumber: 1, text: 'const value = 1;' },
			{ type: 'remove', leftNumber: 2, rightNumber: null, text: 'old line' },
			{ type: 'add', leftNumber: null, rightNumber: 2, text: 'new line' },
			{ type: 'skip', leftNumber: null, rightNumber: null, text: 'Show 8 unchanged lines' },
		],
	}, 'src/example.ts');

	assert.match(rendered, /src\/example\.ts/);
	assert.match(rendered, /abc123 -> def456/);
	assert.match(rendered, /Binary file changed/);
	assert.match(rendered, /\+   \s+2 new line/);
	assert.match(rendered, /-    2\s+ old line/);
	assert.match(rendered, /@@ Show 8 unchanged lines @@/);
});
