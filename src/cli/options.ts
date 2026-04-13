export const EXTENSION_ID = 'astahmer.jj-range-diff';
const URI_PATH = '/open-range-multi-diff';
const DEFAULT_IDE = 'code';

type RangeDiffCliOptions = {
	help: boolean;
	confirm: boolean;
	from?: string;
	ide?: string;
	to?: string;
	title?: string;
	verbose: boolean;
	workspacePath?: string;
};

type TimelineCliOptions = {
	help: boolean;
	filePath?: string;
	open: boolean;
	port: number;
	verbose: boolean;
	workspacePath?: string;
};

type IdePreset = {
	command: string;
	schemes: string[];
};

const idePresets: Record<string, IdePreset> = {
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

export function parseRangeDiffArgs(argv: string[]): RangeDiffCliOptions {
	const options: RangeDiffCliOptions = {
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
			options.from = requireValue({ flag: arg, value: argv[index + 1] });
			index += 1;
			continue;
		}

		if (arg.startsWith('--from=')) {
			options.from = requireValue({ flag: '--from', value: arg.slice('--from='.length) });
			continue;
		}

		if (arg.startsWith('--base=')) {
			options.from = requireValue({ flag: '--base', value: arg.slice('--base='.length) });
			continue;
		}

		if (arg === '-t' || arg === '--to' || arg === '--target') {
			options.to = requireValue({ flag: arg, value: argv[index + 1] });
			index += 1;
			continue;
		}

		if (arg.startsWith('--to=')) {
			options.to = requireValue({ flag: '--to', value: arg.slice('--to='.length) });
			continue;
		}

		if (arg.startsWith('--target=')) {
			options.to = requireValue({ flag: '--target', value: arg.slice('--target='.length) });
			continue;
		}

		if (arg === '--title') {
			options.title = requireValue({ flag: arg, value: argv[index + 1] });
			index += 1;
			continue;
		}

		if (arg.startsWith('--title=')) {
			options.title = requireValue({ flag: '--title', value: arg.slice('--title='.length) });
			continue;
		}

		if (arg === '--ide') {
			options.ide = requireValue({ flag: arg, value: argv[index + 1] });
			index += 1;
			continue;
		}

		if (arg.startsWith('--ide=')) {
			options.ide = requireValue({ flag: '--ide', value: arg.slice('--ide='.length) });
			continue;
		}

		if (arg === '-w' || arg === '--workspace' || arg === '--workspace-path') {
			options.workspacePath = requireValue({ flag: arg, value: argv[index + 1] });
			index += 1;
			continue;
		}

		if (arg.startsWith('--workspace=')) {
			options.workspacePath = requireValue({ flag: '--workspace', value: arg.slice('--workspace='.length) });
			continue;
		}

		if (arg.startsWith('--workspace-path=')) {
			options.workspacePath = requireValue({ flag: '--workspace-path', value: arg.slice('--workspace-path='.length) });
			continue;
		}

		throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
	}

	return options;
}

export function parseTimelineArgs(argv: string[]): TimelineCliOptions {
	const options: TimelineCliOptions = {
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
			options.filePath = requireValue({ flag: arg, value: argv[index + 1] });
			index += 1;
			continue;
		}

		if (arg.startsWith('--file=')) {
			options.filePath = requireValue({ flag: '--file', value: arg.slice('--file='.length) });
			continue;
		}

		if (arg === '--port') {
			options.port = parsePort(requireValue({ flag: arg, value: argv[index + 1] }));
			index += 1;
			continue;
		}

		if (arg.startsWith('--port=')) {
			options.port = parsePort(requireValue({ flag: '--port', value: arg.slice('--port='.length) }));
			continue;
		}

		if (arg === '-w' || arg === '--workspace' || arg === '--workspace-path') {
			options.workspacePath = requireValue({ flag: arg, value: argv[index + 1] });
			index += 1;
			continue;
		}

		if (arg.startsWith('--workspace=')) {
			options.workspacePath = requireValue({ flag: '--workspace', value: arg.slice('--workspace='.length) });
			continue;
		}

		if (arg.startsWith('--workspace-path=')) {
			options.workspacePath = requireValue({ flag: '--workspace-path', value: arg.slice('--workspace-path='.length) });
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

export function resolveIde(rawIde?: string): IdePreset {
	const trimmed = rawIde?.trim() || DEFAULT_IDE;
	const preset = idePresets[trimmed.toLowerCase()];
	if (preset) {
		return preset;
	}

	return {
		command: trimmed,
		schemes: [trimmed],
	};
}

export function getLaunchers(query: string, ide: IdePreset): Array<{ command: string; args: string[] }> {
	const uris = ide.schemes.map((scheme) => buildUri({ scheme, query }));

	if (process.platform === 'darwin') {
		return uris.map((uri) => ({ command: 'open', args: [uri] }));
	}

	if (process.platform === 'win32') {
		return uris.map((uri) => ({ command: 'cmd', args: ['/c', 'start', '', uri] }));
	}

	return uris.map((uri) => ({ command: 'xdg-open', args: [uri] }));
}

export function logVerbose(enabled: boolean, message: string): void {
	if (!enabled) {
		return;
	}

	process.stderr.write(`${message}\n`);
}

export function formatCommand(command: string, args: string[]): string {
	return [command, ...args].map(quoteShellArg).join(' ');
}

export function usage(): string {
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

function parsePort(value: string): number {
	const port = Number.parseInt(value, 10);
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		throw new Error(`Invalid port: ${value}\n\n${usage()}`);
	}

	return port;
}

function requireValue({ flag, value }: { flag: string; value?: string }): string {
	const trimmed = value?.trim();
	if (trimmed) {
		return trimmed;
	}

	throw new Error(`Missing value for ${flag}\n\n${usage()}`);
}

function buildUri({ scheme, query }: { scheme: string; query: string }): string {
	return `${scheme}://${EXTENSION_ID}${URI_PATH}?${query}`;
}

function quoteShellArg(value: string): string {
	if (/^[a-zA-Z0-9_@./:=+-]+$/u.test(value)) {
		return value;
	}

	return `'${value.replace(/'/g, `'\\''`)}'`;
}
