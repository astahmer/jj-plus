import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRangeDiffArgs, parseTimelineArgs, resolveCliInvocation } from '../../src/cli/options.ts';
import { renderPreviewText } from '../../src/standalone/server.ts';

test('resolveCliInvocation keeps the implicit default flow and exposes an explicit diff alias', () => {
	assert.deepEqual(resolveCliInvocation(['--from', 'main', '--to', '@']), {
		command: 'range-diff',
		argv: ['--from', 'main', '--to', '@'],
	});
	assert.deepEqual(resolveCliInvocation(['diff', '--from', 'main', '--to', '@']), {
		command: 'range-diff',
		argv: ['--from', 'main', '--to', '@'],
	});
	assert.deepEqual(resolveCliInvocation(['timeline', 'README.md']), {
		command: 'timeline',
		argv: ['README.md'],
	});
});

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
		},
	);
});

test('parseTimelineArgs accepts positional files and standalone-specific options', () => {
	assert.deepEqual(parseTimelineArgs(['--workspace', '/tmp/repo', '--port', '4123', '--no-open', 'README.md']), {
		help: false,
		filePath: 'README.md',
		open: false,
		json: false,
		port: 4123,
		verbose: false,
		workspacePath: '/tmp/repo',
	});
});

test('parseTimelineArgs --json implies --no-open', () => {
	assert.deepEqual(parseTimelineArgs(['--json', 'src/a.ts']), {
		help: false,
		filePath: 'src/a.ts',
		open: false,
		json: true,
		port: 0,
		verbose: false,
		workspacePath: undefined,
	});
});

test('parseTimelineArgs rejects invalid ports', () => {
	assert.throws(() => parseTimelineArgs(['--port', '90000', 'README.md']), /Invalid port/);
});

test('renderPreviewText prints the preview header and file sides in a readable export format', () => {
	const rendered = renderPreviewText(
		{
			index: 1,
			title: 'abc123 -> def456',
			subtitle: 'Working tree',
			diffCount: 0,
			additions: 1,
			deletions: 1,
			hunkCount: 1,
			hasChanges: true,
			fromIndex: 0,
			toIndex: 1,
			comparisonSource: 'revision',
			nonTextualDetails: ['Binary file changed'],
			beforePath: 'src/example.ts',
			afterPath: 'src/example.ts',
			beforeText: 'const value = 1;\nold line\n',
			afterText: 'const value = 1;\nnew line\n',
		},
		'src/example.ts',
	);

	assert.match(rendered, /src\/example\.ts/);
	assert.match(rendered, /abc123 -> def456/);
	assert.match(rendered, /Binary file changed/);
	assert.match(rendered, /===== before =====/);
	assert.match(rendered, /old line/);
	assert.match(rendered, /===== after =====/);
	assert.match(rendered, /new line/);
});
