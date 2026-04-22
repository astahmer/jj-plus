import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

import { resolveHistoryAdapter } from '../../src/extension/history-adapters.ts';
import type { CommandRunner } from '../../src/extension/types.ts';

const execFileAsync = promisify(execFile);
const workspacePath = '/Users/astahmer/dev/work-related/welii';
// const currentPath = 'apps/backend/src/commitments/commitment.entity.ts';
const currentPath = 'apps/backend/src/auth/use-cases/app-invite-member-to-organization.use-case.ts';
// const previousPath = 'apps/backend/src/auth/use-cases/invite-member-to-organization.use-case.ts';
// const jjHistoryTemplate = [
// 	'commit_id.short()',
// 	'"\\t"',
// 	'change_id.shortest()',
// 	'"\\t"',
// 	'author.timestamp().format("%Y-%m-%dT%H:%M:%S%:z")',
// 	'"\\t"',
// 	'author.name()',
// 	'"\\t"',
// 	'self.local_bookmarks().map(|b| b.name()).join(",")',
// 	'"\\t"',
// 	'description.first_line()',
// 	'"\\n"',
// ].join(' ++ ');

async function runCommand(command: string, args: string[], cwd: string, signal?: AbortSignal) {
	const { stdout, stderr } = await execFileAsync(command, args, {
		cwd,
		encoding: 'utf8',
		maxBuffer: 10 * 1024 * 1024,
		signal,
	});

	return {
		stdout,
		stderr,
	};
}

function createDirectRunner(): CommandRunner {
	return {
		runGit: async ({ workspacePath: runnerWorkspacePath, args, options }) =>
			runCommand('git', args, runnerWorkspacePath, options?.signal),
		runJj: async ({ workspacePath: runnerWorkspacePath, args, options }) =>
			runCommand('jj', args, runnerWorkspacePath, options?.signal),
		fileExists: async ({ filePath }) => {
			try {
				await access(filePath);
				return true;
			} catch {
				return false;
			}
		},
		quoteShellArg: (value) => JSON.stringify(value),
	};
}

const adapter = await resolveHistoryAdapter({ workspacePath, runner: createDirectRunner() });

// if (adapter.backend === 'jj') {
// 	const [currentSegment, previousSegment] = await Promise.all([
// 		runCommand(
// 			'jj',
// 			[
// 				'log',
// 				'--no-graph',
// 				'--reversed',
// 				'--summary',
// 				'-r',
// 				'ancestors(@)',
// 				'-T',
// 				jjHistoryTemplate,
// 				`root-file:${JSON.stringify(currentPath)}`,
// 			],
// 			workspacePath,
// 		),
// 		runCommand(
// 			'jj',
// 			[
// 				'log',
// 				'--no-graph',
// 				'--reversed',
// 				'--summary',
// 				'-r',
// 				'ancestors(@)',
// 				'-T',
// 				jjHistoryTemplate,
// 				`root-file:${JSON.stringify(previousPath)}`,
// 			],
// 			workspacePath,
// 		),
// 	]);

// 	console.log('Raw jj history for current path');
// 	console.log(currentSegment.stdout.trimEnd());
// 	console.log('Raw jj history for previous path');
// 	console.log(previousSegment.stdout.trimEnd());
// } else {
// 	const rawHistory = await runCommand(
// 		'git',
// 		[
// 			'log',
// 			'--follow',
// 			'--decorate=short',
// 			'--date=iso-strict',
// 			'--format=%H%x09%ad%x09%an%x09%D%x09%s',
// 			'--',
// 			currentPath,
// 		],
// 		workspacePath,
// 	);

// 	console.log('Raw git history');
// 	console.log(rawHistory.stdout.trimEnd());
// }

console.log('Adapter history');
console.log(await adapter.getFileRevisionHistory({ workspacePath, relativePath: currentPath }));
