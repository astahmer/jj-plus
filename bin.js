#!/usr/bin/env node

'use strict';

const { spawnSync } = require('node:child_process');

const EXTENSION_ID = 'astahmer.visualjj-range-diff-helper';
const URI_PATH = '/open-range-multi-diff';

main();

function main() {
	const options = parseArgs(process.argv.slice(2));

	if (options.help) {
		process.stdout.write(`${usage()}\n`);
		return;
	}

	const workspacePath = options.workspacePath || process.cwd();
	const params = new URLSearchParams();

	params.set('workspacePath', workspacePath);

	if (options.base) {
		params.set('base', options.base);
	}

	if (options.target) {
		params.set('target', options.target);
	}

	if (options.title) {
		params.set('title', options.title);
	}

	const launchers = getLaunchers(params.toString());
	let lastFailure;

	for (const launcher of launchers) {
		const result = spawnSync(launcher.command, launcher.args, { stdio: 'inherit' });

		if (result.error) {
			if (result.error.code === 'ENOENT') {
				continue;
			}

			lastFailure = `${launcher.command}: ${result.error.message}`;
			continue;
		}

		if (result.status === 0) {
			return;
		}

		lastFailure = `${launcher.command} exited with status ${result.status}`;
	}

	process.stderr.write(
		`Failed to open VS Code for ${EXTENSION_ID}. ${lastFailure || 'No supported launcher was found.'}\n`
	);
	process.exitCode = 1;
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
	const options = {
		help: false,
		base: undefined,
		target: undefined,
		title: undefined,
		workspacePath: undefined,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];

		if (arg === '-h' || arg === '--help') {
			options.help = true;
			continue;
		}

		if (arg === '-b' || arg === '--base') {
			options.base = requireValue(arg, argv[index + 1]);
			index += 1;
			continue;
		}

		if (arg.startsWith('--base=')) {
			options.base = requireValue('--base', arg.slice('--base='.length));
			continue;
		}

		if (arg === '-t' || arg === '--target') {
			options.target = requireValue(arg, argv[index + 1]);
			index += 1;
			continue;
		}

		if (arg.startsWith('--target=')) {
			options.target = requireValue('--target', arg.slice('--target='.length));
			continue;
		}

		if (arg === '--title') {
			options.title = requireValue(arg, argv[index + 1]);
			index += 1;
			continue;
		}

		if (arg.startsWith('--title=')) {
			options.title = requireValue('--title', arg.slice('--title='.length));
			continue;
		}

		if (arg === '-w' || arg === '--workspace' || arg === '--workspace-path') {
			options.workspacePath = requireValue(arg, argv[index + 1]);
			index += 1;
			continue;
		}

		if (arg.startsWith('--workspace=')) {
			options.workspacePath = requireValue('--workspace', arg.slice('--workspace='.length));
			continue;
		}

		if (arg.startsWith('--workspace-path=')) {
			options.workspacePath = requireValue(
				'--workspace-path',
				arg.slice('--workspace-path='.length)
			);
			continue;
		}

		throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
	}

	return options;
}

/**
 * @param {string} flag
 * @param {string | undefined} value
 */
function requireValue(flag, value) {
	const trimmed = value?.trim();
	if (trimmed) {
		return trimmed;
	}

	throw new Error(`Missing value for ${flag}\n\n${usage()}`);
}

/**
 * @param {string} query
 */
function getLaunchers(query) {
	const stableUri = buildUri('vscode', query);
	const insidersUri = buildUri('vscode-insiders', query);
	const launchers = [
		{
			command: process.env.VSCODE_BIN || 'code',
			args: ['--open-url', stableUri],
		},
		{
			command: process.env.VSCODE_INSIDERS_BIN || 'code-insiders',
			args: ['--open-url', insidersUri],
		},
	];

	if (process.platform === 'darwin') {
		launchers.push({ command: 'open', args: [stableUri] });
	} else if (process.platform === 'win32') {
		launchers.push({ command: 'cmd', args: ['/c', 'start', '', stableUri] });
	} else {
		launchers.push({ command: 'xdg-open', args: [stableUri] });
	}

	return launchers;
}

/**
 * @param {string} scheme
 * @param {string} query
 */
function buildUri(scheme, query) {
	return `${scheme}://${EXTENSION_ID}${URI_PATH}?${query}`;
}

function usage() {
	return [
		'Usage: visualjj-range-diff-helper [options]',
		'',
		'Options:',
		'  -b, --base <revset>              Base change id or revset',
		'  -t, --target <revset>            Target change id or revset',
		'      --title <title>              Override the tab title',
		'  -w, --workspace <path>           Workspace path to resolve in VS Code',
		'      --workspace-path <path>      Alias for --workspace',
		'  -h, --help                       Show this help message',
	].join('\n');
}
