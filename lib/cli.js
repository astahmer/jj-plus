'use strict';

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

function parseRangeDiffArgs(argv) {
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
			options.workspacePath = requireValue('--workspace-path', arg.slice('--workspace-path='.length));
			continue;
		}

		throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
	}

	return options;
}

function parseTimelineArgs(argv) {
	const options = {
		help: false,
		filePath: undefined,
		open: true,
		port: 0,
		verbose: false,
		workspacePath: undefined,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];

		if (arg === '-h' || arg === '--help') {
			options.help = true;
			continue;
		}

		if (arg === '--no-open') {
			options.open = false;
			continue;
		}

		if (arg === '-v' || arg === '--verbose') {
			options.verbose = true;
			continue;
		}

		if (arg === '-f' || arg === '--file') {
			options.filePath = requireValue(arg, argv[index + 1]);
			index += 1;
			continue;
		}

		if (arg.startsWith('--file=')) {
			options.filePath = requireValue('--file', arg.slice('--file='.length));
			continue;
		}

		if (arg === '--port') {
			options.port = parsePort(requireValue(arg, argv[index + 1]));
			index += 1;
			continue;
		}

		if (arg.startsWith('--port=')) {
			options.port = parsePort(requireValue('--port', arg.slice('--port='.length)));
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
			options.workspacePath = requireValue('--workspace-path', arg.slice('--workspace-path='.length));
			continue;
		}

		if (arg.startsWith('-')) {
			throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
		}

		if (!options.filePath) {
			options.filePath = arg;
			continue;
		}

		throw new Error(`Unexpected positional argument: ${arg}\n\n${usage()}`);
	}

	return options;
}

function parsePort(value) {
	const port = Number.parseInt(value, 10);
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		throw new Error(`Invalid port: ${value}\n\n${usage()}`);
	}

	return port;
}

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

function requireValue(flag, value) {
	const trimmed = value?.trim();
	if (trimmed) {
		return trimmed;
	}

	throw new Error(`Missing value for ${flag}\n\n${usage()}`);
}

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

function buildUri(scheme, query) {
	return `${scheme}://${EXTENSION_ID}${URI_PATH}?${query}`;
}

function logVerbose(enabled, message) {
	if (!enabled) {
		return;
	}

	process.stderr.write(`${message}\n`);
}

function formatCommand(command, args) {
	return [command, ...args].map(quoteShellArg).join(' ');
}

function quoteShellArg(value) {
	if (/^[a-zA-Z0-9_@./:=+-]+$/u.test(value)) {
		return value;
	}

	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function usage() {
	return [
		'Usage:',
		'  jj-range-diff [options]',
		'  jj-range-diff timeline [options] <file>',
		'',
		'Range Diff Options:',
		'      --confirm                    Prompt before opening when launched from the CLI',
		'  -f, --from <revset>              From change id or revset',
		'      --ide <name>                 IDE preset or command (default: code)',
		'  -t, --to <revset>                To change id or revset',
		'      --base <revset>              Alias for --from',
		'      --target <revset>            Alias for --to',
		'      --title <title>              Override the tab title',
		'  -v, --verbose                    Log launches and show extra diagnostics',
		'  -w, --workspace <path>           Workspace path to resolve in VS Code',
		'      --workspace-path <path>      Alias for --workspace',
		'',
		'Standalone Timeline Options:',
		'  timeline <file>                  Open the timeline webview in the default browser',
		'  -f, --file <path>                File path inside the workspace (or absolute path)',
		'      --no-open                    Start the local server without opening the browser',
		'      --port <port>                Preferred local port (default: random free port)',
		'  -w, --workspace <path>           Workspace path containing the file (default: cwd)',
		'      --workspace-path <path>      Alias for --workspace',
		'  -h, --help                       Show this help message',
		'',
		'Environment:',
		'      JJ_RANGE_DIFF_IDE  Default IDE preset or command for the VS Code deep-link flow',
	].join('\n');
}

module.exports = {
	EXTENSION_ID,
	formatCommand,
	getLaunchers,
	logVerbose,
	parseRangeDiffArgs,
	parseTimelineArgs,
	resolveIde,
	usage,
};
