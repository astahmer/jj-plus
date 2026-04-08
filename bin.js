#!/usr/bin/env node

'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

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
	const resolvedWorkspacePath = path.resolve(workspacePath);
	const params = new URLSearchParams();

	params.set('workspacePath', resolvedWorkspacePath);

	if (options.from) {
		params.set('from', options.from);
	}

	if (options.to) {
		params.set('to', options.to);
	}

	if (options.title) {
		params.set('title', options.title);
	}

	openWorkspace(resolvedWorkspacePath);

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
 * @param {string} workspacePath
 */
function openWorkspace(workspacePath) {
	const command = process.env.VSCODE_BIN || 'code';
	const result = spawnSync(command, ['-r', workspacePath], { stdio: 'ignore' });

	if (result.error && result.error.code !== 'ENOENT') {
		process.stderr.write(`Warning: failed to focus workspace via ${command}: ${result.error.message}\n`);
	}
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
	const options = {
		help: false,
		from: undefined,
		to: undefined,
		title: undefined,
		workspacePath: undefined,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];

		if (arg === '-h' || arg === '--help') {
			options.help = true;
			continue;
		}

		if (arg === '-f' || arg === '--from' || arg === '-b' || arg === '--base') {
			options.from = requireValue(arg, argv[index + 1]);
			index += 1;
			continue;
		}

		if (arg.startsWith('--from=')) {
			options.from = requireValue('--from', arg.slice('--from='.length));
			continue;
		}

		if (arg.startsWith('--base=')) {
			options.from = requireValue('--base', arg.slice('--base='.length));
			continue;
		}

		if (arg === '-t' || arg === '--to' || arg === '--target') {
			options.to = requireValue(arg, argv[index + 1]);
			index += 1;
			continue;
		}

		if (arg.startsWith('--to=')) {
			options.to = requireValue('--to', arg.slice('--to='.length));
			continue;
		}

		if (arg.startsWith('--target=')) {
			options.to = requireValue('--target', arg.slice('--target='.length));
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
	const launchers = [];

	if (process.platform === 'darwin') {
		launchers.push({ command: 'open', args: [stableUri] });
		launchers.push({ command: 'open', args: [insidersUri] });
	} else if (process.platform === 'win32') {
		launchers.push({ command: 'cmd', args: ['/c', 'start', '', stableUri] });
		launchers.push({ command: 'cmd', args: ['/c', 'start', '', insidersUri] });
	} else {
		launchers.push({ command: 'xdg-open', args: [stableUri] });
		launchers.push({ command: 'xdg-open', args: [insidersUri] });
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
		'  -f, --from <revset>              From change id or revset',
		'  -t, --to <revset>                To change id or revset',
		'      --base <revset>              Alias for --from',
		'      --target <revset>            Alias for --to',
		'      --title <title>              Override the tab title',
		'  -w, --workspace <path>           Workspace path to resolve in VS Code',
		'      --workspace-path <path>      Alias for --workspace',
		'  -h, --help                       Show this help message',
	].join('\n');
}
