#!/usr/bin/env node

import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
	formatCommand,
	getLaunchers,
	logVerbose,
	parseRangeDiffArgs,
	parseTimelineArgs,
	resolveCliInvocation,
	resolveIde,
	usage,
} from './cli/options.ts';
import { EXTENSION_ID } from './extension/constants.ts';

void main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const invocation = resolveCliInvocation(argv);
	if (invocation.command === 'timeline') {
		const options = parseTimelineArgs(invocation.argv);
		if (options.help) {
			process.stdout.write(`${usage()}\n`);
			return;
		}

		await launchStandaloneTimeline(options);
		return;
	}

	const options = parseRangeDiffArgs(invocation.argv);
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

	openWorkspace({ workspacePath: resolvedWorkspacePath, ide, verbose: options.verbose });

	let lastFailure = '';
	for (const launcher of getLaunchers(params.toString(), ide)) {
		logVerbose(options.verbose, `Launching deep link: ${formatCommand(launcher.command, launcher.args)}`);
		const result = spawnSync(launcher.command, launcher.args, { stdio: 'inherit' });
		const launchError = result.error as NodeJS.ErrnoException | undefined;

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

async function launchStandaloneTimeline(options: ReturnType<typeof parseTimelineArgs>): Promise<void> {
	if (!options.filePath) {
		throw new Error(`Missing file path for standalone timeline\n\n${usage()}`);
	}

	const workspacePath = path.resolve(
		options.workspacePath || (path.isAbsolute(options.filePath) ? path.dirname(options.filePath) : process.cwd()),
	);
	const absoluteFilePath = path.isAbsolute(options.filePath)
		? path.resolve(options.filePath)
		: path.resolve(workspacePath, options.filePath);

	if (!fsSync.existsSync(absoluteFilePath)) {
		throw new Error(`File not found: ${absoluteFilePath}`);
	}

	if (options.json) {
		const { createCommandRunner } = await import('./extension/command-runner.ts');
		const { createTimelineService } = await import('./extension/timeline-service.ts');
		const { buildTimelineJsonSummary } = await import('./cli/timeline-json.ts');
		const runner = createCommandRunner();
		const service = createTimelineService({ runner });
		const session = await service.buildSession({
			workspacePath,
			absolutePath: absoluteFilePath,
		});
		const summary = buildTimelineJsonSummary({
			backend: session.backend,
			relativePath: session.relativePath,
			workspacePath: session.workspacePath,
			entries: session.entries,
		});
		process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
		return;
	}

	const { startStandaloneTimelineServer } = await import('./standalone/server.ts');
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

function openWorkspace(args: { workspacePath: string; ide: ReturnType<typeof resolveIde>; verbose: boolean }): void {
	const commandArgs = ['-r', args.workspacePath];
	logVerbose(args.verbose, `Opening workspace: ${formatCommand(args.ide.command, commandArgs)}`);
	const result = spawnSync(args.ide.command, commandArgs, { stdio: 'ignore' });
	const launchError = result.error as NodeJS.ErrnoException | undefined;

	if (launchError && launchError.code !== 'ENOENT') {
		process.stderr.write(`Warning: failed to focus workspace via ${args.ide.command}: ${launchError.message}\n`);
	}
}
