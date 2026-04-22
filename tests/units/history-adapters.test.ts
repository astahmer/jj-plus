import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { resolveHistoryAdapter } from '../../src/extension/history-adapters.ts';
import type { CommandRunner } from '../../src/extension/types.ts';

const execFileAsync = promisify(execFile);
const historyDescriptions = [
	'initial legacy file',
	'update legacy file',
	'rename to invite',
	'update invite file',
	'rename to app',
	'update app file',
] as const;

const differentNameCopyBoundaryDescriptions = [
	'copy source to invite',
	'update invite file',
	'rename to app',
	'update app file',
] as const;

const sameNameCopyLineageDescriptions = [
	'initial seed commitment',
	'update seed commitment',
	'copy commitment to backend',
	'update backend commitment',
] as const;

function createDirectRunner(): CommandRunner {
	return {
		runGit: async ({ workspacePath, args, options }) => runCommand('git', args, workspacePath, options?.signal),
		runJj: async ({ workspacePath, args, options }) => runCommand('jj', args, workspacePath, options?.signal),
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

async function setupRepository(backend: 'git' | 'jj') {
	const workspacePath = await realpath(await mkdtemp(path.join(os.tmpdir(), `history-adapter-${backend}-`)));
	const legacyPath = 'apps/backend/src/auth/use-cases/legacy-invite-member-to-organization.use-case.ts';
	const invitePath = 'apps/backend/src/auth/use-cases/invite-member-to-organization.use-case.ts';
	const currentPath = 'apps/backend/src/auth/use-cases/app-invite-member-to-organization.use-case.ts';

	try {
		await runCommand('git', ['init'], workspacePath);
		await runCommand('git', ['config', 'user.name', 'Fixture User'], workspacePath);
		await runCommand('git', ['config', 'user.email', 'fixture@example.com'], workspacePath);

		if (backend === 'jj') {
			await runCommand('jj', ['git', 'init', '--colocate', '.'], workspacePath);
		}

		await writeTrackedFile(workspacePath, legacyPath, 'alpha\n');
		await commitSnapshot(workspacePath, 'initial legacy file');

		await writeTrackedFile(workspacePath, legacyPath, 'beta\n');
		await commitSnapshot(workspacePath, 'update legacy file');

		await renameTrackedFile(workspacePath, legacyPath, invitePath);
		await commitSnapshot(workspacePath, 'rename to invite');

		await writeTrackedFile(workspacePath, invitePath, 'gamma\n');
		await commitSnapshot(workspacePath, 'update invite file');

		await renameTrackedFile(workspacePath, invitePath, currentPath);
		await commitSnapshot(workspacePath, 'rename to app');

		await writeTrackedFile(workspacePath, currentPath, 'delta\n');
		await commitSnapshot(workspacePath, 'update app file');

		return {
			workspacePath,
			currentPath,
			runner: createDirectRunner(),
		};
	} catch (error) {
		await rm(workspacePath, { recursive: true, force: true });
		throw error;
	}
}

async function writeTrackedFile(workspacePath: string, relativePath: string, content: string) {
	const absolutePath = path.join(workspacePath, relativePath);
	await mkdir(path.dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, content);
}

async function renameTrackedFile(workspacePath: string, fromPath: string, toPath: string) {
	const absoluteToPath = path.join(workspacePath, toPath);
	await mkdir(path.dirname(absoluteToPath), { recursive: true });
	await runCommand('git', ['mv', fromPath, toPath], workspacePath);
}

async function copyTrackedFile(workspacePath: string, fromPath: string, toPath: string) {
	const absoluteToPath = path.join(workspacePath, toPath);
	await mkdir(path.dirname(absoluteToPath), { recursive: true });
	const content = await readFile(path.join(workspacePath, fromPath), 'utf8');
	await writeFile(absoluteToPath, content);
}

async function commitSnapshot(workspacePath: string, message: string) {
	await runCommand('git', ['add', '-A'], workspacePath);
	await runCommand('git', ['commit', '-m', message], workspacePath);
}

async function setupCopyLineageRepository(backend: 'git' | 'jj') {
	const workspacePath = await realpath(await mkdtemp(path.join(os.tmpdir(), `history-adapter-copy-${backend}-`)));
	const seedPath = 'apps/backend/src/auth/use-cases/select-executor-app-role-use.case.ts';
	const invitePath = 'apps/backend/src/auth/use-cases/invite-member-to-organization.use-case.ts';
	const currentPath = 'apps/backend/src/auth/use-cases/app-invite-member-to-organization.use-case.ts';

	try {
		await runCommand('git', ['init'], workspacePath);
		await runCommand('git', ['config', 'user.name', 'Fixture User'], workspacePath);
		await runCommand('git', ['config', 'user.email', 'fixture@example.com'], workspacePath);

		if (backend === 'jj') {
			await runCommand('jj', ['git', 'init', '--colocate', '.'], workspacePath);
		}

		await writeTrackedFile(workspacePath, seedPath, 'alpha\n');
		await commitSnapshot(workspacePath, 'initial seed file');

		await writeTrackedFile(workspacePath, seedPath, 'beta\n');
		await commitSnapshot(workspacePath, 'update seed file');

		await copyTrackedFile(workspacePath, seedPath, invitePath);
		await commitSnapshot(workspacePath, 'copy source to invite');

		await writeTrackedFile(workspacePath, seedPath, 'beta\nseed-only\n');
		await commitSnapshot(workspacePath, 'post-copy source update');

		await writeTrackedFile(workspacePath, invitePath, 'beta\ninvite\n');
		await commitSnapshot(workspacePath, 'update invite file');

		await renameTrackedFile(workspacePath, invitePath, currentPath);
		await commitSnapshot(workspacePath, 'rename to app');

		await writeTrackedFile(workspacePath, currentPath, 'beta\ninvite\napp\n');
		await commitSnapshot(workspacePath, 'update app file');

		return {
			workspacePath,
			currentPath,
			runner: createDirectRunner(),
		};
	} catch (error) {
		await rm(workspacePath, { recursive: true, force: true });
		throw error;
	}
}

async function setupSameNameCopyLineageRepository(backend: 'git' | 'jj') {
	const workspacePath = await realpath(await mkdtemp(path.join(os.tmpdir(), `history-adapter-same-name-${backend}-`)));
	const seedPath = 'packages/service-serf/src/commitments/commitment.entity.ts';
	const currentPath = 'packages/backend/src/commitments/commitment.entity.ts';

	try {
		await runCommand('git', ['init'], workspacePath);
		await runCommand('git', ['config', 'user.name', 'Fixture User'], workspacePath);
		await runCommand('git', ['config', 'user.email', 'fixture@example.com'], workspacePath);

		if (backend === 'jj') {
			await runCommand('jj', ['git', 'init', '--colocate', '.'], workspacePath);
		}

		await writeTrackedFile(workspacePath, seedPath, 'alpha\n');
		await commitSnapshot(workspacePath, 'initial seed commitment');

		await writeTrackedFile(workspacePath, seedPath, 'beta\n');
		await commitSnapshot(workspacePath, 'update seed commitment');

		await copyTrackedFile(workspacePath, seedPath, currentPath);
		await commitSnapshot(workspacePath, 'copy commitment to backend');

		await writeTrackedFile(workspacePath, currentPath, 'beta\nbackend\n');
		await commitSnapshot(workspacePath, 'update backend commitment');

		return {
			workspacePath,
			currentPath,
			runner: createDirectRunner(),
		};
	} catch (error) {
		await rm(workspacePath, { recursive: true, force: true });
		throw error;
	}
}

test('getFileRevisionHistory follows git rename history back to creation', async () => {
	const repo = await setupRepository('git');
	try {
		const adapter = await resolveHistoryAdapter({ workspacePath: repo.workspacePath, runner: repo.runner });

		assert.equal(adapter.backend, 'git');
		const entries = await adapter.getFileRevisionHistory({
			workspacePath: repo.workspacePath,
			relativePath: repo.currentPath,
		});

		assert.deepEqual(
			entries.map((entry) => entry.description),
			[...historyDescriptions],
		);
		assert.ok(entries.every((entry) => entry.touchesFile));
	} finally {
		await rm(repo.workspacePath, { recursive: true, force: true });
	}
});

test('getFileRevisionHistory follows jj rename history back to creation', async () => {
	const repo = await setupRepository('jj');
	try {
		const adapter = await resolveHistoryAdapter({ workspacePath: repo.workspacePath, runner: repo.runner });

		assert.equal(adapter.backend, 'jj');
		const entries = await adapter.getFileRevisionHistory({
			workspacePath: repo.workspacePath,
			relativePath: repo.currentPath,
		});

		assert.deepEqual(
			entries.map((entry) => entry.description),
			[...historyDescriptions],
		);
		assert.ok(entries.every((entry) => entry.touchesFile));
	} finally {
		await rm(repo.workspacePath, { recursive: true, force: true });
	}
});

test('getFileRevisionHistory preserves native git follow behavior for similar copy boundaries', async () => {
	const repo = await setupCopyLineageRepository('git');
	try {
		const adapter = await resolveHistoryAdapter({ workspacePath: repo.workspacePath, runner: repo.runner });

		assert.equal(adapter.backend, 'git');
		const entries = await adapter.getFileRevisionHistory({
			workspacePath: repo.workspacePath,
			relativePath: repo.currentPath,
		});

		assert.deepEqual(
			entries.map((entry) => entry.description),
			['initial seed file', 'update seed file', ...differentNameCopyBoundaryDescriptions],
		);
		assert.ok(entries.every((entry) => entry.touchesFile));
	} finally {
		await rm(repo.workspacePath, { recursive: true, force: true });
	}
});

test('getFileRevisionHistory stops jj history at creation when the copy source has a different file name', async () => {
	const repo = await setupCopyLineageRepository('jj');
	try {
		const adapter = await resolveHistoryAdapter({ workspacePath: repo.workspacePath, runner: repo.runner });

		assert.equal(adapter.backend, 'jj');
		const entries = await adapter.getFileRevisionHistory({
			workspacePath: repo.workspacePath,
			relativePath: repo.currentPath,
		});

		assert.deepEqual(
			entries.map((entry) => entry.description),
			[...differentNameCopyBoundaryDescriptions],
		);
		assert.ok(entries.every((entry) => entry.touchesFile));
	} finally {
		await rm(repo.workspacePath, { recursive: true, force: true });
	}
});

test('getFileRevisionHistory follows git same-name copy boundaries as path history', async () => {
	const repo = await setupSameNameCopyLineageRepository('git');
	try {
		const adapter = await resolveHistoryAdapter({ workspacePath: repo.workspacePath, runner: repo.runner });

		assert.equal(adapter.backend, 'git');
		const entries = await adapter.getFileRevisionHistory({
			workspacePath: repo.workspacePath,
			relativePath: repo.currentPath,
		});

		assert.deepEqual(
			entries.map((entry) => entry.description),
			[...sameNameCopyLineageDescriptions],
		);
		assert.ok(entries.every((entry) => entry.touchesFile));
	} finally {
		await rm(repo.workspacePath, { recursive: true, force: true });
	}
});

test('getFileRevisionHistory follows jj same-name copy boundaries as path history', async () => {
	const repo = await setupSameNameCopyLineageRepository('jj');
	try {
		const adapter = await resolveHistoryAdapter({ workspacePath: repo.workspacePath, runner: repo.runner });

		assert.equal(adapter.backend, 'jj');
		const entries = await adapter.getFileRevisionHistory({
			workspacePath: repo.workspacePath,
			relativePath: repo.currentPath,
		});

		assert.deepEqual(
			entries.map((entry) => entry.description),
			[...sameNameCopyLineageDescriptions],
		);
		assert.ok(entries.every((entry) => entry.touchesFile));
	} finally {
		await rm(repo.workspacePath, { recursive: true, force: true });
	}
});
