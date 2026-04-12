#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
	EXTENSION_ID,
	formatCommand,
	getLaunchers,
	logVerbose,
	parseRangeDiffArgs,
	parseTimelineArgs,
	resolveIde,
	usage,
} = require('./lib/cli.js');

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});

async function main() {
	const argv = process.argv.slice(2);
	if (argv[0] === 'timeline' || argv[0] === 'webview') {
		const options = parseTimelineArgs(argv.slice(1));
		if (options.help) {
			process.stdout.write(`${usage()}\n`);
			return;
		}

		await launchStandaloneTimeline(options);
		return;
	}

	const options = parseRangeDiffArgs(argv);

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
		const launchError = /** @type {NodeJS.ErrnoException | undefined} */ (result.error);

		if (launchError) {
			if (launchError.code === 'ENOENT') {
				continue;
			}

			lastFailure = `${launcher.command}: ${launchError.message}`;
			continue;
		}

		if (result.status === 0) {
			return;
		}

		lastFailure = `${launcher.command} exited with status ${result.status}`;
	}

	process.stderr.write(
		`Failed to open IDE for ${EXTENSION_ID}. ${lastFailure || 'No supported launcher was found.'}\n`,
	);
	process.exitCode = 1;
}

async function launchStandaloneTimeline(options) {
	if (!options.filePath) {
		throw new Error(`Missing file path for standalone timeline\n\n${usage()}`);
	}

	const workspacePath = path.resolve(
		options.workspacePath || (path.isAbsolute(options.filePath) ? path.dirname(options.filePath) : process.cwd()),
	);
	const absoluteFilePath = path.isAbsolute(options.filePath)
		? path.resolve(options.filePath)
		: path.resolve(workspacePath, options.filePath);

	if (!fs.existsSync(absoluteFilePath)) {
		throw new Error(`File not found: ${absoluteFilePath}`);
	}

	const { startStandaloneTimelineServer } = require('./lib/standalone-webview.js');
	const server = await startStandaloneTimelineServer({
		workspacePath,
		filePath: absoluteFilePath,
		openBrowser: options.open,
		port: options.port,
		verbose: options.verbose,
	});

	process.stderr.write(`Standalone timeline available at ${server.url}\n`);

	const shutdown = () => {
		void server.close().finally(() => {
			process.exit(0);
		});
	};

	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);
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
	const launchError = /** @type {NodeJS.ErrnoException | undefined} */ (result.error);

	if (launchError && launchError.code !== 'ENOENT') {
		process.stderr.write(`Warning: failed to focus workspace via ${ide.command}: ${launchError.message}\n`);
	}
}
