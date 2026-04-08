#!/usr/bin/env node

'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const EXTENSION_ID = 'astahmer.jj-range-diff';
const URI_PATH = '/open-range-multi-diff';
const DEFAULT_IDE = 'code';
const IDE_PRESETS = {
	code: { command: process.env.VSCODE_BIN || 'code', schemes: ['vscode', 'vscode-insiders'] },
	vscode: { command: process.env.VSCODE_BIN || 'code', schemes: ['vscode', 'vscode-insiders'] },
	'code-insiders': { command: 'code-insiders', schemes: ['vscode-insiders'] },
	'vscode-insiders': { command: 'code-insiders', schemes: ['vscode-insiders'] },
	cursor: { command: 'cursor', schemes: ['cursor'] },
	'cursor-insiders': { command: 'cursor-insiders', schemes: ['cursor-insiders', 'cursor'] },
	zed: { command: 'zed', schemes: ['zed'] },
	windsurf: { command: 'windsurf', schemes: ['windsurf'] },
	codium: { command: 'codium', schemes: ['vscodium', 'vscode'] },
};

main();

function main() {
	const options = parseArgs(process.argv.slice(2));

	if (options.help) {
		process.stdout.write(`${usage()}\n`);
		return;
	}

	const workspacePath = options.workspacePath || process.cwd();
	const resolvedWorkspacePath = path.resolve(workspacePath);
	const ide = resolveIde(options.ide);
	const params = new URLSearchParams();

	params.set('workspacePath', resolvedWorkspacePath);
	params.set('source', 'cli');

	if (options.from) {
		params.set('from', options.from);
	}

	if (options.to) {
		params.set('to', options.to);
	}

	if (options.title) {
		params.set('title', options.title);
	}

	if (options.confirm) {
		params.set('confirm', '1');
	}

	if (options.verbose) {
		params.set('verbose', '1');
	}

	openWorkspace(resolvedWorkspacePath, ide, options.verbose);

	const launchers = getLaunchers(params.toString(), ide);
	let lastFailure;

	for (const launcher of launchers) {
		logVerbose(options.verbose, `Launching deep link: ${formatCommand(launcher.command, launcher.args)}`);
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
		`Failed to open IDE for ${EXTENSION_ID}. ${lastFailure || 'No supported launcher was found.'}\n`
	);
	process.exitCode = 1;
}

/**
 * @param {string} workspacePath
 * @param {{ command: string, schemes: string[] }} ide
 * @param {boolean} verbose
 */
function openWorkspace(workspacePath, ide, verbose) {
	const args = ['-r', workspacePath];
	logVerbose(verbose, `Opening workspace: ${formatCommand(ide.command, args)}`);
	const result = spawnSync(ide.command, args, { stdio: 'ignore' });

	if (result.error && result.error.code !== 'ENOENT') {
		process.stderr.write(`Warning: failed to focus workspace via ${ide.command}: ${result.error.message}\n`);
	}
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
	const options = {
		help: false,
		confirm: false,
		from: undefined,
		ide: process.env.JJ_RANGE_DIFF_IDE || undefined,
		to: undefined,
		title: undefined,
		verbose: false,
		workspacePath: undefined,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];

		if (arg === '-h' || arg === '--help') {
			options.help = true;
			continue;
		}

		if (arg === '--confirm') {
			options.confirm = true;
			continue;
		}

		if (arg === '-v' || arg === '--verbose') {
			options.verbose = true;
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

		if (arg === '--ide') {
			options.ide = requireValue(arg, argv[index + 1]);
			index += 1;
			continue;
		}

		if (arg.startsWith('--ide=')) {
			options.ide = requireValue('--ide', arg.slice('--ide='.length));
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
 * @param {string | undefined} rawIde
 */
function resolveIde(rawIde) {
	const trimmed = rawIde?.trim() || DEFAULT_IDE;
	const preset = IDE_PRESETS[trimmed.toLowerCase()];
	if (preset) {
		return preset;
	}

	return {
		command: trimmed,
		schemes: [trimmed],
	};
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
 * @param {{ command: string, schemes: string[] }} ide
 */
function getLaunchers(query, ide) {
	const uris = ide.schemes.map((scheme) => buildUri(scheme, query));
	const launchers = [];

	if (process.platform === 'darwin') {
		for (const uri of uris) {
			launchers.push({ command: 'open', args: [uri] });
		}
	} else if (process.platform === 'win32') {
		for (const uri of uris) {
			launchers.push({ command: 'cmd', args: ['/c', 'start', '', uri] });
		}
	} else {
		for (const uri of uris) {
			launchers.push({ command: 'xdg-open', args: [uri] });
		}
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

/**
 * @param {boolean} enabled
 * @param {string} message
 */
function logVerbose(enabled, message) {
	if (!enabled) {
		return;
	}

	process.stderr.write(`${message}\n`);
}

/**
 * @param {string} command
 * @param {string[]} args
 */
function formatCommand(command, args) {
	return [command, ...args].map(quoteShellArg).join(' ');
}

/**
 * @param {string} value
 */
function quoteShellArg(value) {
	if (/^[a-zA-Z0-9_@./:=+-]+$/u.test(value)) {
		return value;
	}

	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function usage() {
	return [
		'Usage: jj-range-diff [options]',
		'',
		'Options:',
		'      --confirm                    Prompt before opening when launched from the CLI',
		'  -f, --from <revset>              From change id or revset',
		'      --ide <name>                 IDE preset or command (default: code)',
		'  -t, --to <revset>                To change id or revset',
		'      --base <revset>              Alias for --from',
		'      --target <revset>            Alias for --to',
		'      --title <title>              Override the tab title',
		'  -v, --verbose                    Log IDE launches and show the extension output channel',
		'  -w, --workspace <path>           Workspace path to resolve in VS Code',
		'      --workspace-path <path>      Alias for --workspace',
		'  -h, --help                       Show this help message',
		'',
		'Environment:',
		'      JJ_RANGE_DIFF_IDE  Default IDE preset or command',
	].join('\n');
}
