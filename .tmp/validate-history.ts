import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

import { createTimelineService } from '../src/extension/timeline-service.ts';

const execFileAsync = promisify(execFile);
const workspacePath = '/Users/astahmer/dev/work-related/welii';

async function runCommand(command: string, args: string[], cwd: string, signal?: AbortSignal) {
	const { stdout, stderr } = await execFileAsync(command, args, {
		cwd,
		encoding: 'utf8',
		maxBuffer: 20 * 1024 * 1024,
		signal,
	});

	return { stdout, stderr };
}

const runner = {
	runGit: async ({ workspacePath: cwd, args, options }: { workspacePath: string; args: string[]; options?: { signal?: AbortSignal } }) =>
		runCommand('git', args, cwd, options?.signal),
	runJj: async ({ workspacePath: cwd, args, options }: { workspacePath: string; args: string[]; options?: { signal?: AbortSignal } }) =>
		runCommand('jj', args, cwd, options?.signal),
	fileExists: async ({ filePath }: { filePath: string }) => {
		try {
			await access(filePath);
			return true;
		} catch {
			return false;
		}
	},
	quoteShellArg: (value: string) => JSON.stringify(value),
};

const service = createTimelineService({ runner });

const invitePath = '/Users/astahmer/dev/work-related/welii/apps/backend/src/auth/use-cases/app-invite-member-to-organization.use-case.ts';
const inviteSession = await service.buildSession({ workspacePath, absolutePath: invitePath });
console.log('invite-first-entries');
console.log(
	JSON.stringify(
		inviteSession.entries.slice(0, 8).map((entry) => ({
			revision: entry.revision,
			shortRevision: entry.shortRevision,
			description: entry.description,
			touchesFile: entry.touchesFile,
		})),
		null,
		2,
	),
);

const commitmentPath = '/Users/astahmer/dev/work-related/welii/apps/backend/src/commitments/commitment.entity.ts';
const commitmentSession = await service.buildSession({ workspacePath, absolutePath: commitmentPath });
const oldIndex = commitmentSession.entries.findIndex((entry) => entry.revision.startsWith('99dd31f4'));
const boundaryIndex = commitmentSession.entries.findIndex((entry) => entry.revision.startsWith('e99b349d'));
const oldPath = await service.resolveEntryFilePath({
	session: commitmentSession,
	entry: commitmentSession.entries[oldIndex],
	entryIndex: oldIndex,
});
const boundaryPath = await service.resolveEntryFilePath({
	session: commitmentSession,
	entry: commitmentSession.entries[boundaryIndex],
	entryIndex: boundaryIndex,
});
const preview = await service.getDiffPreview({
	session: commitmentSession,
	fromIndex: oldIndex,
	toIndex: boundaryIndex,
});
console.log('commitment-boundary');
console.log(
	JSON.stringify(
		{
			oldIndex,
			boundaryIndex,
			oldPath,
			boundaryPath,
			hasChanges: preview.hasChanges,
			nonTextualDetails: preview.nonTextualDetails.slice(0, 3),
			title: preview.title,
		},
		null,
		2,
	),
);
