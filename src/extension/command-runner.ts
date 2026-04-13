import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import type * as vscode from 'vscode';
import type { CommandResult, CommandRunner, RunCommandOptions } from './types';

export function createCommandRunner(args: { outputChannel?: vscode.OutputChannel }): CommandRunner {
	const { outputChannel } = args;

	const runTool = async (request: {
		command: 'git' | 'jj';
		workspacePath: string;
		args: string[];
		options?: RunCommandOptions;
	}): Promise<CommandResult> => {
		logCommand({ outputChannel, ...request });

		return new Promise<CommandResult>((resolve, reject) => {
			const child = execFile(
				request.command,
				request.args,
				{
					cwd: request.workspacePath,
					encoding: 'utf8',
					maxBuffer: 10 * 1024 * 1024,
					signal: request.options?.signal,
				},
				(error, stdout, stderr) => {
					if (error) {
						reject(error);
						return;
					}

					resolve({
						stdout: stdout || '',
						stderr: stderr || '',
					});
				},
			);

			const signal = request.options?.signal;
			if (!signal) {
				return;
			}

			const abort = () => {
				child.kill();
			};

			if (signal.aborted) {
				abort();
				return;
			}

			signal.addEventListener('abort', abort, { once: true });
		});
	};

	return {
		runGit({ workspacePath, args: commandArgs, options }) {
			return runTool({ command: 'git', workspacePath, args: commandArgs, options });
		},
		runJj({ workspacePath, args: commandArgs, options }) {
			return runTool({ command: 'jj', workspacePath, args: commandArgs, options });
		},
		async fileExists({ filePath }) {
			try {
				await access(filePath);
				return true;
			} catch {
				return false;
			}
		},
		quoteShellArg,
	};
}

function logCommand(args: {
	outputChannel?: vscode.OutputChannel;
	command: 'git' | 'jj';
	workspacePath: string;
	args: string[];
}): void {
	if (!args.outputChannel) {
		return;
	}

	args.outputChannel.appendLine(`[${new Date().toISOString()}] cwd=${args.workspacePath}`);
	args.outputChannel.appendLine(`${args.command} ${args.args.map(quoteShellArg).join(' ')}`);
}

function quoteShellArg(value: string): string {
	if (/^[a-zA-Z0-9_@./:-]+$/u.test(value)) {
		return value;
	}

	return `'${value.replace(/'/g, `'\\''`)}'`;
}
